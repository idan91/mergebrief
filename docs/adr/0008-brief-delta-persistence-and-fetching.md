# Brief & Delta: Persistence Model and Fetching

The delta subsystem persists into a **single relational DB for v1**: relational rows for Checkpoints and Dispositions, and large immutable artifacts (Brief, Delta, DiffSnapshot) as `TEXT` served **passthrough** (parsed only by the generation worker, never on the read path). Dispositions are **anchored** by `(file, attribute, region@SHA)`, not by any brief-local id. The FE fetches the **Brief whole** (a metadata-only index) and then **diffs lazily per file**, caching by file, slicing by chunk range, ordering by group client-side, and prefetching ahead of scroll. Object storage, response streaming, and the concrete compute/DB stack are deferred — none are needed for v1 and all are reversible.

## Context

ADR 0006 fixed delta generation/state and ADR 0007 fixed comment anchoring + flag carry-over. Neither said where any of it is stored or how it reaches the FE. The repo is greenfield here: a pnpm monorepo with `apps/web` (React 19 + Vite) and `tools/categorizer` (the CLI) — **no backend and no database exist yet**. Observed payloads: Brief JSON ~17–34 KB, Delta smaller, DiffSnapshot 57 KB–600 KB (and larger on outlier PRs). The concrete compute model (e.g., Lambda vs ECS — which hinges on whether we need SSE/long-lived connections, stateful vs stateless, and the cost model) and the DB vendor are deliberately **out of scope**; they are reversible and decided when the backend is built.

## Considered Options

- **Storage medium.** *All in one relational DB* vs *DB + object storage (S3) from day one*. Chosen: **all in one DB for v1**, behind a content-addressed artifact boundary so the object-storage split is a later, mechanical migration. Standing up object storage now is infrastructure v1 doesn't need; the immutable, point-read nature of these blobs makes the deferral safe.
- **Disposition identity.** *Reference a brief-local flag/chunk id* vs *anchor by content coordinates*. Chosen: **anchor** — brief-local ids are regenerated every brief and dangle immediately; anchoring is the only identity that survives regeneration (and is exactly what ADR 0007 carry-over needs).
- **Fetching granularity.** *Page = change-group + its diffs* vs *brief then all diffs at once* vs *brief index + per-file lazy diffs*. Chosen: **brief index + per-file lazy** — change-group ↔ file is many-to-many, so a group is neither 1:1 with files nor size-bounded (a 180-file refactor group exceeds the gateway cap), and "all diffs at once" reintroduces the cap. The file is the only dedup-able, size-bounded unit.
- **Brief delivery.** *Whole* vs *paginated groups*. Chosen: **whole** — the brief is metadata-only and stays well under the cap for realistic PRs; the constraint is FE render (virtualization), not transport. Group-pagination is a documented escape hatch for pathological briefs only.

## Decision

### Entities & keys
- **Brief** `(repo, PR, headSHA)` → brief JSON. Immutable, shared.
- **Delta** `(repo, PR, baselineSHA, headSHA)` → delta JSON. Immutable, regenerable cache.
- **DiffSnapshot** `(repo, PR, SHA)` → unified diff. Survives force-push GC (ADR 0006 #8).
- **Checkpoint** `(repo, PR, reviewer)` → lastSubmittedSHA, ts.
- **Disposition** `(reviewer, repo, PR, file, attribute, region, decidedAtSHA)` → decision (addressed/dismissed) + reason. **Anchored, not id-referenced**; matched forward to head via the positional line-map (ADR 0007).

### Storage
- **Single relational DB for v1.** Checkpoints and Dispositions as rows; Brief / Delta / DiffSnapshot as `TEXT` columns (the exact JSON/patch string), plus a small artifact index (key + size + createdAt + the SHA/pair it belongs to).
- **Passthrough reads.** Large artifacts are parsed **once, in the async generation worker** (to build line-maps, feed the model, compute carry-over) and stored finished. The interactive read path streams stored bytes — it does not re-parse megabytes. `TEXT` over `JSONB` because we serve these blobs, not query into them; queryable fields live in real columns.
- **Index keys, never blobs.** B-tree composite indexes on the natural keys above; large `TEXT` values are reached by row PK (out-of-line/TOAST), never indexed or scanned.
- **Deferred object-storage seam.** All references to artifacts go through an opaque content key, so moving the blob payloads to object storage later (DB keeps a pointer) touches one boundary, not every reference. Trigger to migrate: blob volume hurting DB size/backup, *or* a single artifact exceeding the gateway response cap.

### Fetching
- **`GET brief` / `GET delta` — fetched whole.** The navigable index: `summary`, `changeGroups[]`, `chunks[]` (each with `file`, `addedRanges`/`removedRanges`, `concern`, `role`, `riskSurface`, group membership), `concernView`. No diff text.
- **`GET diff?file=<path>` — fetched lazily, per file.** Returns that file's full unified diff (the `diffs.json` sidecar granularity the categorizer already emits).
- **Client assembles the group view:** render groups/chunks from the brief immediately; fetch a chunk's file diff on view; **cache by file** (a file referenced by two groups is fetched once); **slice the file diff by chunk range** so each chunk's hunks render under its group; **order client-side** by the brief's group order; **prefetch the next file diffs ahead of scroll**; **virtualize** both the skeleton and the rendered hunks.
- **A per-file diff is a superset partitioned across groups.** One file's hunks may belong to chunks in different change-groups, so a single file's diff can render split across several groups. (Generation side: the categorizer prompt instructs the model to split a file's changed lines into separate chunks per intent and attach each to its proper group; `CONTEXT.md` documents the same.)

### Size / transport
- Brief and Delta are single responses, well under any gateway cap (e.g., Lambda's 6 MB synchronous limit).
- Per-file diffs are bounded; the rare single file exceeding the cap is served via **signed URL / CDN** from object storage (the deferred seam), bypassing the API path — not via response streaming.
- **No response streaming for v1.** The wait UX is diff-first + determinate progress (ADR 0006 #9–10); transport is handled by per-file pagination, not streaming.

### Retention
- **Checkpoints & Dispositions** — durable through the PR's active life; frozen into the **Receipt** at submit; GC after PR close + grace.
- **Briefs & DiffSnapshots** — reference-counted on the current head and on live Checkpoints (a reviewer's checkpoint at an old SHA pins that SHA's brief + snapshot so their delta is still computable); GC artifacts referenced by neither; GC all working artifacts after PR close.
- **Deltas** — pure regenerable cache; TTL/LRU evictable at any time.
- **Receipts / Review Summaries** — the durable long-term record (ADR 0002); their existence is what lets the working delta state be GC'd after close.

## Why This Way

One store keeps v1 operationally trivial while the content-addressed seam keeps the eventual object-storage split cheap; correctness comes from content-addressing (immutable artifacts keyed by SHA) plus anchored dispositions, not from fragile brief-local ids. The fetching shape is dictated by the group↔file many-to-many: the file is the only unit that is simultaneously dedup-able and size-bounded, so brief-as-index + per-file-lazy is the one model that both bounds response size and renders the group view without duplicating shared files. Retention keyed on Checkpoints keeps exactly what a live delta could need and nothing more, and the Receipt being the durable record means working state is safely disposable.

## Consequences

- **FE owns real work:** per-file caching, range-slicing, group-order prefetch, and virtualization of both skeleton and hunks. The brief is an index; the view is assembled client-side.
- **The categorizer prompt is prescriptive** about splitting a file's lines into per-intent chunks across groups (`tools/categorizer/src/prompt.ts`); `CONTEXT.md`'s Chunk term matches.
- **Deferred + reversible:** object storage, response streaming, the compute model (Lambda/ECS/SSE), and the DB vendor. This ADR commits only to the logical model.
- **Cross-PR taxonomy querying** (a future engine capability noted in `CONTEXT.md`) would extract fields into real columns/tables rather than change this artifact model.
- Completes the delta subsystem design alongside ADR 0006 (generation/state) and ADR 0007 (anchoring/carry-over).
