# syntax=docker/dockerfile:1
# The one image a release ships: api, web and worker, each started by one
# word (see docker-entrypoint.sh). Build context is the REPO ROOT: every app
# depends on workspace packages, and api, worker and the web entry run their
# TypeScript source through tsx, a production dependency of each.
#
# Three stages. `builder` installs everything and builds the web bundle, which
# is plain JS and CSS; `runtime-deps` installs the same three apps' closure
# with `--prod` and prunes tests and Vite; the final stage copies an
# allow-list from both, so dev tooling, test suites, tools/ and eval cases
# never ship. Both install stages run on the builder's own platform.
# `runtime-deps` runs once per target and installs only that target's native
# binaries (esbuild under tsx) through pnpm's supportedArchitectures, set
# inside the build only, with install scripts off: esbuild's postinstall
# checks the HOST's binary, and none of the scripts matter at runtime. An
# alpine (musl) base is part of that contract: a glibc NODE_IMAGE would boot
# without the bindings.
ARG NODE_IMAGE=node:24-alpine

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS workspace

# corepack pins pnpm to the workspace's `packageManager` field.
RUN corepack enable

WORKDIR /app
RUN chown node:node /app
USER node

# Source (filtered by .dockerignore). Deliberately NOT the lockfile-first
# `pnpm fetch` split: image builds are per release and a plain filtered
# install is the proven path (pnpm fetch stalls under some BuildKit setups).
COPY --chown=node:node . .

FROM workspace AS builder

RUN pnpm install --frozen-lockfile \
  --filter api... \
  --filter worker... \
  --filter @code-review/web...

# `vite build` produces dist/server/server.js and dist/client; `src/serve.ts`
# serves them at runtime: the whole web tier, no CDN.
RUN pnpm --dir apps/web build

FROM workspace AS runtime-deps
ARG TARGETARCH

RUN cpu="$TARGETARCH" \
  && if [ "$cpu" = amd64 ]; then cpu=x64; fi \
  && printf '\nsupportedArchitectures:\n  os: [linux]\n  cpu: [%s]\n  libc: [musl]\n' "$cpu" >> pnpm-workspace.yaml \
  && pnpm install --frozen-lockfile --prod --ignore-scripts \
  --filter api... \
  --filter worker... \
  --filter @code-review/web...

# Vite arrives only as the TanStack build plugins' optional peer, which pnpm
# satisfies from web's own dev dependency. Nothing at runtime imports it: the
# web tier serves the built bundle.
RUN rm -rf node_modules/.pnpm/vite@* \
  && find node_modules/.pnpm -path '*/node_modules/vite' -type l -delete \
  && find node_modules/.pnpm -path '*/.bin/vite' -delete

# Test suites ride beside the source they test; none of them runs here.
RUN rm -rf apps/*/test apps/*/e2e packages/*/test \
  && find apps packages -type f \
    \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.mts' -o -name '*.snap' \) \
    -delete

FROM ${NODE_IMAGE}

WORKDIR /app
COPY --from=runtime-deps --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=node:node /app/packages ./packages
COPY --from=runtime-deps --chown=node:node /app/apps/api ./apps/api
COPY --from=runtime-deps --chown=node:node /app/apps/worker ./apps/worker
COPY --from=runtime-deps --chown=node:node /app/apps/web/package.json /app/apps/web/tsconfig.json ./apps/web/
COPY --from=runtime-deps --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
# The web process runs only its entry, its telemetry preload and the server
# modules they import; the rest of `src/` is already in the bundle.
COPY --from=runtime-deps --chown=node:node /app/apps/web/src/serve.ts /app/apps/web/src/instrument.ts ./apps/web/src/
COPY --from=runtime-deps --chown=node:node /app/apps/web/src/server ./apps/web/src/server
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The license travels with every redistributed copy, a published image included.
COPY --chown=node:node LICENSE ./LICENSE

# Stamped by the release workflow from the git tag; a local build says `dev`
# and never checks for releases. After the big copy, so a re-stamp of an
# unchanged tree reuses that layer.
ARG MERGEBRIEF_VERSION=dev
ARG MERGEBRIEF_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Idan91/mergebrief" \
  org.opencontainers.image.licenses="FSL-1.1-ALv2" \
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
