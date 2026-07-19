# The web/API tier (TanStack Start + the mounted Hono app). Build context is
# the REPO ROOT (see docker-compose.yml) — the app depends on workspace
# packages (api, github, persistence, brief-core, types).
#
# Serving model: `vite build` produces dist/server/server.js (the SSR + Hono
# fetch entry) and dist/client (static assets); `vite preview` is TanStack
# Start's own production-preview server, wiring that server bundle behind
# vite's static middleware. At self-host validation volume (ADR 0015) that is
# the whole web tier — no CDN, no separate static host.
FROM node:22-alpine

RUN corepack enable

# Run as the image's unprivileged user; port 3000 needs no root capability.
WORKDIR /app
RUN chown node:node /app
USER node

# Source, then the web app's dependency closure (see the worker Dockerfile
# for why this is a plain filtered install rather than a pnpm-fetch split).
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --filter @code-review/web...

RUN pnpm --dir apps/web build

EXPOSE 3000

CMD ["pnpm", "--dir", "apps/web", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
