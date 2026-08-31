# Plan — BRIEF-202: Layer packages/api into handler, controller, repository

> Status: **LOCKED — wayfinder map closed 2026-08-23; overnight implementation
> authorized by Idan (review next morning; nothing merges unattended).**
> Tickets: Notion BRIEF-202 (wayfinder map + six decision tickets + closing act).
> ADR: **0041** — the single source for every design decision below; this plan
> does not restate rationale. Prep already on main: glossary entries
> (51fa716e, 0c4a3cff), invariant pins (#399), verb-first renames (#400).

## What this delivers

Every Product Operation route in `packages/api` (35 ops) converted to the
ADR 0041 convention: domain folders with `index/handler/controller/schemas/
utils/consts/types` + `logic/`, Hono-free controllers returning
`Result<T, XxxFailure>`, handlers throwing the `ApiError` class family,
`app.onError` as sole wire-error producer, `ReviewerGitHubClient` replacing
all nine copied refresh closures/variants. Zero wire change anywhere.

**The one proof obligation, every PR:** the full-URL `app.request` suites in
`packages/api/test/` stay byte-identical and green. A PR that needs a wire
suite edit is wrong — stop and re-derive.

## Git requirements (git-eng — mandatory for all git operations)

- Stacked branches off `main`: `refactor/brief-202-<nn>-<slug>`, each based
  on the previous branch; PR targets the previous PR's branch (PR 1 targets
  `main`). Idan merges upstream-first (squash); realignment after each merge
  uses `rebase --onto` with patch-id proof — never plain-pull a rebased
  branch. HTTPS + gh credential helper.
- Chunked logical commits per PR. No `Co-Authored-By` trailers, no AI
  attribution anywhere.
- Pre-commit review agents: `performance-reviewer` on every PR;
  `security-reviewer` additionally on PR 2 (auth), PR 3 (authz/webhook),
  and PR 8-9 (pr-writes). Findings ≥80 confidence fixed before commit.
- Per-PR post-push review: `reviewer` subagent on the branch diff;
  medium+ findings fixed; 2-round budget (nitpick-only = clean).
- PR titles: `[BRIEF-202] refactor: <Title Case>`; bodies get an unslop
  pass; no template in repo — Overview/Changelog shape.

## Specialist skills (mandatory during implementation — user-confirmed)

`typescript-eng` (all parts). `tdd` for the new colocated unit tier:
controller and `logic/` tests are written test-first (red-green) as each
domain converts — the wire suites are NOT part of the TDD loop and must not
change. `verify` for a final end-to-end runtime pass after the last stack.

## Sequencing — 11 PRs, one chain

Diff budgets assume conversion ≈ old + new for rewritten files. Ideal
<500 changed LOC, ceiling ~1,000. **Measure `git diff --stat <base>` after
every part-commit**; a fired split trigger is acted on, never noted.

| # | Branch slug | Contents | Est. diff LOC | Split trigger |
|---|---|---|---|---|
| 1 | 01-foundations | `src/shared-errors/` (ApiError base + 9 subclasses, `CodeFor<status>`), `app.onError` producer (errorJson survives inside; sets `apiErrorCode`), sanitized-500 path, unit tests. No call-site conversion. | ~400 | — |
| 2 | 02-auth | `routes/auth/` → auth domain folder; `createReviewerGitHubClient` (+unit tests) beside `refreshSessionToken`; session/oauth/logout handlers convert to throws. | ~900 | installations+tokens overflow → they move to PR 2b |
| 3 | 03-authz | `authz.ts` gate + scope seam + missing-principal convert to posture-final throws (audit stamps kept); `allowed-repos` adopts ReviewerGitHubClient; webhook errorJson exits (6) → throws. | ~700 | webhook conversion overflow → rides PR 4 instead |
| 4 | 04-small-domains | `repos/` (+collaborators), `pulls/`, `capabilities/`, `generate/` domain folders; generate's 3 spendRefresh sites → client. | ~900 | generate overflow → own PR 4b |
| 5 | 05-installations-tokens | auth PR 2's overflow if fired; else SKIPPED (fold into 2). | ~600 | — |
| 6 | 06-pr-reads-a | `repos/pr/` reads: brief, delta, narrative, marks (+ shared read machinery to `logic/`). | ~900 | >1,000 → move marks to 7 |
| 7 | 07-pr-reads-b | reads: diff (client adoption), pull, brief-context; `conversation.ts`; `pr-view.ts` where free. | ~900 | — |
| 8 | 08-pr-writes-comments | `comments.ts` → comments ops (create-inline, reply, resolve, unresolve): controller + `github-denied` phase mapping; 9 spendRefresh sites die. | ~1,000 | >1,000 → resolve/unresolve split out |
| 9 | 09-pr-writes-review-ready | `review.ts` + `ready.ts`: submit-review, mark-ready; honest-403 judgments stay in handlers. | ~900 | — |
| 10 | 10-session-machinery | Session subtree: `brief-target` splits, `write-resolve` dissolves into controller (`{ok:false, response}` dies), `carry-facts`/`payload`/`attention` → `logic/`, `write-input` → `schemas.ts`. | ~1,000 | >1,000 → ops files defer to 11 |
| 11 | 11-session-ops-ratchet | Session op handlers conform; **final separate commit: api lines floor 75 → 85** (never coupled into a refactor commit). | ~700 | — |

Order within the chain is fixed (each PR builds on the previous). File→op
mapping is verified against the manifest at each PR's start, not trusted
from this table.

## Model / effort / invocation per part

| Part | Model + effort | Invocation |
|---|---|---|
| PR 1 (foundations — `CodeFor<status>` type design everything copies) | Fable 5, high | Main thread |
| PRs 2-9 (locked-design conversions; gates + invariant pins do the guarding) | Fable 5, medium (Opus 5 fallback on quota, noted per PR) | Main thread, sequential (stack dependency) |
| PR 10 (session machinery dissolve — subtlest code, partly outside wire pins) | Fable 5, high | Main thread |
| PR 11 (session ops + ratchet) | Fable 5, medium | Main thread |
| Reviews | reviewer (Fable 5) per PR | Subagent, after each push |

Medium-effort rule: a judgment call not covered by a pin (an unpinned
posture site, an ambiguous failure mapping) stops the run — never
improvised at medium.

## Per-PR verification (all must pass before push)

```sh
pnpm -C packages/api typecheck && pnpm -C packages/api test
pnpm -C packages/api manifest:check
pnpm lint
git diff <base> --stat -- packages/api/test/   # MUST be empty
```

No new wire codes are minted, so the i18n and apps/web mirrors stay
untouched; if any PR finds itself editing them, it has drifted — stop.
No generation surface is touched — no eval spend.

## Out of scope (from the map)

Webhook internals beyond the mechanical throw conversion; worker-side
persistence consistency; ApiError outside packages/api; rate limiting;
repo-wide test-colocation for other packages; infra routes beyond free
conformance.
