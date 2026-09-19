# Playwright browsers + system deps must match the npm playwright version.
# Pin: package.json → playwright@1.50.1
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    HEADLESS=true \
    DRY_RUN=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first (better layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source only (UI not needed in the bot container)
COPY src ./src

# Runtime dirs for session + answered DB (ephemeral unless a Render disk is mounted)
RUN mkdir -p data storage \
  && chown -R pwuser:pwuser /app

USER pwuser

# Optional: if PORT is set (Web Service), index.js serves a tiny /healthz
# Background Worker: PORT is unset; bot runs alone.
CMD ["npm", "run", "start:prod"]
