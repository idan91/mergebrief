# packages/logging — agent notes

The structured-logging boundary. Exports a minimal `Logger` interface and `createLogger` — the ONE place pino is constructed. Every process (web server, worker, CLI-facing API) builds one logger at its startup wiring and injects it; call sites depend on this package only.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

**Entry point: `src/index.ts`** — the package's process-side export (`package.json` `exports["."]`). `logging/sanitize` is the browser-safe pure subpath; it must never import `logger.ts` or pino.

What the layout can't show:

- `sanitizeErrorDetail` (`sanitize.ts`) sanitizes free-form error text leaving the process: first line only, URLs redacted (`file://` included), tokens redacted, 300-char cap.
- `REDACT_PATHS` and the err serializer live in `logger.ts`.
- Tests inject `captureDestination` and assert on real NDJSON output.

## Invariants (enforced, don't weaken)

- **pino never leaks**: no pino type or value appears in an exported signature. A future OTel/metrics addition reimplements `Logger` without touching call sites.
- **Four levels only** — error/warn/info/debug (matches graphile-worker). No `fatal`: fatal moments log `error` and exit.
- **Secrets ride as structured fields, never in `msg`.** Redaction (`remove: true` — keys VANISH, no placeholder) covers the sensitive request headers plus the secret-key vocabulary at top level and one wildcard depth; see `REDACT_PATHS` in `logger.ts`. Extending the vocabulary is non-breaking; narrowing it needs an ADR amendment.
- **URL-shaped AND credential-shaped substrings are scrubbed**: the `err`/`error` serializers deep-scrub every string field of the serialized error (post-serialization, copy-on-write). `msg` gets the same two regexes: `\w+://\S+` → `[redacted-url]` (`file://` exempt, ESM stack frames) and issuer-prefixed tokens (`sk-ant-`, `sk-`, `ghp_`/`gho_`/…, `github_pat_`, `xox*-`, `mergebrief_`, `AKIA`) → `[redacted-token]`. Prefix matching, never entropy. Scope is err/error + msg ONLY: a secret under any other field name emits verbatim — structured secrets must ride the `SECRET_KEYS` vocabulary. No disable knob, deliberately. Narrowing either scrub (or widening the exemption) needs an ADR amendment.
- **The two mechanisms cover different threats, and both are needed.** Key-path redaction protects secrets WE hold and name (a `token` field); content scrubbing protects secrets EMBEDDED in prose we do not control (a provider's error text quoting the key it rejected). Message-only provider failure logs depend entirely on the content scrub.
- **One scrub vocabulary, two exits.** `scrub.ts` owns the patterns; the log boundary and `sanitizeErrorDetail` both consume them, so a credential closed on one path cannot leak through the other. They differ in exactly one respect: logs exempt `file://` (ESM stack frames), error detail does not (detail is never a stack).
- **`createLogger({ env })` is the composition seam**: `LOG_LEVEL` (default `info`) picks the level; format is NODE_ENV-decided (pino-pretty transport only when `development`). An unknown `LOG_LEVEL` throws — misconfiguration fails loudly at boot.
- **Framework-free**: no Hono, no graphile imports (the graphile adapter is structurally typed). The Hono request middleware lives in `packages/api`, deliberately outside this package.
- **String level labels** (`"level":"warn"`): part of the operator-facing line shape documented in `docs/self-host/observability.md`; changing the rendering is a breaking change post-OSS-cutover.

## Verification

`pnpm -C packages/logging typecheck` / `test`; repo-root `pnpm lint`.
