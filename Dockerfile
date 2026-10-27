FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Migration tools stay separate from the application runtime image.
FROM dependencies AS tools
COPY src ./src
COPY db/migrations ./db/migrations
COPY scripts/migrate.ts scripts/seed.ts scripts/prepare-docker.ts scripts/docker-smoke.ts ./scripts/
USER node
CMD ["node", "--import", "tsx", "scripts/prepare-docker.ts"]

FROM dependencies AS builder
ENV QADAM_STANDALONE=true
COPY . .
RUN npm run build
RUN npm run check:build

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
