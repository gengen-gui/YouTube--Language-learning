# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Front-end talks to backend via /api, which nginx will reverse-proxy
# to the `server` container (see nginx.conf).
ENV VITE_API_BASE=/api

RUN npm ci && npm run build

# --- runtime ---
FROM nginx:1.27-alpine

# Drop default config
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Static assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
