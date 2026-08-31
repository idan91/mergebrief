# Exhaustive wire-code maps in web transports (BRIEF-214)

## In short

The problem: five places in the web app translate server error codes into
messages for the reviewer, and each one ends with a catch-all that turns
anything it doesn't recognise into "try again shortly". When the server grows
a new error code, that advice is usually wrong and sometimes harmful. It
already happened once, a reviewer was told to retry an error that no retry
could ever fix.

The goal: make it impossible for a new error code to slip through silently.
Adding one should break the build until someone decides what each of the five
places says for it.

The main idea: replace each catch-all chain with a lookup table that must
cover every known error code, which TypeScript enforces at compile time.
Behaviour today stays exactly the same. The only change is that every code now
has a deliberate, visible answer, and a new code forces five explicit
decisions instead of zero.

## Context

Five web transports map `ApiErrorCode` → result kind with an `if`-chain that
ends in a bare `return { kind: "upstream" }`:

- `apps/web/src/features/pulls/transport/postComment.ts:107`
- `apps/web/src/features/pulls/transport/submitReview.ts:68`
- `apps/web/src/features/pulls/transport/markReady.ts:65`
- `apps/web/src/features/conversation/reply.ts:53`
- `apps/web/src/features/conversation/resolve.ts:85`

A new wire code lands in the `ApiErrorCode` mirror (`apps/web/src/data/apiFetch.ts`,
drift-pinned by `apiFetch.test.ts`) and silently becomes "try again shortly" in
every transport. This already bit once: `draft-anchor-orphaned` fell into
postComment's fallback and told the reviewer to retry a refusal no retry clears.

## Decisions (locked on the ticket, wayfinder 2026-08-20)

| # | Decision |
|---|----------|
| Approach | **Total-over-vocabulary map per transport**, NOT the per-route emitted-set contract the ticket sketched. `codeForStatus` in `apiFetch.ts` synthesizes codes from bare statuses (proxy pages, codeless bodies), so the client can receive any vocabulary member regardless of what the route emits; and `apps/web` deliberately hand-mirrors the wire vocab with drift pins rather than depending on `packages/api`. |
| Mechanism | Per transport: `const KIND_FOR_CODE = { … } satisfies Record<ApiErrorCode, FailureKind>` (const map per repo convention), consumed as `return { kind: KIND_FOR_CODE[code] }`. Every failure kind in all five transports is payload-less, so the single return works. A new mirror member → all five maps fail to compile → forced per-transport decision. |
| Unions unchanged | Result unions keep their exact current members. Widening a union (new UI copy) is UI scope, not this ticket. |
| Assignments | Preserve current behaviour for every previously-recognized code. Previously-swallowed codes get **deliberate** `upstream` assignments — except where the transport already has a semantically-correct kind (`markReady`/`resolve` already fold `forbidden` into `github-permission`; keep). `malformed` is never produced by `errorFromResponse` but is in the union — assign `upstream` with a one-line "never on wire" comment rather than contorting the types. |
| Runtime caveat | A genuinely-unknown code on the wire (server ahead of mirror) still falls back to `codeForStatus` buckets inside `errorFromResponse` — by design. The compile-time gate bites when the mirror updates, which the drift pins force alongside any vocab change. |

**No ADR** — mechanical hardening of an existing contract, no trade-off.

## Mandatory skills + git requirements

- **Skills (user-confirmed, mandatory):** `typescript-eng`, `tdd`. `git-eng`
  must be invoked explicitly for all git operations.
- **Branch:** `feature/BRIEF-214/exhaustive-wire-code-maps` off `main`.
- **Commits:** chunked (one per logical unit); no `Co-Authored-By` trailers,
  no AI attribution anywhere.
- **Pre-commit gates:** `security-reviewer` + `performance-reviewer` in
  parallel on staged diff before every commit; fix ≥80-confidence findings,
  re-run until clean.
- **Pre-PR:** `reviewer` adversarial pass on the branch diff before
  `gh pr create`.
- **PR:** title `[BRIEF-214] fix: Exhaustive Wire-Code Maps In Web Transports`,
  base `main`, standard Overview/Changelog body (no Images section — no visual
  change). Idan merges.

## Implementation (one subtask, one PR)

Estimated ~350–450 changed LOC (5 maps ≈ 30 lines each + tests) — single PR,
well under ceiling. **Invocation:** main thread, sequential, Fable 5 high
(current session); too small to split or subagent.

Per transport, TDD order:

1. **Tests first** (extend the existing `*.test.ts` beside each transport):
   pin the mapping for every code that previously fell into the catch-all —
   at minimum one representative per bucket plus every code with a non-`upstream`
   assignment. Keep existing tests green (behaviour of recognized codes is
   unchanged).
2. Replace the `if`-chain with the const map + single return. Move the
   load-bearing 409-semantics comments onto the relevant map entries; keep
   them one-line (lean-comments rule).
3. `satisfies Record<ApiErrorCode, …>` is the gate — verify by adding a
   scratch member to the mirror locally and confirming five compile errors,
   then revert (do not commit the scratch member).

Order (one commit each, shared-shape first so later transports copy it):
`postComment.ts` → `submitReview.ts` → `markReady.ts` → `reply.ts` →
`resolve.ts`. No shared helper module: kinds differ per transport and a
generic mapper would be an unrequested abstraction.

Close-out: full `pnpm test` + lint in `apps/web`, reviewer pass, PR up,
move BRIEF-214 to In review.
