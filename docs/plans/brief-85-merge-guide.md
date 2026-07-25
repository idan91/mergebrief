# BRIEF-85 — Merge guide

> State as of 2026-07-25. Plan: `docs/plans/brief-85-intent-deviations.md`.
> #152 and #153 are already merged; this covers what remains.

## Stack shape

```
main  (has #152 generation surface, #153 eval fixtures)
├─ chore/BRIEF-85/rebaseline-intent-cases   #156  six baselines      base: main
├─ feature/BRIEF-85/intent-bar              #154  intent bar         base: main
   └─ feature/BRIEF-85/soft-gate-tension    #155  soft-gate line     base: #154
```

#156 is independent of #154/#155 — it touches only `tools/categorizer/eval`.

## Merge order

1. **#156** (baselines) — independent, merge any time. Merging it first means the
   next generation-surface change is gated from the start.
2. **#154** (intent bar) — already retargeted to `main`.
3. **#155** (soft gate) — after #154, and it needs a rebase first (below).

## ⚠️ Deleting a merged branch closes the PR stacked on it

This already happened once: deleting `feature/BRIEF-85/generation-surface`
after merging #152 **auto-closed #153**, because that branch was #153's base.

**Prevention** — before deleting a merged branch, retarget its child:

```sh
gh pr edit <child-pr> --base main
# only then delete the parent branch
```

**Recovery**, if a PR does get auto-closed. Both steps are required — GitHub
refuses to reopen a PR whose base branch is missing, *and* refuses if the head
SHA it recorded has been force-pushed away:

```sh
# 1. rebase the orphaned child onto main, dropping the squashed parent's commits
git rebase --onto origin/main <old-parent-tip> <child-branch>

# 2. recreate the deleted base at main's tip, purely so the PR can reopen
git push origin origin/main:refs/heads/<deleted-parent-branch>

# 3. rewind the child to the SHA the PR remembers, so reopen is accepted
git push --force-with-lease=<child-branch>:<current-sha> \
  origin <remembered-sha>:refs/heads/<child-branch>

gh pr reopen <child-pr>
gh pr edit <child-pr> --base main

# 4. re-apply the rebase, then remove the scaffold branch
git push --force-with-lease origin <child-branch>
git push origin --delete <deleted-parent-branch>
```

## Per-merge rebase (squash-merge discipline)

Squash-merge rewrites history: never plain-pull a stacked branch afterwards
(see the `git-push-workflow` memory). After **#154** merges:

```sh
git fetch origin
git checkout feature/BRIEF-85/soft-gate-tension
git rebase --onto origin/main <old-intent-bar-tip>
git push --force-with-lease
gh pr edit 155 --base main
```

`--force-with-lease` only. A bare `--force` is blocked by the repo's
destructive-action hook, correctly.

## Verify the rebase preserved content

A rebase should move commits without changing what they do. Prove it rather
than assuming — capture the patch-id before and after:

```sh
git diff <base> <tip> | git patch-id --stable   # before
# ...rebase...
git diff <new-base> <new-tip> | git patch-id --stable   # must match
```

This caught nothing during BRIEF-85 (all six rebases were identical), which is
exactly the point: it turns "looks fine" into evidence.

## Post-merge checks

Nothing here needs an eval run — #154 and #155 touch `apps/web` only, and #156
is baselines. Per package:

```sh
pnpm -C apps/web typecheck && pnpm -C apps/web test && pnpm -C apps/web lint
pnpm -C tools/categorizer test
pnpm lint                       # repo-root, exit code is the judge
```

CI is path-filtered, so a contract change does not run its dependents' suites
— run them locally before pushing (root `CLAUDE.md`).

## After the stack lands

- **BRIEF-86** (Later, Backend/Product): change-group splitting collapses on
  small multi-intent diffs — the flaky grouping canary surfaced by #156.
  https://app.notion.com/p/3a85e9400eeb811d91d8fa49d386eaec
- **BRIEF-87** (Next, Docs): eval harness guidance — real cost figures, the
  `--rebaseline` re-measures-everything footgun, scoped gating as the default.
  https://app.notion.com/p/3a85e9400eeb81bd8776f84625e89c39
- Still open from the grill, both needing live evidence: flagrant-under-broad
  misses, and a test-deletion risk attribute.
- One unconfirmed design call, flagged at the top of #152: generation emits one
  tagged `items` array while the stored shape keeps five bucket arrays. If that
  is ever reversed, #154's read path and the intent bar change with it.
