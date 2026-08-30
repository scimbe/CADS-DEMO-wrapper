# Minimal wrapper container. The gallery + static-serving demos need only Node.
# Tool-backed demos additionally need: ffmpeg, exiftool, imagemagick, graphviz (dot),
# poppler (pdftotext), whisper-cli, piper — add to the base image as needed.
FROM node:22-slim
WORKDIR /app
COPY . /app
ENV PORT=8790
EXPOSE 8790
CMD ["node", "server.mjs"]
