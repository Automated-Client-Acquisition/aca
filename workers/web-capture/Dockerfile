FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Install Playwright Chromium and all its system dependencies
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_OPTIONS="--max-old-space-size=1740"

EXPOSE 8080
CMD ["npm", "start"]
