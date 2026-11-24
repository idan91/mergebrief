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
- **`handoff` reads staleness from disk, not from the switch,** so a rerun after a failed step finishes the job: dependencies when `pnpm-lock.yaml` differs from pnpm's installed copy (`node_modules/.pnpm/lock.yaml`), the web dist when no build stamp exists or the diff from the stamped commit touches `apps/web/` or `packages/` (the stamp lives under `apps/web/node_modules/.cache/handoff/`), and a restart notice when the switch moved `apps/api/` or `packages/`, because the dev api has no watch mode. A failure after the switch names the branch the checkout is now on. It checks the running node against `.nvmrc` but never switches node itself.
- **`e2e-stop` touches only orphaned runs.** A run whose playwright pid is alive is left alone, and the `mergebrief-e2e-pg` container, one name shared by every worktree of the clone, is stopped only when no worktree's artifacts name a live owner and no playwright process runs (the match covers the node process pnpm's shim execs into, `@playwright/test/cli.js test`). It uses `docker stop`, never `rm`: the harness reclaims a stopped container that carries its label. Before a SIGTERM it checks that the recorded api pid still runs the harness's `apps/api/src/main.ts`, because a stale pid file can outlive its process and the pid can be reused; a container id file is used only when it holds a hex id. The container name and artifact file names mirror `apps/web/e2e/harness/env.ts`.

## Verification

```sh
pnpm -C tools/local test
pnpm -C tools/local typecheck
```
