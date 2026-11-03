FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false

COPY . .
RUN npm run build

ENV NODE_OPTIONS="--max-old-space-size=768"

EXPOSE 8080
CMD ["npm", "start"]
