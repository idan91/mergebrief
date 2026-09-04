# packages/brief-core — agent notes

The Brief domain core. Everything production consumes to generate a Brief: the output schema + closed label vocabulary, the taxonomy prompt, the categorize engine (behind the `generators` port), repo-context (`.mergebrief/` semantics), delta/revision/comparison logic, and the huge-span guard.

## Map

**Entry point: `src/index.ts`** — `exports["."]`; every production symbol is re-exported there. Three curated subpaths exist (precedent: `persistence/testing`). `brief-core/types` (`src/types.ts` — `Category` and friends) and `brief-core/cli-config` (`src/cli/config.ts` — `extractConfigFlag`) serve the eval harness; `brief-core/remap` (`src/diff/remap.ts`) serves `persistence`'s category mirror.

What the layout can't show:

- `types.ts` (Brief schema + closed vocabulary, mirroring `docs/mvp/labeling-schema.md` and `risk-surface.md`) and `generation/prompt.ts` are GENERATION SURFACE (root AGENTS.md's eval gate).
- `diff/` is mechanical parsing, no model calls.
- `cli/` entries are invoked from `tools/categorizer`. `cli/context-providers.ts` is their composition root: what the CLIs offer a tracker's read (`createCliRootDeps`: the shared deps plus one transport per tracker, GitHub through `gh`) and the generic sources they run (`createCliContextProviders`: the URL chaser). They are local-only mode's first slice: `cli/settings.ts` reads the `tracker:` block of the working tree's `.mergebrief/settings.yaml` with the schema `context/tracker.ts` owns (repo-config depends on brief-core, so the CLI cannot go through `validateRepoConfig`).
- `github/` is the CLI/dev + web generate-from-URL fetch surface behind the `PrSource` port (the worker uses its own github-port).
- The primary ticket is harness data end to end: `context/primary.ts` maps the fan-out outcome to `intentCheck.primaryTicket` after validation; the model sees the ticket only inside `<primary_ticket>` and never the stamp. `cli/context-file.ts` is the `--context <file>` path and the one CLI reader of the i18n catalog.
- `context/` is the ContextSource boundary: the query, the snippet, the generic-source port (the URL chaser), the fan-out and the source registry. `context/trackers/` holds one folder per ticket tracker, the same four entries each: `references.ts` (syntax and URL form), `transport/` (`port.ts` is the port the read talks through, one file per implementation, `index.ts` lists them in an `XTransports` map with `create()`), `read.ts` (`createXRead(shared, transport)`) and `index.ts` (the `Tracker`). Every tracker's `createRead` takes the same two arguments: `SharedRootDeps` (the env, the `contextSources:` entries) and its own transport from `TrackerRootDeps.transports`; no slot, no read. A root is a literal listing one transport per tracker it serves, always `XTransports.IMPL.create()`, nothing filled in behind it. `resolveTrackerReads(settings.tracker, root)` builds one read per bound slot, handing each tracker its own; an unbound tracker is never a read, and a bound slot that cannot build refuses only when it is the repo's tracker, GitHub when the repo names none. The parser gets the readable kinds, ranks the repo's tracker first, and the fan-out reads each candidate through its own tracker; references to a tracker the root cannot read stay text. `references.ts` only scans locations, applies the closing rule and dedupes. A new tracker is a folder with the four entries, a line on `TrackerTransports`, a line in `TRACKER_BY_KIND`, and a slot at each root; the resolve path does not change. Providers return `Result`, the fan-out fails open per provider, and the SSRF guard lives in `providers/url.ts`, outside the `PrSource` port. Every fence tag the prompt uses is listed once in `generation/fences.ts`; injected text is stripped of the whole union.
- `contextSources:` entries are consumed by each tracker's `createRead` from `SharedRootDeps.contextSources` (tokens by env-var NAME from the shared env); the block's schema is `generators`' because it rides the instance config, and brief-core consumes the parsed shape. `trackers/notion/transport/http.ts` talks to the Notion API directly through an injectable `fetch`; the roots that offer it a token are the worker's `main.ts` and the two CLIs, nothing else reads `process.env`.

Consumers: `packages/worker`, `packages/repo-config`, `apps/web`, `tools/categorizer` (CLIs + eval).

## Invariants

- The Brief never approves, rejects, or scores; enums mirror the closed vocabulary docs and change only with them (lockstep tests).
- `REPO_INSTRUCTION_CLASSES` is the operative source of truth for what repo instructions may influence; class changes gate on a decision-record amendment + eval run.

## Conventions

Repo-wide conventions apply (root AGENTS.md); refinements below.

- `zod` is imported as `zod/v4`.

## Verification

`pnpm -C packages/brief-core typecheck` / `test`; repo-root `pnpm lint`.
