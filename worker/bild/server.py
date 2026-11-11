"""Reference GPU worker for "KI-Bilder auf Wunsch" (lib/duell-bild.mjs, DUELL_BILD_BACKEND=http).

FLUX.1-schnell (black-forest-labs, Apache-2.0) through diffusers, 4 steps, no classifier-free guidance, a seed from the
server (deterministic: the same request makes the same picture). One picture at a time on one GPU; a request that cannot
start in time is answered 503 at once, a run that would pass its deadline is interrupted between two steps.

    POST /generate   Authorization: Bearer $BILD_TOKEN
                     {"prompt", "negative", "width", "height", "steps", "seed", "timeout_ms", "safe": true}
                  -> 200 {"image": <base64 JPEG>, "mime": "image/jpeg", "ms", "seed", "w", "h"}
                   | 200 {"flagged": true, "ms"}            the optional safety classifier refused the picture
                   | 400 bad request | 401 token | 503 {"error": "busy" | "timeout"}
    GET  /health     -> {"ok", "model", "device", "last_ms"}   (no token: nothing in it is secret)

Safe defaults: the prompt must already end with the server's safety words (lib/duell-bild.mjs SAFE_SUFFIX), the worker adds
them again if missing; the user never sets a negative prompt; sizes are clamped to multiples of 16 between 256 and 1024;
steps 1..8; the worker binds 127.0.0.1 unless BILD_HOST says otherwise (put it behind the wrapper's network, never public).
Optional: BILD_SAFETY_MODEL, an image classifier from the Hugging Face hub (e.g. Falconsai/nsfw_image_detection,
Apache-2.0) whose label "nsfw" above BILD_SAFETY_THRESHOLD flags the picture. The wrapper checks every picture with its own
vision model anyway; this is a second, local net.

Environment:
    BILD_TOKEN              shared secret with the wrapper (DUELL_BILD_TOKEN), at least 16 characters (required)
    BILD_MODEL              default black-forest-labs/FLUX.1-schnell (downloaded on first start, ~34 GB, needs `huggingface-cli login`
                            only if the hub asks; schnell is Apache-2.0)
    BILD_DEVICE             cuda | mps | cpu (default: cuda if available, else mps, else cpu)
    BILD_OFFLOAD            1: enable_model_cpu_offload() (GPUs with 24 GB such as A10 or L4: the 12B transformer and T5 do not
                            fit together in bf16); default 1 on cuda with < 40 GB, else 0
    BILD_MIN_RENDER         render at least this edge (default 512) and scale down: FLUX is weak at 256 px
    BILD_TRUE_CFG           > 1 uses the negative prompt with true CFG (diffusers >= 0.33); doubles the time; default 1 (off)
    BILD_HOST / BILD_PORT   default 127.0.0.1 / 8188

Run (on the GPU host, after the operator decided where):
    python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
    BILD_TOKEN=... python server.py
"""
import base64
import hmac
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SAFE_SUFFIX = "family friendly, fully clothed, no gore, no text"
MAX_PROMPT = 600
MAX_BODY = 8192

TOKEN = os.environ.get("BILD_TOKEN", "")
MODEL = os.environ.get("BILD_MODEL", "black-forest-labs/FLUX.1-schnell")
MIN_RENDER = int(os.environ.get("BILD_MIN_RENDER", "512"))
TRUE_CFG = float(os.environ.get("BILD_TRUE_CFG", "1"))
SAFETY_MODEL = os.environ.get("BILD_SAFETY_MODEL", "")
SAFETY_THRESHOLD = float(os.environ.get("BILD_SAFETY_THRESHOLD", "0.5"))

_gpu = threading.Lock()
_state = {"pipe": None, "device": "", "safety": None, "last_ms": None}


def clamp16(v, lo=256, hi=1024):
    v = int(v)
    return max(lo, min(hi, v - v % 16))


def load():
    """Loads the pipeline once. Imported here so `python -m py_compile` and the tests need no torch."""
    import torch
    from diffusers import FluxPipeline

    dev = os.environ.get("BILD_DEVICE") or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    dtype = torch.bfloat16 if dev in ("cuda", "mps") else torch.float32
    pipe = FluxPipeline.from_pretrained(MODEL, torch_dtype=dtype)
    big = dev == "cuda" and torch.cuda.get_device_properties(0).total_memory >= 40 * 1024 ** 3
    if os.environ.get("BILD_OFFLOAD", "0" if big or dev != "cuda" else "1") == "1":
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(dev)
    pipe.set_progress_bar_config(disable=True)
    _state.update(pipe=pipe, device=dev)
    if SAFETY_MODEL:
        from transformers import pipeline
        _state["safety"] = pipeline("image-classification", model=SAFETY_MODEL, device=0 if dev == "cuda" else -1)


def flagged(img):
    clf = _state["safety"]
    if not clf:
        return False
    for r in clf(img):
        if str(r.get("label", "")).lower() in ("nsfw", "porn", "hentai", "sexy") and float(r.get("score", 0)) >= SAFETY_THRESHOLD:
            return True
    return False


class Deadline(Exception):
    pass


def generate(q, deadline):
    import torch

    w, h = clamp16(q["width"]), clamp16(q["height"])
    scale = max(1.0, MIN_RENDER / min(w, h))
    rw, rh = clamp16(w * scale, 256, 1536), clamp16(h * scale, 256, 1536)
    steps = max(1, min(8, int(q.get("steps", 4))))
    prompt = str(q["prompt"])[:MAX_PROMPT]
    if not prompt.endswith(SAFE_SUFFIX):
        prompt = prompt + ". " + SAFE_SUFFIX
    pipe, dev = _state["pipe"], _state["device"]
    gen = torch.Generator(device="cpu" if dev == "mps" else dev).manual_seed(int(q["seed"]) & 0xFFFFFFFF)

    def on_step(p, i, t, kw):
        if time.monotonic() > deadline:
            p._interrupt = True
            raise Deadline()
        return kw

    extra = {}
    if TRUE_CFG > 1:
        extra = {"negative_prompt": str(q.get("negative", ""))[:MAX_PROMPT], "true_cfg_scale": TRUE_CFG}
    img = pipe(prompt, width=rw, height=rh, num_inference_steps=steps, guidance_scale=0.0, max_sequence_length=256,
               generator=gen, callback_on_step_end=on_step, **extra).images[0]
    if (rw, rh) != (w, h):
        from PIL import Image
        img = img.resize((w, h), Image.LANCZOS)
    return img, w, h


class Handler(BaseHTTPRequestHandler):
    server_version = "bild-worker"

    def log_message(self, fmt, *args):  # never log prompts; one line per request with status and time
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": _state["pipe"] is not None, "model": MODEL, "device": _state["device"], "last_ms": _state["last_ms"]})
        self.reply(404, {"error": "unknown"})

    def do_POST(self):
        t0 = time.monotonic()
        if self.path != "/generate":
            return self.reply(404, {"error": "unknown"})
        auth = self.headers.get("Authorization", "")
        if not (auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].encode(), TOKEN.encode())):
            return self.reply(401, {"error": "token"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self.reply(400, {"error": "bad-request"})
        try:
            q = json.loads(self.rfile.read(n))
            assert isinstance(q.get("prompt"), str) and q["prompt"].strip()
            int(q["width"]), int(q["height"]), int(q["seed"])
        except Exception:
            return self.reply(400, {"error": "bad-request"})
        budget = max(0.5, min(30.0, float(q.get("timeout_ms", 20000)) / 1000.0))
        deadline = t0 + budget
        # one picture at a time: wait for the GPU only as long as the deadline allows (at least 1 s must be left to run)
        if not _gpu.acquire(timeout=max(0.0, budget - 1.0)):
            return self.reply(503, {"error": "busy"})
        try:
            img, w, h = generate(q, deadline)
            bad = flagged(img)
            ms = int((time.monotonic() - t0) * 1000)
            _state["last_ms"] = ms
            if bad:
                return self.reply(200, {"flagged": True, "ms": ms})
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=88, optimize=True)
            print(json.dumps({"event": "bild", "w": w, "h": h, "ms": ms}), flush=True)
            return self.reply(200, {"image": base64.b64encode(buf.getvalue()).decode(), "mime": "image/jpeg", "ms": ms, "seed": int(q["seed"]), "w": w, "h": h})
        except Deadline:
            return self.reply(503, {"error": "timeout"})
        except Exception as e:  # noqa: BLE001 - one bad request never takes the worker down
            print(json.dumps({"event": "bild-error", "why": str(e)[:120]}), flush=True)
            return self.reply(500, {"error": "worker"})
        finally:
            _gpu.release()


def main():
    if len(TOKEN) < 16:
        sys.exit("BILD_TOKEN (16+ characters) missing")
    load()
    host, port = os.environ.get("BILD_HOST", "127.0.0.1"), int(os.environ.get("BILD_PORT", "8188"))
    print(json.dumps({"event": "bild-worker", "model": MODEL, "device": _state["device"], "listen": f"{host}:{port}"}), flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
