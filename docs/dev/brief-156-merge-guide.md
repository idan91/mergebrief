# BRIEF-156 — merge guide for the 24-PR comment sweep

24 PRs, #262–#285. This guide is a safe, resumable, one-at-a-time merge loop
with a verification gate after every step and a single cleanup command at the
very end.

## The key fact that makes this safe

**These are NOT a stack.** All 24 branches were cut from `main` independently
and every one already targets `main`. There is no retargeting to do and no
inter-PR dependency. Merge order does not matter for correctness.

That was verified empirically, not assumed:

- **Pairwise file overlap check** across all 24 branches found exactly one
  shared file: `packages/cli/README.md`, touched by #262 and #282. Git
  auto-merges it (different regions), confirmed below.
- **Full squash-merge simulation**: all 24 squash-merged into a scratch copy
  of `main`, one after another, in alphabetical branch order. **Zero
  conflicts.**
- The resulting tree is **byte-identical** to a plain merge-all of the 24
  branches (`git diff` between them is empty).
- That final tree was verified with repo-wide `typecheck`, `test`, and `lint`.

Because each PR touches a disjoint file set, a merge of PR N cannot break
PR N+1's content. The only thing that changes for later PRs is that their
base moves forward.

## Do you need to rebase between merges?

**Almost certainly not.** A branch being "behind main" does not block a merge
unless branch protection requires branches to be up to date. This repo is on
a plan where the branch-protection API returns 403, so that requirement is
very unlikely to be on.

The loop below detects the case anyway: if GitHub ever reports a PR as
`BEHIND` or the merge is refused, the guide rebases that one branch onto the
new `main` and re-pushes. That path is included but is expected to stay
unused.

Note the ordering subtlety: `--squash` is the repo's merge style, so after a
PR lands, `main` contains a NEW commit whose content matches the branch but
whose SHA does not. Rebasing an already-merged branch would replay nothing;
rebasing an unmerged branch is always safe because the file sets are disjoint.

## Before you start

```bash
cd /Users/idan/Projects/Code/code-review
git fetch --all --prune
git checkout main && git pull --ff-only
git status --short          # MUST be empty
```

CI on these PRs is currently red because the Actions quota is depleted, not
because anything is broken. Local verification is the gate instead — that is
what the loop below runs.

## Relationship to the `watch-pr-stack` skill

That skill babysits a **stacked** chain: the human merges, the agent
realigns each child onto the new `main`, proves the rebase changed nothing
via `patch-id`, and retargets the base before anyone deletes a parent
branch. Most of that does not apply here, and it is worth being explicit
about why:

- **No realign cycle.** Children do not exist — every branch forked from
  `main` directly, so nothing needs `rebase --onto` after a merge.
- **No retargeting.** All 24 already target `main`, so the skill's most
  dangerous trap — deleting a merged branch that is still some PR's base,
  which auto-closes that PR — cannot occur here. That is also why branch
  deletion is deferred to the very end without risk.
- **No `patch-id` proof needed**, because no commits are being replayed.

What the skill contributes and this guide adopts: a single sequential
watcher rather than one per PR; treating a `CLOSED` (not merged) PR as a
loud stop event; poll errors that must not kill the loop; running the gates
CI will not; and the `-D`-not-`-d` branch-deletion detail in step 4.

## Step 1 — the watcher (confirm all 24 are still mergeable)

Run this first, and again any time you pause and come back. It reports each
PR's state without changing anything.

```bash
cd /Users/idan/Projects/Code/code-review
for n in $(seq 262 285); do
  s=$(gh pr view "$n" --json state,mergeable,mergeStateStatus,headRefName \
        --jq '"\(.state)  \(.mergeable)  \(.mergeStateStatus)  \(.headRefName)"' 2>/dev/null)
  printf '%s  %s\n' "$n" "$s"
done
```

What you want to see per row: `OPEN  MERGEABLE  <status>  <branch>`.

- `MERGEABLE` is the field that matters.
- `UNSTABLE` in the status column means "checks failing" — expected here
  (quota), and it does NOT block `gh pr merge`.
- `CONFLICTING` would be the real stop sign. It should not appear; if it
  does, stop and re-run the conflict simulation in the appendix.
- `BLOCKED` means branch protection wants something (an approval or an
  up-to-date branch). See the rebase path in step 2.
- `MERGED` means you already did that one — the loop skips it safely.

## Step 2 — the merge loop (one PR at a time, verified after each)

Merge in ascending PR order. Nothing depends on it, but ascending order is
easy to resume and matches the review order.

For **each** PR number `N` from 262 to 285, run this block. It refuses to
proceed if anything looks wrong, so it is safe to paste one iteration at a
time.

```bash
N=262   # <-- change this each iteration

cd /Users/idan/Projects/Code/code-review

# 1. Confirm this PR is still open and mergeable.
gh pr view "$N" --json state,mergeable,mergeStateStatus,headRefName \
  --jq '"state=\(.state) mergeable=\(.mergeable) status=\(.mergeStateStatus) branch=\(.headRefName)"'

# 2. Merge it (squash, matching repo convention). Do NOT pass --delete-branch:
#    branches are deleted together at the very end, per step 4.
gh pr merge "$N" --squash

# 3. Pull the new main.
git checkout main && git pull --ff-only

# 4. Verify main is still healthy before touching the next PR.
pnpm -r typecheck && pnpm -r test
```

**Stop immediately if step 4 fails.** Do not merge the next PR. See
"If something goes wrong" below.

### Faster variant (if you would rather not run the full suite 24 times)

The full suite takes a few minutes per run. Since every PR is comment-only
and the merged end state is already verified, a lighter per-step gate is
defensible:

```bash
# after each merge
git checkout main && git pull --ff-only
pnpm -r typecheck            # fast, catches the realistic failure mode
```

…then run the **full** `pnpm -r test && pnpm lint` once after the last merge.
The risk this trades away is small: a comment-only change cannot alter
runtime behaviour, and typecheck catches the one thing that could plausibly
break (a comment deletion that stranded a directive or malformed a block
comment).

### The rebase path (only if a PR reports BEHIND or the merge is refused)

```bash
B=$(gh pr view "$N" --json headRefName --jq .headRefName)
git checkout "$B"
git rebase main                       # expected: clean, file sets are disjoint
pnpm -r typecheck                     # sanity
git push --force-with-lease           # never plain --force
gh pr merge "$N" --squash
```

`--force-with-lease` refuses to clobber if anything else pushed to that
branch in the meantime. Always use it over `--force`.

If the rebase does hit a conflict, it will be in `packages/cli/README.md`
(#262 vs #282) — the single known overlap. Resolution: that file's flag
appendix is **generated**, so never hand-edit it. Take either side, then run:

```bash
pnpm -C packages/cli docs:appendix    # regenerate
pnpm -C packages/cli docs:check       # must pass
git add packages/cli/README.md && git rebase --continue
```

## Step 3 — final verification (after PR #285 lands)

```bash
cd /Users/idan/Projects/Code/code-review
git checkout main && git pull --ff-only

pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm -C apps/web build
pnpm -C packages/cli docs:check
```

Expected results, matching what the merged state already produced locally:

| Gate | Expected |
|---|---|
| `typecheck` | exit 0 |
| `test` | exit 0 — 3,078 tests across 11 packages |
| `lint` | **exit 1** — see note |
| `apps/web build` | exit 0 |
| `docs:check` | "README flag appendix is current." |

**The `lint` exit 1 is pre-existing and expected.** Clean `main` fails it
identically today: one knip "Unused files" finding
(`tools/categorizer/eval/spot-brief148.ts`), five `no-await-in-loop`
warnings, and one `prefer-array-find` warning. The finding sets before and
after the sweep are identical — the sweep introduced no new lint findings.
If you see a *different* finding, that is a real regression.

Sanity-check that no ticket references came back:

```bash
grep -rlE 'BRIEF-[0-9]+|ADRs? ?[0-9]{4}' \
  --include='*.ts' --include='*.tsx' --include='*.scss' --include='*.svg' \
  packages apps tools 2>/dev/null | grep -v 'eval/cases\|eval/pair-cases'
```

Expected output is exactly one file: `packages/brief-core/src/types.ts`.
Those are model-facing Zod `.describe()` strings, deliberately left alone
because editing them moves the prompt surface and would require a paid eval
run. Anything else in that list is unexpected.

## Step 4 — delete all branches (ONLY after step 3 passes)

Confirm every PR actually merged before deleting anything:

```bash
gh pr list --state merged --limit 40 --json number \
  --jq '[.[]|select(.number>=262 and .number<=285).number]|sort|length'
```

This must print **24**. If it prints anything less, stop — something did not
land, and deleting branches would lose it.

Then delete remote and local branches together:

```bash
cd /Users/idan/Projects/Code/code-review
git checkout main && git pull --ff-only

# Remote branches
for b in $(git branch -r --list 'origin/chore/brief-156-*' | sed 's|origin/||'); do
  git push origin --delete "$b"
done

# Local branches. NOTE: -D is required, not -d.
# A squash-merge puts a NEW commit on main; git does not recognise the
# original branch as merged, so `git branch -d` refuses every one of them.
# The safety -d would have given is replaced by the "must print 24" check
# above — that check, not git, is what proves the work landed.
git branch --list 'chore/brief-156-*' | tr -d ' ' | xargs -r git branch -D

# Scratch verification branches created while preparing this sweep
git branch -D tmp-brief156-verify sim-main final-verify 2>/dev/null

git fetch --prune
```

Three empty leftover branches from renames may also appear
(`chore/brief-156-pkg-generators`, `-pkg-persistence`, `-pkg-small`). They
have zero commits and no PR.

**If a destructive-action hook blocks the local `-D` loop**, do not fight it.
By that point the remote branches are gone and the local ones are inert —
run it yourself, or leave them and let `git fetch --prune` clear the stale
remote-tracking refs.

## If something goes wrong

**A merge succeeded but verification fails.** Nothing is lost — the merge is
a normal commit on `main`. Identify the failure, then either fix forward with
a small commit, or revert that one squash commit:

```bash
git log --oneline -5                  # find the squash commit
git revert <sha>                      # creates a clean revert commit
git push
```

Then stop and investigate before merging anything further.

**A PR shows CONFLICTING unexpectedly.** Something changed on `main` outside
this sweep. Re-run the appendix simulation against the current `main` to find
the real conflict set before proceeding.

**You need to pause.** The loop is fully resumable. Re-run the step 1 watcher;
anything already merged reports `MERGED` and is simply skipped.

## Appendix — re-run the conflict simulation yourself

This is the check that produced the zero-conflict guarantee. It is
non-destructive: it works on a throwaway branch and never touches `main` or
any PR branch.

```bash
cd /Users/idan/Projects/Code/code-review
git fetch --all --prune
git checkout -B sim-check main

for b in $(git branch -r --list 'origin/chore/brief-156-*' | sed 's|origin/||' | sort); do
  if git merge --squash "origin/$b" >/dev/null 2>&1; then
    git commit -q -m "squash $b" 2>/dev/null || true
  else
    echo "CONFLICT: $b"
    git reset --hard HEAD
  fi
done

git checkout main
git branch -D sim-check
```

Any line starting `CONFLICT:` means merge order now matters and this guide's
core assumption needs rechecking. As of writing, it printed nothing.

## PR reference

| PR | Branch | Area |
|---|---|---|
| 262 | `chore/brief-156-docs` | root docs, all AGENTS.md, READMEs — sets the trim bar |
| 263 | `chore/brief-156-web-brief-header` | brief header, toolbar, story view |
| 264 | `chore/brief-156-web-brief-diff` | diff table, changes-only, risk surfaces |
| 265 | `chore/brief-156-web-brief-core` | brief screen orchestration |
| 266 | `chore/brief-156-web-brief-data` | brief utils, hooks, server functions |
| 267 | `chore/brief-156-web-pulls` | conversation components |
| 268 | `chore/brief-156-web-conversation-data` | conversation utils and queries |
| 269 | `chore/brief-156-web-pulls-transport` | pulls transport, hooks, utils |
| 270 | `chore/brief-156-web-pulls-components` | pulls components |
| 271 | `chore/brief-156-web-rest` | web routes, server wiring, data layer |
| 272 | `chore/brief-156-web-review` | review submit flow |
| 273 | `chore/brief-156-web-design-system` | shared components and style tokens |
| 274 | `chore/brief-156-pkg-api-routes` | api route handlers |
| 275 | `chore/brief-156-pkg-api-core` | api app wiring and tests |
| 276 | `chore/brief-156-pkg-persistence-stores` | persistence stores (**contains a real fix**) |
| 277 | `chore/brief-156-pkg-persistence-schema` | persistence auth, db, schema |
| 278 | `chore/brief-156-pkg-worker` | worker |
| 279 | `chore/brief-156-pkg-github` | github client |
| 280 | `chore/brief-156-pkg-generators-2` | generators |
| 281 | `chore/brief-156-pkg-brief-core` | brief-core (prompt bytes unchanged) |
| 282 | `chore/brief-156-pkg-cli` | cli and repo-config |
| 283 | `chore/brief-156-pkg-logging` | logging, types, eval harness |
| 284 | `chore/brief-156-configs` | config, CI, package metadata |
| 285 | `chore/brief-156-docs-selfhost` | self-host manual and public docs (**contains a real fix**) |
