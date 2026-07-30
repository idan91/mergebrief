# BRIEF-93 — Resolve/unresolve conversation threads

Implementation plan. Design locked in the 2026-07-29/30 grill (this doc is
the record). Ticket: BRIEF-93 (Next). No ADR required — extends locked
surfaces (ADR 0016 #4 viewer-token writes, ADR 0031 state-derived
affordances) without amending them. No generation surface is touched — the
eval harness does not run for this effort.

## Locked design

Reviewers resolve and unresolve review threads from inside the brief, via
GitHub's `resolveReviewThread` / `unresolveReviewThread` GraphQL mutations on
the viewer's OAuth token (existing scope suffices). Resolved threads collapse
into a slim "resolved" line; the full flow (read → reply → resolve → move on)
never leaves the brief.

Grill decisions, all final:

| Decision | Outcome |
| --- | --- |
| Resolved rendering | ALL resolved threads render as the slim meta row (prototype variant B): borderless ~22px row, 2px left tick, `resolved · @author · truncated excerpt · count` at faint weight, `align-items: center`; pure disclosure — no action buttons on the collapsed row. Extended hit area keeps the 44px target (WCAG 2.5.8) the full rows honor |
| Post-resolve behavior | on success the thread transitions live into the same slim-row state (refetched truth, not optimistic); no special-case animation contract |
| Affordances (GitHub model) | Resolve button at the bottom of an expanded unresolved thread, next to the composer; Unresolve at the bottom of an expanded resolved thread; **Reply & resolve** secondary composer action when text is non-empty (our one addition over GitHub) |
| Permission gating | buttons hidden unless the viewer can resolve (no dead controls, ADR 0031 pattern). Capability = `permissions.push` from the authz gate's existing viewer-token repo fetch, OR-ed with the existing server-derived `viewerIsAuthor`; rides the gate's positive cache (revocation lag ≤ existing TTL) and surfaces to the FE on the pr-view payload. GitHub's mutation-time enforcement stays the truth; a raced revocation maps to the clean error + refetch path |
| viewerCanResolve carrier | NOT fetched per-thread: the conversation read is a shared installation-token cache and must stay viewer-agnostic. Capability is PR-level, derived server-side (above) |
| Thread node id | never leaves `packages/github` (mark-ready convention): the op page-walks `reviewThreads` with lean fields (thread `id` + first comment `fullDatabaseId`) matching `rootCommentId`, then mutates. Same pagination cap as the conversation read |
| Convergence | already-in-target-state = success with `alreadyResolved`/`alreadyUnresolved` surfaced (mark-ready `alreadyReady` precedent); thread not found on the walk → existing not-found result kind; FE refetch reconciles either way |
| Reply & resolve composition | FE sequences the two existing endpoints (reply → on success, resolve). No combined route: the standalone route must exist anyway, and a combo route would duplicate the failure-mode test matrix to save one imperceptible RTT. Partial failure is honest: reply landed + resolve failed → error states it; the standalone Resolve button on the now-visible reply is the retry path |
| State update | mutation → invalidate/refetch the conversation query; no optimistic update. Route busts the shared conversation TTL cache on success (reply-write pattern) so the post-write refetch reflects the write |
| Chips | `threadStateChip` truth unchanged: outdated wins over resolved; resolved never dresses as success |
| Logging | plain leveled logging, structured fields; no new ADR 0034 `evt` names |

Revisit triggers recorded:

- **Grouped resolved stack** (prototype variant C, bot-group pattern): if
  slim-row stacks are still noisy on real PRs, fold consecutive resolved
  threads into one group row. Composes on top of B.
- **Combined server-side action route**: only if batched post-review actions
  ("resolve all addressed threads") ever land — one combo doesn't earn the
  compound-result contract.
- **Reply & resolve prominence**: if reply-then-resolve becomes the dominant
  close-out flow, consider promoting the combo to the primary composer action.

Design prototype (variant B won) was throwaway scratchpad HTML; this table is
the durable capture. Styling values live in the FE PR against real tokens.

## Git requirements (git-eng — MANDATORY for all git operations)

- Stacked branches off `main`, one per PR: `feature/BRIEF-93/<slug>`; each PR
  based on its predecessor; Idan merges (squash) — after each merge, rebase
  the remainder of the stack `--onto` main (squash-stack gotcha, brief-43
  memory).
- **Chunked commits** after each logical unit.
- **Pre-commit gate on every commit**: `performance-reviewer` +
  `security-reviewer` in parallel on staged changes; findings ≥80 confidence
  ⇒ fix, re-stage, re-run until clean.
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-93] <prefix>: Title Case`; ready-for-review (not draft).
- **Review loop per PR**: `fable-reviewer` looped until clean (clean = no
  critical/high/medium findings; low/nitpick-only pass = clean, note in PR
  body). **PR 2 additionally gets a `security-reviewer` pass on the branch
  diff** (authz-adjacent), looped on the same severity bar.
- Docs (this plan) commit straight to main (authorized docs flow).

## Mandatory specialist skills

- `typescript-eng` — all three layers; repo standards (no enum, `Result`
  for expected failures, named exports, extensionless imports).
- `test-driven-development` — op/route/FE behavior test-first.
- `web-accessibility` — FE PRs only: disclosure semantics, button naming,
  the 44px hit-target extension on the 22px slim row.

## PR spine (4 PRs, sequential stack)

**PR 1 — `[BRIEF-93] feat:` github op: resolve/unresolve review thread**
`packages/github/src/operations/resolve-thread.ts` (+ tests). Node-id
page-walk (lean fields, capped like the conversation read), both mutations,
converged-state mapping (`alreadyResolved`/`alreadyUnresolved`), not-found,
`mapGraphqlError` funnel. Mirrors `mark-ready.ts` structure.
~350–450 LOC. **Opus 5, high effort, main thread.**

**PR 2 — `[BRIEF-93] feat:` api: capability derivation + resolve routes**
Authz gate captures `permissions.push` from its existing repo fetch (context
+ positive cache); pr-view payload gains the PR-level can-resolve boolean
(derivation next to `viewerIsAuthor`); `POST` resolve/unresolve routes
(gated, viewer token lazy-decrypt + refresh-once, conversation cache bust,
sanitized errors, `no-store`); route tests incl. the convergence and
permission matrices. ~550–750 LOC. **Fable 5, high effort, main thread**
(authz-adjacent design judgment). Security-reviewer branch pass on top of the
per-commit gate.

**PR 3 — `[BRIEF-93] feat:` web: slim resolved-thread rows**
Variant B rendering in `ThreadRowView` + `rows.module.scss`: slim row for
`isResolved && !isOutdated` collapsed threads, 44px hit-area extension,
outdated rows unchanged. Rendering only — no new actions. Screenshots in the
PR body (BRIEF-44 pattern), Idan judges on real threads. ~250–400 LOC.
**Opus 5, medium effort, main thread.**

**PR 4 — `[BRIEF-93] feat:` web: resolve/unresolve actions + combo**
Transports for the two routes; Resolve/Unresolve buttons in `ThreadDetail`
(pending state, hidden without capability); Reply & resolve sequencing in the
composer wiring (three outcome states, partial-failure copy); query
invalidation on success; behavior tests. ~500–700 LOC. **Opus 5, high
effort, main thread.**

Sequential main-thread invocation throughout — each PR depends on its
predecessor's contract; no parallel subagent value. Measure diff-stat after
each part (LOC ceilings are hard gates; split triggers acted on, not noted).

## Implementation order & verification

1. PR 1 → PR 2 → PR 3 → PR 4, each: implement (TDD) → chunked commits w/
   gates → fable-reviewer loop (+security pass on PR 2) → push, PR up.
2. Per-package suites locally before each push — CI is path-filtered and
   will NOT run dependents (PR 2 consumes PR 1's parser shapes; PR 4
   consumes PR 2's route bodies).
3. After the stack is up: `/verify` end-to-end — resolve + unresolve a real
   thread from the brief, confirm GitHub reflects both, confirm the slim-row
   transition and the combo's partial-failure path (kill resolve leg by
   revoking write access mid-flow if practical, else unit-level only).
4. Post-merge: dev GitHub App smoke unchanged (no new App permissions).
