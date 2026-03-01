FROM oven/bun:1.3.8 as builder

WORKDIR /app

# Install dependencies
# Use bun.lock (text-based) for better git compatibility and reproducibility
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun run build

# Runtime stage
FROM oven/bun:1.3.8

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/collector/dist ./apps/collector/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages ./packages
COPY scripts ./scripts
COPY package.json ./

# Database initialization should be automatic
# Environment variables are set by Railway

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
