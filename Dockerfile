# ---------------------------------------------------------------------------
# Stage 1: build — compile TypeScript with full devDependencies available.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: production dependencies only (no devDependencies in the final image).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 3: runtime — minimal image with just the compiled output + prod deps.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# The official Node images already include a non-root `node` user
# (uid/gid 1000) — run as it rather than root.
USER node

EXPOSE 3000

# Simple TCP/HTTP healthcheck against /health using only Node's built-in
# http module — no extra tools (curl/wget) needed in the alpine image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health',timeout:4000},(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Array form (no shell) so Node runs as PID 1 and receives SIGTERM/SIGINT
# directly — src/server.ts handles both for a graceful shutdown.
CMD ["node", "dist/server.js"]
