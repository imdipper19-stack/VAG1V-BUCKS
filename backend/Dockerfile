# =====================================================================
# Backend Dockerfile (Debian slim — стабильнее чем Alpine для Playwright stealth)
#
# Размер образа: ~700 MB (с Chromium). Альтернатива Alpine падает на musl libc
# при stealth-плагине puppeteer-extra (специфичные fingerprint-патчи).
# =====================================================================

# ───────────── Build stage ─────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Устанавливаем deps (включая dev для nest build)
COPY package.json package-lock.json* ./
RUN npm ci --include=dev || npm install

COPY . .
RUN npm run build

# Сжимаем node_modules: оставляем только prod-зависимости в финальном образе
RUN npm prune --omit=dev


# ───────────── Production stage ─────────────
FROM node:20-bookworm-slim AS runner

# Устанавливаем системные зависимости для Chromium + Playwright stealth
# (libnss3, fonts, и пр. — стандартный список Playwright для Debian)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Не качаем браузеры от Playwright — используем системный Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Копируем prod артефакты
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Папка для скриншотов диагностики (BrowserPool / EpicApiPurchaseService)
RUN mkdir -p /app/screenshots && chown -R node:node /app

USER node

EXPOSE 3001

# tini — корректно прокидывает SIGTERM до Node чтобы Chromium-инстансы из BrowserPool
# успели закрыться через onModuleDestroy
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
