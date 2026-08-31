# BRIEF-94 — Merge guide

> State as of 2026-08-01. Plan: `docs/plans/brief-94-collaborators-mentions.md`.
> All four PRs are up with clean reviewer rounds; nothing is merged yet.
> Test the feature AFTER the whole stack lands — the FE degrades silently by
> design, so a half-merged state looks like "mentions filtered", not an error.

## Stack shape (strictly linear)

```
main
└─ feature/BRIEF-94/github-collaborators-op    #200  github op        tip 96e7e74f
   └─ feature/BRIEF-94/api-collaborators-route #201  api route        tip 7c6299ed
      └─ feature/BRIEF-94/mention-candidate-shape #202  rich popup    tip 9a2a146f
         └─ feature/BRIEF-94/collaborators-wiring #203  wiring        tip 91433e48
```

Merge order is fixed: **#200 → #201 → #202 → #203** (each consumes the
previous layer's exports).

## ⚠️ Deleting a merged branch closes the PR stacked on it

(BRIEF-85 lesson — it happened once.) Before deleting each merged branch,
retarget its child:

```sh
gh pr edit <child-pr> --base main
# only then delete the parent branch
```

The old-tip SHAs above make every rebase below independent of deleted
branch refs — safe even if a branch vanishes early.

## The cycle, per PR (squash-merge discipline)

Squash-merge rewrites history: never plain-pull a stacked branch afterwards
(`git-push-workflow` memory). `--force-with-lease` only — bare `--force` is
hook-blocked, correctly.

**1. Merge #200 (squash) on GitHub.** Then realign #201:

```sh
git fetch origin
git checkout feature/BRIEF-94/api-collaborators-route
git rebase --onto origin/main 96e7e74f
git push --force-with-lease
gh pr edit 201 --base main     # then #200's branch may be deleted
```

**2. Merge #201 (squash).** Realign #202:

```sh
git fetch origin
git checkout feature/BRIEF-94/mention-candidate-shape
git rebase --onto origin/main 7c6299ed
git push --force-with-lease
gh pr edit 202 --base main
```

**3. Merge #202 (squash).** Realign #203:

```sh
git fetch origin
git checkout feature/BRIEF-94/collaborators-wiring
git rebase --onto origin/main 9a2a146f
git push --force-with-lease
gh pr edit 203 --base main
```

**4. Merge #203 (squash).** Delete remaining branches, `git checkout main
&& git pull`.

No conflicts expected at any step: each rebase replays only that branch's
own commits onto a main that already contains its parent's squashed
content.

## Verify each rebase preserved content

```sh
git diff <base> <tip> | git patch-id --stable    # before
# ...rebase...
git diff origin/main HEAD | git patch-id --stable  # must match
```

## Per-merge local checks (CI is path-filtered!)

The api PR changes a contract apps/web consumes (port rename) and the web
PRs depend on the api route — CI will NOT run dependents' suites. Before
merging each PR, after its realign:

- #201: `pnpm -C packages/api typecheck && pnpm -C packages/api test` AND
  `pnpm -C apps/web typecheck` (composition-root rename rides this PR).
- #202/#203: `pnpm -C apps/web typecheck && pnpm -C apps/web test &&
  pnpm -C apps/web build` (isomorphic changes ⇒ build is required).
- Every step: `pnpm lint` at root, exit code is the judge.

## After the stack lands — the real test

In the normal loop (real `.env`, real App creds):

1. Open a PR page, devtools → Network. `GET /api/repos/:id/collaborators`
   should be **200** with `{collaborators: [...], hasMore: false}` — you in
   it (no self-filtering exists; live-verified the query returns Idan91 +
   name + avatar on the solo repo).
2. `@` in a thread reply → participants first, then the roster,
   avatars + names rendered.
3. `@` in a draft diff comment → roster-only pool (on a solo repo: just
   you). This surface had NO autocomplete before — any popup is new.
4. If instead the endpoint returns **502**: check the server log — if the
   GraphQL layer reports FORBIDDEN, the App's Metadata:read assumption for
   the collaborators connection was wrong (ticket claimed it, never
   live-verified against an installation token). Fix = App permission
   settings, then update the plan doc.
