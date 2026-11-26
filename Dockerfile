# syntax=docker/dockerfile:1

# Build the frontend with the complete toolchain.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_TELEGRAM_BOT_USERNAME
ARG VITE_USD_TO_TON_RATE

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY} \
    VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME} \
    VITE_USD_TO_TON_RATE=${VITE_USD_TO_TON_RATE}

RUN npm run build

# Install only runtime dependencies in a clean production stage.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The backend runs TypeScript through the production tsx dependency.
COPY --chown=node:node backend ./backend
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node TERMS_AND_POLICIES.md ./TERMS_AND_POLICIES.md

ENV PORT=3000
EXPOSE 3000

# Run without root privileges.
USER node

# The health endpoint is intentionally lightweight and does not depend on
# external providers, so the platform can distinguish process health from
# third-party API availability.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "backend/server.ts"]
