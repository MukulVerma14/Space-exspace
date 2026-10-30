# =============================================================================
# SPACE EXSPACE Backend - Multi-Stage Production Dockerfile
# =============================================================================
# Stage 1: Build Stage (compiles TypeScript to dist/)
# Stage 2: Production Runtime (minimal footprint, non-root user, healthcheck)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

# Copy package manifests first for optimal Docker layer caching
COPY package*.json ./

# Install all dependencies including devDependencies needed to build TypeScript
RUN npm ci

# Copy TypeScript configuration, migration files, and source code
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Install dumb-init for proper signal handling (SIGTERM, SIGINT) and wget for healthchecks
RUN apk add --no-cache dumb-init wget

# Copy package manifests
COPY package*.json ./

# Install production dependencies only (omit devDependencies)
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist

# Copy migrations so database migrations can be executed inside the container
COPY --from=builder /app/migrations ./migrations

# Expose internal application port
EXPOSE 3000

# Health check probe against Express /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Run as unprivileged non-root user for container security
USER node

# Use dumb-init as PID 1 to forward termination signals gracefully
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start production server
CMD ["node", "dist/server.js"]
