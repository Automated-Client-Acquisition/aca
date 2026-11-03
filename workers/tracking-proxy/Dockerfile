# Tracking proxy for self-hosted installs (ACA Cloud runs api/proxy.ts on Vercel).
# No dependencies: the handler only uses fetch, Request and Response.
FROM node:22-alpine
WORKDIR /app
COPY api ./api
COPY server.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "--no-warnings", "server.mjs"]
