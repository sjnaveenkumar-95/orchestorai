FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/openclaw/package.json packages/adapters/openclaw/
COPY packages/slack-bridge/package.json packages/slack-bridge/
COPY packages/slack-bot/package.json packages/slack-bot/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @orchestorai/ui build
RUN pnpm --filter @orchestorai/server build
RUN pnpm --filter @orchestorai/slack-bot check
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest
RUN useradd --create-home --home-dir /orchestorai --shell /bin/bash orchestorai \
  && mkdir -p /orchestorai \
  && chown -R orchestorai:orchestorai /orchestorai /app

ENV NODE_ENV=production \
  HOME=/orchestorai \
  HOST=0.0.0.0 \
  PORT=3100 \
  SLACK_PORT=3000 \
  SERVE_UI=true \
  ORCHESTORAI_HOME=/orchestorai \
  ORCHESTORAI_INSTANCE_ID=default \
  ORCHESTORAI_CONFIG=/orchestorai/instances/default/config.json \
  ORCHESTORAI_DEPLOYMENT_MODE=authenticated \
  ORCHESTORAI_DEPLOYMENT_EXPOSURE=private \
  ORCHESTORAI_API_URL=http://127.0.0.1:3100 \
  ORCHESTORAI_SLACK_ENABLED=false \
  CODEX_WORKDIR=/app \
  DATA_DIR=/orchestorai/slack-bot/data

VOLUME ["/orchestorai"]
USER orchestorai
EXPOSE 3100

CMD ["node", "scripts/run-stack.mjs", "production"]
