#!/usr/bin/env python3
"""Build manifests/erklaervideo/bundle.tar.gz (deterministic) from a checkout of scimbe/CADS-DEMO-podcast
(directory explainer-video/) and rewrite bundle.sha256 + source commit in manifest.json.

  python3 bin/build-erklaervideo-bundle.py <path-to-CADS-DEMO-podcast-checkout>

The tarball holds run.sh, verify.sh, API.md and evgen/*.py (no tests, no caches); mtime/uid/gid are fixed so the
same source always gives the same sha256.
"""
import gzip, hashlib, io, json, subprocess, sys, tarfile
from pathlib import Path

src = Path(sys.argv[1]).resolve() / "explainer-video"
out = Path(__file__).resolve().parent.parent / "manifests" / "erklaervideo"
files = ["run.sh", "verify.sh", "API.md"] + sorted(str(p.relative_to(src)) for p in (src / "evgen").glob("*.py"))
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tf:
    for rel in files:
        data = (src / rel).read_bytes()
        ti = tarfile.TarInfo(rel)
        ti.size, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = len(data), 0, 0, 0, "root", "root"
        ti.mode = 0o755 if rel.endswith(".sh") else 0o644
        tf.addfile(ti, io.BytesIO(data))
gz = io.BytesIO()
with gzip.GzipFile(fileobj=gz, mode="wb", mtime=0) as g:
    g.write(raw.getvalue())
(out / "bundle.tar.gz").write_bytes(gz.getvalue())
sha = hashlib.sha256(gz.getvalue()).hexdigest()
commit = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
mp = out / "manifest.json"
m = json.loads(mp.read_text())
m["bundle"]["sha256"] = sha
m["source"] = {"repo": "scimbe/CADS-DEMO-podcast", "path": "explainer-video", "commit": commit}
mp.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
print(sha, commit[:7], len(files), "files")
print("Signatur ist jetzt ungueltig: node bin/sign-manifests.mjs --only erklaervideo --version <neu>")
