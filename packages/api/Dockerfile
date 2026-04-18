# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Prisma on alpine needs openssl and libc6-compat so the schema engine binary
# resolves correctly (otherwise: "Could not parse schema engine response").
RUN apk add --no-cache openssl libc6-compat

# pnpm via corepack (§6.1.1).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/api/package.json ./packages/api/package.json

RUN pnpm install --frozen-lockfile

# Copy the rest of the workspace.
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

# Prisma generate — tsconfig.json exists under packages/api; `pnpm --filter`
# does the right thing from the workspace root.
RUN pnpm --filter @bill-pay/api exec prisma generate

# Uploads directory + ownership so the non-root `node` user can write (O-R3).
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads && chown -R node:node /app

USER node

EXPOSE 4000

COPY --chown=node:node packages/api/docker-entrypoint.sh /app/packages/api/docker-entrypoint.sh
RUN chmod +x /app/packages/api/docker-entrypoint.sh

ENTRYPOINT ["/app/packages/api/docker-entrypoint.sh"]
