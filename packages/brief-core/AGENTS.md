# packages/brief-core — agent notes

The Brief domain core. Everything production consumes to generate a Brief: the output schema + closed label vocabulary, the taxonomy prompt, the categorize engine (behind the `generators` port), repo-context (`.mergebrief/` semantics), delta/revision/comparison logic, and the huge-span guard.

## Map

**Entry point: `src/index.ts`** — `exports["."]`; every production symbol is re-exported there. Three curated subpaths exist (precedent: `persistence/testing`). `brief-core/types` (`src/types.ts` — `Category` and friends) and `brief-core/cli-config` (`src/cli/config.ts` — `extractConfigFlag`) serve the eval harness; `brief-core/remap` (`src/diff/remap.ts`) serves `persistence`'s category mirror.

What the layout can't show:

- `types.ts` (Brief schema + closed vocabulary, mirroring `docs/mvp/labeling-schema.md` and `risk-surface.md`) and `generation/prompt.ts` are GENERATION SURFACE (root AGENTS.md's eval gate).
- `diff/` is mechanical parsing, no model calls.
- `cli/` entries are invoked from `tools/categorizer`. They are local-only mode's first slice: `cli/settings.ts` reads the `tracker:` block of the working tree's `.mergebrief/settings.yaml` with the schema `context/tracker.ts` owns (repo-config depends on brief-core, so the CLI cannot go through `validateRepoConfig`).
- `github/` is the CLI/dev + web generate-from-URL fetch surface behind the `PrSource` port (the worker uses its own github-port).
- The primary ticket is harness data end to end: `context/primary.ts` maps the fan-out outcome to `intentCheck.primaryTicket` after validation; the model sees the ticket only inside `<primary_ticket>` and never the stamp. `cli/context-file.ts` is the `--context <file>` path and the one CLI reader of the i18n catalog.
- `context/` is the ContextSource boundary: the query, the snippet, the provider port, the fan-out and the provider registry. `context/trackers/` holds one module per ticket tracker, its reference syntax and, once it has one, its read; `references.ts` only scans locations, applies the closing rule and dedupes. A new tracker is one module plus a line in `trackers/index.ts`. Providers return `Result`, the fan-out fails open per provider, and the SSRF guard lives in `providers/url.ts`, outside the `PrSource` port. Every fence tag the prompt uses is listed once in `generation/fences.ts`; injected text is stripped of the whole union.

Consumers: `packages/worker`, `packages/repo-config`, `apps/web`, `tools/categorizer` (CLIs + eval).

## Invariants

- The Brief never approves, rejects, or scores; enums mirror the closed vocabulary docs and change only with them (lockstep tests).
- `REPO_INSTRUCTION_CLASSES` is the operative source of truth for what repo instructions may influence; class changes gate on a decision-record amendment + eval run.

## Conventions

Repo-wide conventions apply (root AGENTS.md); refinements below.

- `zod` is imported as `zod/v4`.

## Verification

`pnpm -C packages/brief-core typecheck` / `test`; repo-root `pnpm lint`.
