# ACA Signal Engine worker.
#
# Deliberately much lighter than workers/list-building-scraper: the Phase 1
# collectors (EDGAR, ATS job boards) are plain JSON/XML over HTTPS, so there is
# no Playwright, no Chromium and no DuckDB here. That keeps the image small and
# the cold start fast, which matters because this scales to zero between runs.
#
# If a future collector genuinely needs a browser, it should call the existing
# aca-crawler (crawl4ai) service rather than pulling Chromium in here.

FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --include=dev --ignore-scripts

COPY . .
RUN node node_modules/typescript/lib/tsc.js

ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "start"]
