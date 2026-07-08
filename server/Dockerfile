# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# --- runtime ---
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
# NOTE: db.ts reads DB_FILE (not DB_PATH). Point it at the persistent volume.
ENV DB_FILE=/data/data.db
# Override at runtime via -e or compose `environment`
ENV JWT_SECRET=change-me-in-production
ENV TRANSLATE_PROVIDER=google

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built JS
COPY --from=builder /app/dist ./dist

# Persistent data directory (owned by `node` so the non-root process can write)
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

EXPOSE 8787

# Run as the built-in `node` user (UID 1000 in node:alpine)
USER node

CMD ["node", "dist/index.js"]
