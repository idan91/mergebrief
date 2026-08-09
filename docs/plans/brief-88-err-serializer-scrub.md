# Plan — BRIEF-88: Scrub URL-shaped secrets in the shared err serializer

> Status: **LOCKED — grill closed 2026-07-31, not started.**
> Ticket: Notion BRIEF-88 (Now). One correction to the ticket text is
> recorded below (web-boot leak path was already caught, not uncaught).
> No ADR: scrubbing *extends* the logging boundary's redaction, and
> `packages/logging/AGENTS.md` records extension as non-breaking; only
> narrowing needs an ADR 0034 amendment. AGENTS.md gains the invariant.
> Design is settled — execution PR, no Fable needed.

## What this delivers

Today `packages/logging` redacts secrets by key path only; pino's stock
`err` serializer writes `err.message`/`err.stack` verbatim, and copies
every enumerable own prop of the error onto the log line. A pg/drizzle
error quoting `DATABASE_URL` reaches NDJSON output at three live sites
(`apps/web/src/server/webhookApp.ts:118` idle-pool warn,
`apps/web/src/server.ts:66` composition-failure catch,
`packages/worker/src/main.ts:109` boot catch — the last via `msg`, not
`err`). After this plan, URL-shaped substrings are scrubbed inside the
boundary itself — every call site, present and future, is covered by
construction, and the one call-site workaround
(`sanitizeDispatchError` in `apps/web/src/data/apiFetch.ts`) is deleted.

## Locked decisions (grill 2026-07-31 — do not re-litigate)

1. **Deep walk, not message+stack only.** The custom serializer wraps
   `stdSerializers.err`, then recursively scrubs **every string field**
   of the result — nested objects, `aggregateErrors`, copied enumerable
   props (pg `detail`/`where`/`internalQuery`, octokit `request`).
   Rationale: pino's prop-copying is the same structural blindness the
   ticket exists to kill. Cause chains are already folded into
   message/stack by pino (`messageWithCauses`/`stackWithCauses`).
2. **Non-Error inputs are scrubbed too.** pino returns non-error-like
   values unchanged (`isErrorLike` guard); our deep walk runs on the
   serializer *output* regardless of input shape, so
   `throw "connect postgres://..."` is covered. This is what makes
   decision 6 (collapse) safe.
3. **Full-URL redaction**: `\w+:\/\/\S+` → `[redacted-url]` (same
   pattern and placeholder as `sanitizeGenerationError` in
   `packages/persistence/src/stores/generation.ts`). Not
   credentialed-only: query-string tokens (`?access_token=…`) have no
   userinfo shape. Accepted cost: benign URLs (octokit `request.url`)
   are redacted; sites needing endpoint visibility log it deliberately
   as a structured field.
   *Revisit trigger:* operators repeatedly missing endpoint URLs during
   error triage → revisit with a userinfo+query-only variant.
4. **`msg` is scrubbed too**, in the boundary's `wrap()` — same regex, one
   `replace` per line. msg content is not author-controlled: `${…}`
   interpolation drags third-party error text in at runtime (~15 such
   sites exist; `worker/main.ts:109` proved the leak). Substring
   replace only — never drops the message.
5. **No dev toggle.** No env flag to disable scrubbing; OSS users can
   patch the source if they truly need raw output.
   *Revisit trigger:* dev debugging blocked by a redacted URL more than
   once → add an escape hatch honored **only** when
   `NODE_ENV=development` (the same switch that picks pino-pretty).
6. **Serializer registered under both `err` and `error` keys.** All 8
   current sites use `err:`, but an `error:` slip-up today hits pino's
   default JSON path — non-enumerable message/stack silently dropped,
   enumerable props (leak path) emitted. One line kills both.
7. **Bypass-site fix in scope**: `packages/worker/src/main.ts:109`
   changes from `logger.error(error.message)` to
   `logger.error("worker boot failed", { err: error })`.
8. **`sanitizeDispatchError` collapse in scope** (final commit): delete
   the function, pass the raw error as `err`; the boundary now owns the
   guarantee. The ticket names this as the follow-up — it lands here.
9. **Docs**: `packages/logging/AGENTS.md` invariant added — "the `err`/
   `error` serializers and `msg` are substring-scrubbed for URL-shaped
   secrets; the scrub runs post-serialization over all string fields."
   No ADR 0034 amendment (extension, not narrowing).

## Ticket correction (recorded, ticket stands otherwise)

The ticket's second named site ("`packages/persistence/src/db/migrate.ts`
migrate errors") leaks through **catch blocks in the startup wiring**,
not through migrate.ts itself: `apps/web/src/server.ts:66` logs the raw
error under `err` (serializer fix covers it), and
`packages/worker/src/main.ts:109` interpolates it into `msg` (decision 7
covers it). The web dev/SSR path (`dispatchInProcess`) already catches
and sanitizes. There is **no uncaught-to-stderr gap** — no new catch
blocks are needed anywhere.

## Shape: one PR, four chunked commits

Single PR (`feature/BRIEF-88/err-serializer-scrub` off `main`).
Estimated total ≈ 250–400 changed LOC — well under the 500 ideal.
Not a generation surface — **no eval-harness run** (root CLAUDE.md gate
does not fire).

| # | Commit | Content | Est. LOC |
|---|--------|---------|----------|
| 1 | `feat(logging): scrub URL-shaped secrets in err serializer + msg` | Scrubbing serializer (wrap `stdSerializers.err`, deep-walk strings, recurse `aggregateErrors`), msg scrub in `wrap()`, register under `err` + `error`; tests via `captureDestination` NDJSON asserts | ~200–300 (mostly tests) |
| 2 | `fix(worker): boot errors ride err field, not msg` | `main.ts:109` one-liner + test if harness allows | ~10 |
| 3 | `refactor(web): collapse sanitizeDispatchError onto the seam` | Delete function + `SanitizedError` type, pass raw error; adjust its tests | ~40 |
| 4 | `docs(logging): record substring-scrub invariant` | AGENTS.md invariant line | ~5 |

Test cases commit 1 must cover: message scrub; stack scrub (frames kept,
first line redacted); cause-chain text (folded into message/stack);
enumerable prop scrub (pg-style `detail`); nested object prop; deep-walk
recursion depth guard (self-referential errors — pino's `seen` tag
handles cycles pre-walk, but the walk itself needs a cycle guard);
`aggregateErrors`; non-Error input (string with URL); msg interpolation
scrub; benign-text passthrough (no URL → byte-identical); `error:` key
registration; placeholder is exactly `[redacted-url]`.

## Execution recommendation

- **Model/effort**: Opus 5, high effort, main thread, sequential —
  execution-heavy with design fully locked (per the plan-model
  convention: Fable for design-thinking PRs, Opus for execution).
  Single PR ⇒ no subagent fan-out.
- **Mandatory skills**: `typescript-eng` (strict TS conventions),
  `tdd` (serializer behavior test-first against captured NDJSON),
  `git-eng` for **all** git operations.

## git-eng requirements (gathered 2026-07-31, binding)

- Branch `feature/BRIEF-88/err-serializer-scrub` off `main`.
- **Chunked commits** per the table above; agent commits.
- **Pre-commit gate: `security-reviewer`** on staged changes before
  every commit; findings ≥80 confidence → fix, re-stage, re-run until
  clean. (No performance-reviewer — declined at grill.)
- No `Co-Authored-By` trailers; no AI-attribution in the PR body.
- PR title: `[BRIEF-88] feat: Scrub URL-Shaped Secrets in the Shared
  Err Serializer`; body per repo template; base `main`; push via `gh`.
- Post-PR: fable-reviewer loop per repo convention (medium+ findings
  iterate; low/nitpick-only pass = clean, note in PR body).

## Verification

```sh
pnpm -C packages/logging typecheck && pnpm -C packages/logging test
pnpm -C packages/worker typecheck   # commit 2
pnpm -C apps/web typecheck && pnpm -C apps/web test   # commit 3
pnpm lint
```

CI is path-filtered: logging change does not run worker/web suites —
run them locally before pushing (root CLAUDE.md, BRIEF-23 lesson).
