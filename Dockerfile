# syntax=docker/dockerfile:1.7
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:scripts

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Migrations, seed and demo data, for the Cloud Run job that prepares the database.
COPY --from=build --chown=app:app /app/dist-scripts ./dist-scripts
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/data/generated ./data/generated
RUN mkdir -p /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 8080
CMD ["node", "server.js"]
