# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/web/package.json ./packages/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/web ./packages/web

RUN chown -R node:node /app
USER node

EXPOSE 3000

# Vite dev server — bind to 0.0.0.0 (O-R4) on port 3000.
CMD ["pnpm", "--filter", "@bill-pay/web", "dev"]
