# Build the Vite frontend with the public client configuration.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_TELEGRAM_BOT_USERNAME
ARG VITE_USD_TO_TON_RATE

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME}
ENV VITE_USD_TO_TON_RATE=${VITE_USD_TO_TON_RATE}

RUN npm run build

# Run only production dependencies. Vite is dynamically imported in development mode.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["npm", "run", "start"]
