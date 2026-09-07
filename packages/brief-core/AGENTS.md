# packages/brief-core — agent notes

The Brief domain core. Everything production consumes to generate a Brief: the output schema + closed label vocabulary, the taxonomy prompt, the categorize engine (behind the `generators` port), repo-context (`.mergebrief/` semantics), delta/revision/comparison logic, the anchored-generation plan and stitch, and the huge-span guard.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

Three curated subpaths exist beside the entry: `brief-core/types` (`src/types.ts`) and `brief-core/cli-config` (`src/cli/config.ts`) serve the eval harness; `brief-core/remap` (`src/diff/remap.ts`) serves `persistence`'s category mirror.

What the layout can't show:

- `types.ts` (Brief schema + closed vocabulary, mirroring `docs/mvp/labeling-schema.md` and `risk-surface.md`) and `generation/prompt.ts` are generation surface (root AGENTS.md's eval gate).
- `diff/` and `anchoring/` are mechanical parsing and partition, no model calls.
- `cli/` entries are invoked from `tools/categorizer`. The two CLIs, `cli/categorize.ts` and `cli/delta.ts`, are this package's composition roots: they read the env, build the tracker root (`createCliRootDeps`, GitHub through `gh`) and the generic sources (`createCliContextProviders`, the URL chaser), and pass values down. `cli/settings.ts` reads the `tracker:` block of the working tree's `.mergebrief/settings.yaml` with the schema `context/tracker.ts` owns (repo-config depends on brief-core, so the CLI cannot go through `validateRepoConfig`).
- `github/` is the CLI/dev + web generate-from-URL fetch surface behind the `PrSource` port (the worker uses its own github-port).
- The primary ticket is harness data end to end: `context/primary.ts` maps the fan-out outcome to `intentCheck.primaryTicket` after validation; the model sees the ticket only inside `<primary_ticket>` and never the stamp. `cli/context-file.ts` is the `--context <file>` path and the one CLI reader of the i18n catalog.
- `context/trackers/` holds one folder per ticket tracker with the same four entries: `references.ts` (syntax and URL form), `transport/` (`port.ts` plus one file per implementation, listed in an `XTransports` map), `read.ts` (`createXRead(shared, transport)`) and `index.ts` (the `Tracker`). A new tracker is that folder, a line on `TrackerTransports`, a line in `TRACKER_BY_KIND`, and a slot at each root. `resolveTrackerReads(settings.tracker, root)` builds one read per bound slot; an unbound tracker is never a read, and a bound slot that cannot build refuses only when it is the repo's tracker. Providers return `Result`, the fan-out fails open per provider, the SSRF guard lives in `providers/url.ts`, and every fence tag the prompt uses is listed once in `generation/fences.ts`; injected text is stripped of the whole union before it reaches the prompt.
- `contextSources:` entries reach each tracker's `createRead` through `SharedRootDeps.contextSources` (tokens by env-var name from the shared env); the block's schema is `generators`' because it rides the instance config. `trackers/notion/transport/http.ts` talks to the Notion API through an injectable `fetch`; the roots that offer it a token are the worker's `main.ts` and the two CLIs.

## Invariants

- The Brief never approves, rejects, or scores; enums mirror the closed vocabulary docs and change only with them (lockstep tests).
- `REPO_INSTRUCTION_CLASSES` is the operative source of truth for what repo instructions may influence; class changes gate on a decision-record amendment + eval run.
