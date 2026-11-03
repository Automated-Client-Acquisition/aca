FROM node:20-bookworm

# System deps for Chromium rendering
RUN apt-get update && apt-get install -y \
  fonts-liberation \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

# Pre-install Remotion's Chrome Headless Shell during build (not at runtime)
RUN node -e "const {ensureBrowser} = require('@remotion/renderer'); ensureBrowser().then(() => console.log('Browser installed')).catch(e => { console.error(e); process.exit(1); })"

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/index.js"]
