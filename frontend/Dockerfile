# =============================================================================
# SPACE EXSPACE Frontend - Production Build Image
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (use npm install to handle single package.json)
RUN npm install

# Copy configuration and source files
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Compile React application to static assets in /app/dist
RUN npm run build

# Runner stage to export static files into Caddy volume
FROM alpine:3.20

WORKDIR /srv

COPY --from=builder /app/dist ./

CMD ["sh", "-c", "cp -rf /srv/. /dist/ && echo 'Frontend static assets populated in Caddy volume'"]
