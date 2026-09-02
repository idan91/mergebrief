# packages/brief-core — agent notes

The Brief domain core. Everything production consumes to generate a Brief: the output schema + closed label vocabulary, the taxonomy prompt, the categorize engine (behind the `generators` port), repo-context (`.mergebrief/` semantics), delta/revision/comparison logic, and the huge-span guard.

## Map

**Entry point: `src/index.ts`** — `exports["."]`; every production symbol is re-exported there. Three curated subpaths exist (precedent: `persistence/testing`). `brief-core/types` (`src/types.ts` — `Category` and friends) and `brief-core/cli-config` (`src/cli/config.ts` — `extractConfigFlag`) serve the eval harness; `brief-core/remap` (`src/diff/remap.ts`) serves `persistence`'s category mirror.

What the layout can't show:

- `types.ts` (Brief schema + closed vocabulary, mirroring `docs/mvp/labeling-schema.md` and `risk-surface.md`) and `generation/prompt.ts` are GENERATION SURFACE (root AGENTS.md's eval gate).
- `diff/` is mechanical parsing, no model calls.
- `cli/` entries are invoked from `tools/categorizer`.
- `github/` is the CLI/dev + web generate-from-URL fetch surface behind the `PrSource` port (the worker uses its own github-port).
- `context/` is the ContextSource boundary: the query, the snippet, the provider port, the fan-out and the provider registry. Providers return `Result`, the fan-out fails open per provider, and the SSRF guard lives in `providers/url.ts`, outside the `PrSource` port. Every fence tag the prompt uses is listed once in `generation/fences.ts`; injected text is stripped of the whole union.

Consumers: `packages/worker`, `packages/repo-config`, `apps/web`, `tools/categorizer` (CLIs + eval).

## Invariants

- The Brief never approves, rejects, or scores; enums mirror the closed vocabulary docs and change only with them (lockstep tests).
- `REPO_INSTRUCTION_CLASSES` is the operative source of truth for what repo instructions may influence; class changes gate on a decision-record amendment + eval run.

## Conventions

Repo-wide conventions apply (root AGENTS.md); refinements below.

- `zod` is imported as `zod/v4`.

## Verification

`pnpm -C packages/brief-core typecheck` / `test`; repo-root `pnpm lint`.
