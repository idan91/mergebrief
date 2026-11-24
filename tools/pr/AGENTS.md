# tools/pr: agent notes

PR stack tooling run by hand or by an agent watching a stack. `src/main.ts` is the composition root, the one reader of `process.env` (`INIT_CWD`), `argv` and child processes; everything under `src/logic/` takes runners and paths as parameters.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Commands

```sh
pnpm -s -C tools/pr stack-status 61 62 63          # PRs bottom first
pnpm -s -C tools/pr reply 62 3539470933 body.md    # reply on a review thread
```

`stack-status` prints, per open PR, whether its base is an ancestor of its head, every unresolved review thread whose last message is not a recorded reply, and the reviews and PR comments newer than the head commit (bots excluded). The last line compares the current checkout with the top open PR.

## Invariants (enforced, don't weaken)

- **Author is no signal.** Agents and the maintainer post under the same GitHub login, so a thread counts as answered only when its last message's id is in the reply store. Post thread replies through `reply` so they are recorded; a reply posted any other way leaves its thread open.
- **The reply store lives in the git common dir** (`pr-tool/replies.json`), shared by every worktree of the clone. A malformed store is an error, never an empty set, because an empty set would reopen every thread silently, and a store read as empty is indistinguishable from one that has been lost.
- **`reply` resolves a reply id to its thread root**; GitHub's replies endpoint accepts roots only.
- **One GraphQL call per run** for every PR, because review threads' resolved state is GraphQL-only and the watcher's REST quota is spent elsewhere. Page sizes are in `src/logic/github.ts`; a PR past them is under-reported, not mis-reported.
- **Alignment is never guessed.** A failed fetch or `merge-base` prints `unknown`.

## Verification

```sh
pnpm -C tools/pr test        # recorded GraphQL shapes, stub runners
pnpm -C tools/pr typecheck
```
