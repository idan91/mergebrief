# The long-lived generation worker (BRIEF-3, ADR 0015). Build context is the
# REPO ROOT (see docker-compose.yml) — the worker is a workspace package and
# needs its workspace siblings (persistence incl. drizzle/ migrations, github,
# brief-core, types) present at runtime: packages run from TypeScript source
# via tsx, so there is no emit step to prune down to.
FROM node:22-alpine

# corepack pins pnpm to the workspace's `packageManager` field.
RUN corepack enable

# Run as the image's unprivileged user; the worker needs no root capability.
WORKDIR /app
RUN chown node:node /app
USER node

# The source (filtered by .dockerignore), then the worker's dependency
# closure (worker + its workspace deps). Deliberately NOT the lockfile-first
# `pnpm fetch` split: a source change does invalidate this layer, but
# self-host image builds are rare and a plain filtered install is the proven
# path (pnpm fetch stalls under some BuildKit/network setups).
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --filter worker...

# Boot order (migrate app schema -> migrate queue schema -> run) is owned by
# the worker itself (`startWorker`); both migrators are idempotent.
CMD ["pnpm", "--dir", "packages/worker", "start"]
