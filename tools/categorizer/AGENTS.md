# tools/categorizer — agent notes

The dev CLI workbench and the eval harness. `pnpm categorize` / `pnpm delta` run `packages/brief-core`'s CLI entries against real PRs; `pnpm eval` scores generation output against committed baselines. The domain core lives in `packages/brief-core` — edit there, not here.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **Eval runs spend live API money.** Agents never invoke the eval harness — they prepare the case selection and the justification; a human runs and spends.
- **Runs compare against the committed baselines**; `--rebaseline` on main only when the generation surface legitimately moved.
- `--case` takes a single id — one run per case, never a list.
- **`.env` holds the live Anthropic key** — gitignored and agent-denied; target `.env.example` and source files only, never a glob that can match a real env file.

## Verification

`pnpm -C tools/categorizer typecheck` / `test` (the no-spend gates). `eval/README.md` is the deep reference for the harness — mechanics live there, never restated here.
