# CLI commands for remaining catalog operations (BRIEF-201)

## Context

The Review Session server (BRIEF-197) is merged; 20 operations in
`packages/cli/product-operations.map.json` carry gap entries citing BRIEF-201.
This plan ships the `mergebrief` command surface for 19 of them and
reclassifies one, emptying the gap list and unblocking BRIEF-199 (agent skill).

All design decisions are locked (grill 2026-08-21, recorded on the ticket):
no open questions remain — this is execution.

## Locked decisions (from the grill)

- **19 commands ship; `create-inline-comment` → `webOnly`** — under ADR 0040
  an agent drives the draft flow; direct inline posting is the web's
  affordance. The map entry carries that written rationale.
- **Taxonomy** (mirrors the app flow):
  - Flat reads: `session`, `marks`, `narrative`, `context`
  - Noun groups: `draft create|update|reanchor|delete`,
    `risk dismiss|address|reopen`, `thread resolve|unresolve`
  - Singles: `chunk-read`, `reclassify`, `outcome`, `ready`, `generate`,
    `collaborators`
- **Payload conventions**: convenience flags XOR `-F` (the `submit` pattern,
  exit 2 on mix); risk ops take `-F` **required** for the flags array plus a
  `--reason` convenience on `dismiss` (exit 2 if the payload also carries
  `reason`); `--side` defaults to `new`; `--base`/`--head` required on every
  session-scoped command via the existing `requireSpan` (exit 2).
- **Passthrough posture unchanged**: server owns validation (4xx → exit 5),
  receipts relay verbatim, exit contract additive-only.
- `generate` runs with no confirm prompt; `outcome` (session intent) and
  `submit --outcome` (publish) both stay.
- **Out of scope**: two-side (mixed-range) anchors — BRIEF-218, non-blocking.

## Command → operation map

| Command | Operation | Endpoint |
| --- | --- | --- |
| `session <pr>` | read-review-session | GET …/session |
| `marks <pr>` | read-marks | GET …/marks |
| `narrative <pr>` | read-narrative | GET …/narrative |
| `context <pr>` | read-brief-context | GET …/brief-context |
| `draft create <pr>` | create-draft-comment | POST …/session/comments |
| `draft update <pr> <draftId>` | update-draft-comment | PATCH …/session/comments/:draftId |
| `draft reanchor <pr> <draftId>` | reanchor-draft-comment | PUT …/session/comments/:draftId/anchor |
| `draft delete <pr> <draftId>` | delete-draft-comment | DELETE …/session/comments/:draftId |
| `chunk-read <pr> <chunkId>` | set-chunk-read | PUT …/session/chunks/:chunkId/read |
| `risk dismiss <pr>` | dismiss-risk | POST …/session/risks/dismiss |
| `risk address <pr>` | address-risk | POST …/session/risks/address |
| `risk reopen <pr>` | reopen-risk | POST …/session/risks/reopen |
| `thread resolve <pr> <commentId>` | resolve-thread | POST …/comments/:commentId/resolve |
| `thread unresolve <pr> <commentId>` | unresolve-thread | POST …/comments/:commentId/unresolve |
| `reclassify <pr> <groupId>` | reclassify-group | PUT …/session/groups/:groupId/classification |
| `outcome <pr>` | set-review-outcome | PUT …/session/outcome |
| `ready <pr>` | mark-ready | POST …/ready |
| `generate` | generate-brief | POST /api/generate |
| `collaborators` | list-collaborators | GET /api/repos/:repoId/collaborators |
| — (webOnly) | create-inline-comment | POST …/comments |

Session-scoped commands (everything under `…/session/*`) carry
`--base`/`--head`. `thread`, `ready`, `generate`, `collaborators` do not —
their endpoints are not brief-addressed.

## Git requirements (git-eng — mandatory for ALL git operations)

- **Stacked branches** off `main`, one per PR:
  `feature/BRIEF-201/session-reads` → `feature/BRIEF-201/draft-commands` →
  `feature/BRIEF-201/dispositions` → `feature/BRIEF-201/surface-closeout`;
  each PR bases on its predecessor, first on `main`.
- **Chunked commits** per logical unit within each branch.
- **Pre-commit review gate**: `performance-reviewer` + `security-reviewer` on
  staged changes before every commit; findings ≥80 confidence fixed before
  committing.
- **No Co-Authored-By trailers; no AI-attribution in PR bodies.**
- PR titles `[BRIEF-201] feat: …`; unslop pass on every PR body.
- Per-PR review flow: reviewer subagent on each branch diff before
  publishing; Idan merges; squash-merge realign via `rebase --onto`.

## Mandatory skills

- `git-eng` — all git operations.
- `typescript-eng` — all code.
- `tdd` — contract tests first (runCli against the real API app via
  `app.request`, PGlite harness), then implementation to green.
- `ponytail` (active session-wide) — thin passthrough commands, no
  speculative abstraction.

## PR breakdown (4 stacked PRs, ~600–900 LOC each incl. tests)

### PR 1 — Session reads (`feature/BRIEF-201/session-reads`)

`session`, `marks`, `narrative`, `context` + their map.json entries.

- Extend `commands/read.ts` (or a co-located `session-read.ts` if read.ts
  crowds past its shape) with the four GET passthroughs; `session` takes
  `--base/--head` via `requireSpan`.
- **This PR establishes the session test harness**: seeding a brief +
  session rows in the PGlite-backed API app so contract tests can exercise
  `?base=&head=` addressing. Later PRs reuse it.
- Commander wiring in `program.ts`; map.json entries flip gap → command
  (`map:check` enforces reality).
- Estimate: ~250 src + ~400 test ≈ 650 LOC.
- **Model/effort**: Fable 5, high — pattern-setting (harness + command shape
  the stack clones). **Invocation**: main thread.

### PR 2 — Draft commands + chunk-read (`feature/BRIEF-201/draft-commands`)

`draft create|update|reanchor|delete`, `chunk-read`.

- New `commands/session-write.ts`: draft CRUD with convenience flags
  (`--file --side --start --end --body`, side defaults `new`) XOR `-F`;
  `chunk-read` with `--read/--unread`.
- Estimate: ~300 src + ~450 test ≈ 750 LOC.
- **Model/effort**: Opus 5, high — mechanical application of PR 1 patterns.
  **Invocation**: main thread, sequential after PR 1 (depends on harness).

### PR 3 — Dispositions (`feature/BRIEF-201/dispositions`)

`risk dismiss|address|reopen`, `thread resolve|unresolve`, `reclassify`,
`outcome`, `ready`.

- Risk ops: `-F` required (flags array), `--reason` convenience on dismiss
  with mutual exclusion; thread/ready are span-less POSTs; `reclassify
  --category`, `outcome <value>` scalar flags.
- Estimate: ~300 src + ~500 test ≈ 800 LOC.
- **Model/effort**: Opus 5, high. **Invocation**: main thread, sequential.

### PR 4 — Surface closeout (`feature/BRIEF-201/surface-closeout`)

`generate`, `collaborators`, the `create-inline-comment` webOnly flip, docs.

- `generate` (POST /api/generate, no prompt), `collaborators` passthrough.
- map.json: webOnly entry with ADR 0040 rationale; zero BRIEF-201 gaps
  remain — `map:check` green is the ticket's done condition.
- `agents-guide.ts` rewrite for the full surface (draft flow, span sourcing,
  side default, risk anchor copy-through) + README flag appendix
  (`docs:check`).
- Estimate: ~150 src + ~250 test + guide/README ≈ 600 LOC.
- **Model/effort**: Fable 5, high — the agents guide is the skill's contract
  (BRIEF-199 reads it); wording matters. **Invocation**: main thread.

## Implementation steps (each PR)

1. Branch off predecessor (git-eng).
2. TDD: write failing runCli contract tests (stdout/stderr/exit codes,
   span requirement, flag XOR `-F`, receipts verbatim).
3. Implement command modules + commander wiring to green.
4. Update `product-operations.map.json`; run `map:check`.
5. Gates: `pnpm -C packages/cli typecheck && test && build && docs:check &&
   map:check`, `pnpm -C packages/api manifest:check`, repo `pnpm lint`.
6. Pre-commit reviewers → chunked commits → reviewer on the branch
   diff → publish PR (unslopped body) → next PR.

## Verification (whole stack)

- `map:check` shows zero gap entries citing this ticket.
- `mergebrief --agents` documents every shipped command.
- No eval-harness run needed — no generation-surface files touched.
- Local consumer check: CLI has no dependents; api untouched except none.
