# packages/logging — agent notes

The structured-logging boundary. Exports a minimal
`Logger` interface and `createLogger` — the ONE place pino is constructed.
Every process (web server, worker, CLI-facing API) builds one logger at its
startup wiring and injects it; call sites depend on this package only.

## Map

**Entry point: `src/index.ts`** — the package's process-side export
(`package.json` `exports["."]`). `logging/sanitize` is the browser-safe pure
subpath; it must never import `logger.ts` or pino.

```
src/
  index.ts    ENTRY — sectioned re-exports = the public surface
  logger.ts   Logger interface (error/warn/info/debug + child),
              createLogger, resolveLoggerConfig (pure env → level/format),
              redaction paths, err serializer
  graphile.ts createGraphileLogFactory — adapter for graphile-worker's
              @graphile/logger (scope → child bindings)
  sanitize.ts sanitizeErrorDetail — boundary sanitizer for free-form error
              text leaving the process (wire params, DB columns): first
              line, URLs redacted (file:// included), tokens redacted,
              300-char cap
  scrub.ts    the content-scrub vocabulary (URL + credential patterns),
              shared by logger.ts and sanitize.ts so they cannot drift
test/         vitest suites; captureDestination injects a line-capturing
              sink so tests assert on real NDJSON output
```

## Invariants (enforced, don't weaken)

- **pino never leaks**: no pino type or value appears in an
  exported signature. A future OTel/metrics addition reimplements `Logger`
  without touching call sites.
- **Four levels only** — error/warn/info/debug (matches graphile-worker).
  No `fatal`: fatal moments log `error` and exit.
- **Secrets ride as structured fields, never in `msg`.** Redaction
  (`remove: true` — keys VANISH, no placeholder) covers the sensitive
  request headers plus the secret-key vocabulary at top level and one
  wildcard depth; see `REDACT_PATHS` in `logger.ts`. Extending the
  vocabulary is non-breaking; narrowing it needs an ADR amendment.
- **URL-shaped AND credential-shaped substrings are scrubbed**: the
  `err`/`error` serializers deep-scrub every string field of the serialized
  error (post-serialization, copy-on-write), and `msg` gets the same two
  regexes — `\w+://\S+` → `[redacted-url]` (`file://` exempt, ESM stack
  frames) and issuer-prefixed tokens (`sk-ant-`, `sk-`, `ghp_`/`gho_`/…,
  `github_pat_`, `xox*-`, `mergebrief_`, `AKIA`) → `[redacted-token]`.
  Prefix matching, never entropy: a heuristic would swallow ordinary prose.
  Scope is err/error + msg ONLY: a secret under any other field name emits
  verbatim — structured secrets must ride the `SECRET_KEYS` vocabulary. No
  disable knob, deliberately. Narrowing either scrub (or widening the
  exemption) needs an ADR amendment, like the vocabulary.
- **The two mechanisms cover different threats, and both are needed.**
  Key-path redaction protects secrets WE hold and name (a `token` field).
  Content scrubbing protects secrets EMBEDDED in prose we do not
  control — a provider's own error text quoting the key it rejected. Call
  sites that log provider failures message-only (deliberately avoiding the
  `err` field, whose cause chain can carry request contents) depend
  entirely on the content scrub.
- **One scrub vocabulary, two exits.** `scrub.ts` owns the patterns; the log
  boundary and `sanitizeErrorDetail` both consume them, so a credential
  closed on one path cannot leak through the other. They differ in exactly
  one respect: logs exempt `file://` (ESM stack frames), error detail does
  not (detail is never a stack).
- **Env is injected**: `createLogger({ env })` — this package never reads
  `process.env`. `LOG_LEVEL` (default `info`) picks the level; format is
  NODE_ENV-decided (pino-pretty transport only when `development`).
  An unknown `LOG_LEVEL` throws — misconfiguration fails loudly at boot.
- **Framework-free**: no Hono, no graphile imports (the graphile adapter is
  structurally typed). The Hono request middleware lives in `packages/api`,
  deliberately outside this package.
- **String level labels** (`"level":"warn"`): part of the operator-facing
  line shape documented in `docs/self-host/observability.md`; changing the
  rendering is a breaking change post-OSS-cutover.

## Conventions

Mirrors the sibling packages (root `AGENTS.md`): strict TS, no `enum`, no
bare `as`, named exports, extensionless relative imports.

## Verification

```sh
pnpm -C packages/logging typecheck
pnpm -C packages/logging test
pnpm lint                        # repo-root oxlint --type-aware
```
- **Hoist singleton accessors to module scope.** Assign `getServerLogger()` (or
  any singleton accessor) once at module scope — or once per composition
  function — and use the const. Calling the accessor at every log site is
  visual noise even when it is cached; deferring construction past module
  import is only justified when the accessor cannot do its own env lookup
  internally.
