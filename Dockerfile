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
# diagram's mermaid-cli (puppeteer) needs a real Chromium to render -- deliberately NOT
# installed here either (same minimal-footprint policy); it hardcodes a macOS Chrome
# path in its own bundle config, confirmed live via `/api/start?demo=diagram`. Fix
# belongs on a separate host (see labor coordination), not this container.
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
WORKDIR /app
COPY . /app
ENV PORT=8790
EXPOSE 8790
CMD ["node", "server.mjs"]
