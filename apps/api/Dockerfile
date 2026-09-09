# The API tier: the Hono surface as its own process. Build context is the
# REPO ROOT (see docker-compose.yml), because the app depends on workspace
# packages (contract, github, persistence including drizzle/ migrations,
# brief-core, types) and runs from TypeScript source via tsx, so there is no
# emit step to prune down to.
FROM node:22-alpine

# corepack pins pnpm to the workspace's `packageManager` field.
RUN corepack enable

# Run as the image's unprivileged user; the API needs no root capability.
WORKDIR /app
RUN chown node:node /app
USER node

# Source (filtered by .dockerignore), then the API's dependency closure. See
# the worker Dockerfile for why this is a plain filtered install rather than a
# pnpm-fetch split.
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --filter api...

EXPOSE 3001

# Boot order (app schema -> queue schema -> listen) is owned by the process
# itself; both migrators are idempotent.
CMD ["pnpm", "--dir", "apps/api", "start"]
