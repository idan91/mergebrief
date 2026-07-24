# BRIEF-54 — Merge guide

> Living doc for the BRIEF-54 stack. Updated as PRs evolve; final after PR 4.
> Plan: `docs/plans/brief-54-intent-check.md`.

## Stack shape

```
main
└─ feature/brief-54-intent-schema      PR 1  #147  brief-core schema/prompt/validation
   ├─ feature/brief-54-eval-cases      PR 2  #148  eval intent cases + adversarial fixture
   └─ feature/brief-54-intent-bar      PR 3  web intent bar (Sonnet session)
      └─ feature/brief-54-modal-line   PR 4  mark-ready modal line (Sonnet session)
```

PR 2 and PR 3 are siblings on PR 1; PR 4 stacks on PR 3.

## Merge order

1. **PR 1** (#147, `feature/brief-54-intent-schema`) — squash-merge to main first.
2. **PR 2** (#148, `feature/brief-54-eval-cases`) and **PR 3**
   (`feature/brief-54-intent-bar`) — either order, after PR 1.
3. **PR 4** (`feature/brief-54-modal-line`) — after PR 3.

## Per-merge stack rebase (squash-merge discipline)

Squash-merge rewrites history: never plain-pull a stacked branch afterwards
(git-push-workflow memory). After **each** squash-merge, rebase the remaining
branches onto the new main with `--onto`, dropping the merged PR's commits:

After **PR 1** merges:

```sh
git fetch origin
# PR 2:
git checkout feature/brief-54-eval-cases
git rebase --onto origin/main feature/brief-54-intent-schema
git push --force-with-lease
# PR 3:
git checkout feature/brief-54-intent-bar
git rebase --onto origin/main feature/brief-54-intent-schema
git push --force-with-lease
# PR 4 (follows its parent):
git checkout feature/brief-54-modal-line
git rebase --onto feature/brief-54-intent-bar <old-pr3-head>
git push --force-with-lease
```

(`<old-pr3-head>` = PR 3's tip BEFORE its rebase — take it from
`git rev-parse feature/brief-54-intent-bar` first, or use
`git rebase --onto feature/brief-54-intent-bar feature/brief-54-intent-bar@{1}`.)

After **PR 3** merges:

```sh
git checkout feature/brief-54-modal-line
git rebase --onto origin/main feature/brief-54-intent-bar
git push --force-with-lease
```

PR 2 is independent of PRs 3/4 — its merge requires no rebase of them
(they don't contain its commits) unless GitHub reports conflicts.

## Post-merge: eval rebaseline on main (PR 1 drift)

PR 1 changes the generation surface (schema + prompt), so every eval case's
output gains `intentCheck` and the committed baselines drift. Per convention
(root `CLAUDE.md` / BRIEF-59): rebaseline **on main only**, after PR 1 (or
PR 1+2 together) lands:

```sh
git checkout main && git pull
pnpm -C tools/categorizer eval -- --rebaseline   # live API spend
# commit the moved baselines straight to main (docs/eval housekeeping)
```

If PR 2 is close behind PR 1, prefer ONE rebaseline after both merge —
saves a duplicate live run. The four `intent-*` cases were baselined
fresh on the PR 2 branch (all 16 properties stable-pass 5/5) — the
post-merge rebaseline is for the SIX pre-existing cases' drift (every
case's output gains `intentCheck`), not the intent cases.

## Known conflicts / fixups discovered while stacking

- **Schema amendment (PR 1, 2026-07-24):** the grill-locked three-shape
  factoring overflowed Anthropic's structured-output grammar limit (`400
  compiled grammar is too large` — structural budget: exactly one object shape
  beyond the base schema fits under the production request shape, and the
  budget is tighter with adaptive thinking than without; ALL 30 eval runs
  failed while the harness still exited 0, the BRIEF-59 vacuous-pass trap).
  All three buckets now share one `IntentItemSchema` `{intent, quote,
  sourceUrl, groupIds}`; per-bucket rules are validator-enforced
  (statedButMissing: groupIds emptied; doneButUnstated: quote/sourceUrl
  emptied, description rides `intent`). Plan doc decision 2 carries the full
  amendment block. PRs 3/4 consume `IntentItem` (there is no
  `StatedAsk`/`AccomplishedAsk`/`UnstatedWork` type).

## Verification after each merge

```sh
pnpm -C packages/brief-core typecheck && pnpm -C packages/brief-core test
pnpm -C apps/web typecheck && pnpm -C apps/web test
pnpm -C packages/worker test        # PR 1 contract consumers (path-filtered CI gap)
pnpm lint
```

Post-PR-4: `/verify` smoke per `docs/plans/brief-54-testing-guide.md`.
