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

FROM dependencies AS api-builder
ENV QADAM_STANDALONE=true
COPY . .
RUN npm run build:backend

FROM base AS api-runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 QADAM_BACKEND=true
COPY --from=api-builder --chown=node:node /app/backend/.next/standalone ./
COPY --from=api-builder --chown=node:node /app/backend/.next/static ./backend/.next/static
USER node
EXPOSE 3000
CMD ["node", "backend/server.js"]

FROM dependencies AS frontend-builder
ARG NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3210
ENV QADAM_STANDALONE=true NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}
COPY . .
RUN npm run build:frontend

FROM base AS frontend-runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 QADAM_FRONTEND_ONLY=true
COPY --from=frontend-builder --chown=node:node /app/frontend/.next/standalone ./
COPY --from=frontend-builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-builder --chown=node:node /app/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
