# tools/categorizer: agent notes

The dev CLIs (`pnpm categorize`, `pnpm delta`) and the generation-quality eval harness, on top of brief-core. Nothing outside `tools/` imports this member.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

- Composition roots: `src/cli/categorize.ts`, `src/cli/delta.ts`, `eval/cli.ts` and each `scripts/` probe. The two CLIs read the env, build the tracker root (`createCliRootDeps`, GitHub through `gh`) and the generic sources (`createCliContextProviders`, the URL chaser), and pass values down.
- `src/cli/settings.ts` reads the `tracker:` block of the working tree's `.mergebrief/settings.yaml` with the schemas `generators/trackers` owns; repo-config depends on brief-core, so the CLI cannot go through `validateRepoConfig`.
- `src/cli/context-file.ts` is the `--context <file>` path and the one reader of the i18n catalog here.
- `src/github/` reads a PR through `gh` behind the `PrSource` port, and a revision span behind brief-core's `PrSpanSource` (`buildGhPrSpanSource`, for capture-pair and the dev CLIs). Its exec plumbing is `brief-core/gh-exec`, which the GitHub tracker's `gh` transport shares. `src/artifacts/` names the CLI output files and keeps the per-PR brief manifest.
- brief-core is reached through its entry and declared subpaths only.
