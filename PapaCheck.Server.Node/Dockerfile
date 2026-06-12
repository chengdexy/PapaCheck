# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ---- Runtime Stage ----
FROM node:22-alpine AS runner
WORKDIR /app

# TTS 运行时依赖 Python + edge-tts
RUN apk add --no-cache python3 py3-pip && pip3 install --break-system-packages edge-tts

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY --from=builder /app/dist/ ./dist/
COPY scripts/ ./scripts/
COPY tts_cache/ ./tts_cache/

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:8080/api/ping || exit 1

EXPOSE 8080

CMD ["node", "dist/index.js", "--web-dir", "/app/web", "--db-path", "/app/data/data.db"]
