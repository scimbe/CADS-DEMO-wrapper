"""Sprachausgabe fuer die Anwendungsfall-Videos, lokal mit Piper (keine Synthese auf geteilten Knoten).

Stimmen wie bisher: Deutsch de_DE-thorsten-high ("Thomas"), Englisch en_US-joe-medium (CC0).
Liest src/narration.json, schreibt je Zeile public/vo/<slug>.<lang>.<n>.m4a (Lautheit -16 LUFS),
die Zeitachse nach src/vo-timing.json und die Untertitel nach static/motion/captions/<slug>.<lang>.vtt.
Die Szenenlaengen richten sich nach der gemessenen Sprechdauer.

Aufruf (Piper in einer eigenen venv, `pip install piper-tts`):
  PIPER_DE=/pfad/de_DE-thorsten-high.onnx PIPER_EN=/pfad/en_US-joe-medium.onnx \
  ESPEAK_DATA=/kurzer/pfad/espeak-ng-data  <venv>/bin/python scripts/voice.py [slug ...]
ESPEAK_DATA nur setzen, wenn der Pfad der venv sehr lang ist (espeak-ng kuerzt lange Pfade).
"""
import json, os, subprocess, sys, tempfile, wave
from pathlib import Path

from piper import PiperVoice

ROOT = Path(__file__).resolve().parent.parent
NARR = json.loads((ROOT / "src" / "narration.json").read_text())
OUT = ROOT / "public" / "vo"
TIMING = ROOT / "src" / "vo-timing.json"
CAPS = ROOT.parent / "static" / "motion" / "captions"
# Zeitachse: jede Szene = Vorlauf + Sprechdauer + Nachlauf (mindestens "min" aus narration.json);
# die letzte Szene steht etwas laenger. Remotion (src/UseCases.tsx) und die Untertitel lesen dieselben Werte.
FPS, LEAD, TAIL, END_HOLD = 30, 0.35, 0.7, 1.0
OUT.mkdir(parents=True, exist_ok=True)
kw = {"espeak_data_dir": os.environ["ESPEAK_DATA"]} if os.environ.get("ESPEAK_DATA") else {}
voices = {"de": PiperVoice.load(os.environ["PIPER_DE"], **kw), "en": PiperVoice.load(os.environ["PIPER_EN"], **kw)}
timing = json.loads(TIMING.read_text()) if TIMING.exists() else {}
only = set(sys.argv[1:])


def ts(s):
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{sec:06.3f}"


def duration(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, check=True)
    return round(float(r.stdout.strip()), 3)


for slug, scenes in NARR.items():
    if only and slug not in only:
        continue
    timing[slug] = {}
    for lang, voice in voices.items():
        durs = []
        for n, sc in enumerate(scenes):
            dst = OUT / f"{slug}.{lang}.{n}.m4a"
            with tempfile.TemporaryDirectory() as td:
                wav = Path(td) / "raw.wav"
                with wave.open(str(wav), "wb") as w:
                    voice.synthesize_wav(sc[lang], w)
                # Stille an den Raendern weg, Lautheit angleichen, AAC mono 48 kHz
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af",
                                "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                                "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                                "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "1",
                                "-c:a", "aac", "-b:a", "96k", str(dst)], check=True)
            d = duration(dst)
            durs.append(d)
            print(f"{slug}.{lang}.{n}  {d:5.2f}s  {sc[lang]}")
        scenes_t, cur = [], 0
        for n, (sc, d) in enumerate(zip(scenes, durs)):
            length = max(sc["min"], LEAD + d + TAIL) + (END_HOLD if n == len(scenes) - 1 else 0)
            frames = round(length * FPS)
            scenes_t.append({"from": cur, "len": frames, "dur": d})
            cur += frames
        timing[slug][lang] = {"scenes": scenes_t, "total": cur}
        cues = ["WEBVTT", ""]
        for n, (sc, t) in enumerate(zip(scenes, scenes_t), 1):
            start = t["from"] / FPS + LEAD
            cues += [str(n), f"{ts(start)} --> {ts(start + t['dur'] + 0.3)}", sc[lang], ""]
        CAPS.mkdir(parents=True, exist_ok=True)
        (CAPS / f"{slug}.{lang}.vtt").write_text("\n".join(cues))
        print(f"{slug}.{lang}: {cur / FPS:.1f}s")
TIMING.write_text(json.dumps(timing, indent=1) + "\n")
print("timing ->", TIMING)
