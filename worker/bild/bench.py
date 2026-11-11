"""Benchmark of the reference worker's pipeline: milliseconds per picture for each resolution, 4 steps, FLUX.1-schnell.

Loads the model exactly as server.py does (same BILD_* environment, the first run downloads ~34 GB), warms up once per
resolution and prints the median of --runs pictures. Run it on the host the operator chose, never during the call center's
hours on cs4f (the Mac is shared; image jobs only at night, US-Pacific clock).

    python bench.py --runs 5
    python bench.py --sizes 256x256,512x768 --steps 4 --json

The wrapper's deadline is 30 s for everything (line + generation + its picture check, which needs about 2-5 s): a size is
usable when its median stays under about 15 s on the chosen host, so one request may wait for another in the line.
"""
import argparse
import json
import statistics
import time

import server

DEFAULT = "256x256,512x512,512x768,768x768,1024x1024"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", default=DEFAULT)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    t = time.monotonic()
    server.load()
    load_ms = int((time.monotonic() - t) * 1000)
    rows = []
    for s in a.sizes.split(","):
        w, h = (int(x) for x in s.lower().split("x"))
        q = {"prompt": "a friendly robot watering flowers, comic style. " + server.SAFE_SUFFIX, "width": w, "height": h, "steps": a.steps, "seed": 1}
        server.generate(q, time.monotonic() + 600)  # warm-up (compiles kernels, fills caches)
        ms = []
        for i in range(a.runs):
            q["seed"] = i + 2
            t = time.monotonic()
            server.generate(q, time.monotonic() + 600)
            ms.append(int((time.monotonic() - t) * 1000))
        rows.append({"size": f"{w}x{h}", "render_min": server.MIN_RENDER, "steps": a.steps, "median_ms": int(statistics.median(ms)), "max_ms": max(ms), "runs": ms})
    if a.json:
        print(json.dumps({"device": server._state["device"], "model": server.MODEL, "load_ms": load_ms, "rows": rows}, indent=2))
        return
    print(f"device {server._state['device']}  model {server.MODEL}  load {load_ms} ms")
    for r in rows:
        print(f"{r['size']:>10}  steps {r['steps']}  median {r['median_ms']:>6} ms  max {r['max_ms']:>6} ms")


if __name__ == "__main__":
    main()
