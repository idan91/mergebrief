# tools/local: agent notes

Chores on the maintainer's own checkout. `src/main.ts` is the composition root: argv, the repo root, child processes and signals enter there; `src/logic/` takes runners and paths as parameters.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Commands

```sh
pnpm checkout:handoff <branch>   # switch, then install / rebuild web / name what to restart
pnpm e2e:stop                    # clean up after an e2e run whose playwright died
```

## Invariants (enforced, don't weaken)

- **`handoff` never switches over uncommitted tracked work.** It refuses instead; the checkout is shared with the maintainer.
- **`handoff` catches up exactly what a switch leaves stale:** dependencies when the lockfile blob moved, the built web dist when `apps/web/` or `packages/` moved, and a restart notice when `apps/api/` or `packages/` moved, because the dev api has no watch mode. It checks the running node against `.nvmrc` but never switches node itself.
- **`e2e-stop` touches only orphaned runs.** A run whose playwright pid is alive is left alone, and the unowned `mergebrief-e2e-pg` container is stopped only while no playwright process exists. It uses `docker stop`, never `rm`: the harness reclaims a stopped container that carries its label. The container name and artifact file names mirror `apps/web/e2e/harness/env.ts`.

## Verification

```sh
pnpm -C tools/local test
pnpm -C tools/local typecheck
```
