FROM node:22-slim

# Install FFmpeg, curl, ca-certificates, and standalone yt-dlp (nightly)
# Standalone yt-dlp_linux bundles Python, yt-dlp-ejs, curl_cffi, certifi, brotli, etc.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && \
    ARCH="$(uname -m)" && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      YTDLP_BIN="yt-dlp_linux_aarch64"; \
    else \
      YTDLP_BIN="yt-dlp_linux"; \
    fi && \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/${YTDLP_BIN}" -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    yt-dlp --version && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
