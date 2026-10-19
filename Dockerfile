# syntax=docker/dockerfile:1
# The one image a release ships: api, web and worker, each started by one
# word (see docker-entrypoint.sh). Build context is the REPO ROOT: every app
# depends on workspace packages and the api and worker run from TypeScript
# source via tsx, so the image is a full workspace checkout with its
# dependency closure, built once and copied into a stage per target platform.
# The install and the web build run on the builder's own platform; the tree
# is copied unchanged into the linux/amd64 and linux/arm64 stages, so the
# install must carry BOTH platforms' native binaries (esbuild under tsx,
# rolldown under vite). pnpm's supportedArchitectures does that; it is set
# inside the builder only, so a developer's host install stays its own
# platform's. An alpine (musl) base is part of that contract: the installed
# bindings are the musl ones, so a glibc NODE_IMAGE would boot without them.
ARG NODE_IMAGE=node:24-alpine

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS builder

# corepack pins pnpm to the workspace's `packageManager` field.
RUN corepack enable

WORKDIR /app
RUN chown node:node /app
USER node

# Source (filtered by .dockerignore), then the dependency closure of the
# three apps. Deliberately NOT the lockfile-first `pnpm fetch` split: a source
# change does invalidate this layer, but image builds are per release and a
# plain filtered install is the proven path (pnpm fetch stalls under some
# BuildKit/network setups).
COPY --chown=node:node . .
RUN printf '\nsupportedArchitectures:\n  os: [linux]\n  cpu: [x64, arm64]\n  libc: [musl]\n' >> pnpm-workspace.yaml \
  && pnpm install --frozen-lockfile \
  --filter api... \
  --filter worker... \
  --filter @code-review/web...

# `vite build` produces dist/server/server.js and dist/client; `src/serve.ts`
# serves them at runtime: the whole web tier, no CDN.
RUN pnpm --dir apps/web build

FROM ${NODE_IMAGE}

WORKDIR /app
COPY --from=builder --chown=node:node /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Stamped by the release workflow from the git tag; a local build says `dev`
# and never checks for releases. After the big copy, so a re-stamp of an
# unchanged tree reuses that layer.
ARG MERGEBRIEF_VERSION=dev
ARG MERGEBRIEF_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Idan91/code-review" \
  org.opencontainers.image.version="${MERGEBRIEF_VERSION}" \
  org.opencontainers.image.revision="${MERGEBRIEF_REVISION}"
ENV SERVER_VERSION=${MERGEBRIEF_VERSION}

# Runtime marker: this image ships no harness CLI binaries, so the worker
# refuses claude-code/codex with a targeted message, and a check-only boot
# names `docker compose run --rm api migrate` as the manual step.
ENV MERGEBRIEF_RUNTIME=compose-worker

# The image's unprivileged user; no service needs a root capability.
USER node

EXPOSE 3000 3001

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["api"]
