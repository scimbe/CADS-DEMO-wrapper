# Minimal wrapper container. The gallery + static-serving demos need only Node.
# Tool-backed demos additionally need real system tools -- confirmed by grepping each
# bundled manifests/*/run.sh, not guessed: python3 (newsletter, contractcheck,
# temporal-poc, podcast), ffmpeg + whisper-cli (podcast), exiftool + ImageMagick
# (phototools), graphviz/dot (diagram), poppler/pdftotext (contractcheck). None of this
# was installed before #10 bundled these demos in-repo, so every one of them failed at
# the run.sh step (install itself succeeded) -- caught live via `/api/start?demo=...`.
# piper isn't needed by anything currently bundled -- not added (don't install for a
# hypothetical future demo).
#
# whisper-cli / local speech-to-text is deliberately NOT installed here -- operator
# policy (2026-08-31): no locally-hosted Whisper on this host, STT goes through the
# channel to llm2 instead (same policy that decommissioned the standalone
# whisper-service). podcast's own demo design already serves a cached prior render by
# default (see server.mjs's invokeServeMedia -- full render is too slow for one click),
# so this doesn't block that path; a fresh podcast render would need the llm2 channel
# once that's wired up.
#
# Base is Debian trixie (Python 3.13): the newsletter bundle's requirements-lock pins numpy 2.5.2,
# which has no wheel for bookworm's Python 3.11 -- the venv build failed there.
#
# diagram no longer needs a browser: the LLM writes Graphviz DOT and `dot` renders it (lib/diagram.mjs).
# The newsletter PDF step needs Chrome/Chromium, which is deliberately not installed: the run skips the
# PDF and the page offers printing from the visitor's browser instead (lib/pdf.mjs).
FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg exiftool imagemagick graphviz poppler-utils \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# temporal-poc needs the real Temporal CLI (server start-dev / workflow subcommands); its run.sh
# preflight refused without it. Pinned release, checksum from temporalio/cli v1.9.1 checksums.txt.
ADD --checksum=sha256:09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5 \
    https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_linux_amd64.tar.gz /tmp/temporal.tgz
RUN tar -xzf /tmp/temporal.tgz -C /usr/local/bin temporal && rm /tmp/temporal.tgz && temporal --version
# Python venvs for the two bundles that need pip packages, built ONCE here so a run does not run
# `pip install` (the newsletter spent most of its 35 s on that). server.mjs links work/runs/<run>/.venv
# to these. Package pins come from the bundles themselves.
WORKDIR /app
COPY manifests/newsletter/bundle.tar.gz /tmp/nl.tgz
COPY manifests/temporal-poc/bundle.tar.gz /tmp/tp.tgz
RUN set -e; mkdir -p /opt/venvs /tmp/nl /tmp/tp \
 && tar -xzf /tmp/nl.tgz -C /tmp/nl && tar -xzf /tmp/tp.tgz -C /tmp/tp \
 && python3 -m venv /opt/venvs/newsletter && /opt/venvs/newsletter/bin/pip install -q --no-cache-dir -r /tmp/nl/requirements-lock.txt \
 && python3 -m venv /opt/venvs/temporal-poc && /opt/venvs/temporal-poc/bin/pip install -q --no-cache-dir -r /tmp/tp/poc/requirements.txt \
 && rm -rf /tmp/nl /tmp/tp /tmp/nl.tgz /tmp/tp.tgz
COPY . /app
# Remotion source of the videos is not needed at runtime (.dockerignore is not applied to a piped tar context)
RUN rm -rf /app/motion
ENV PORT=8790
EXPOSE 8790
CMD ["node", "server.mjs"]
