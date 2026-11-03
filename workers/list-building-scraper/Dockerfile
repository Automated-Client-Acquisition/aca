FROM node:22-slim

WORKDIR /app

# ca-certificates is required by DuckDB httpfs for TLS reads against
# Hugging Face parquet URLs (common-crawl discovery source).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev --ignore-scripts && npm rebuild @duckdb/node-api

# Install Playwright Chromium and all its system dependencies
RUN npx playwright install --with-deps chromium

COPY . .
# The .bin/tsc shim gets corrupted by duckdb postinstall; call tsc.js directly
RUN node node_modules/typescript/lib/tsc.js

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=3072"

EXPOSE 8080
CMD ["npm", "start"]
