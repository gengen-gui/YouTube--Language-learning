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
ENV DB_PATH=/data/data.db
# Override at runtime via -e or compose `environment`
ENV JWT_SECRET=change-me-in-production
ENV TRANSLATE_PROVIDER=google

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built JS
COPY --from=builder /app/dist ./dist

# Persistent data directory
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

# Run as the built-in `node` user (UID 1000 in node:alpine)
USER node

CMD ["node", "dist/index.js"]
