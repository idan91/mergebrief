# 0008: Brief & Delta: Persistence Model and Fetching

Status: superseded in part by 0040

The delta subsystem persists into a **single relational DB for v1**: relational rows for Checkpoints and Dispositions, and large immutable artifacts (Brief, Delta, DiffSnapshot) as `TEXT` served **passthrough** (parsed only by the generation worker, never on the read path). Dispositions are **anchored** by `(file, attribute, region@SHA)`, not by any brief-local id. The FE fetches the **Brief whole** (a metadata-only index) and then **diffs lazily per file** (amended, see Amendments), caching by file, slicing by chunk range, ordering by group client-side, and prefetching ahead of scroll. Object storage, response streaming, and the concrete compute/DB stack are deferred — none are needed for v1 and all are reversible.

## Context

ADR 0006 fixed delta generation/state and ADR 0007 fixed comment anchoring + flag carry-over. Neither said where any of it is stored or how it reaches the FE. The repo is greenfield here: a pnpm monorepo with `apps/web` (React 19 + Vite) and `tools/categorizer` (the CLI) — **no backend and no database exist yet**. Observed payloads: Brief JSON ~17–34 KB, Delta smaller, DiffSnapshot 57 KB–600 KB (and larger on outlier PRs). The concrete compute model (e.g., Lambda vs ECS — which hinges on whether we need SSE/long-lived connections, stateful vs stateless, and the cost model) and the DB vendor are deliberately **out of scope**; they are reversible and decided when the backend is built.

## Considered Options

- **Storage medium.** *All in one relational DB* vs *DB + object storage (S3) from day one*. Chosen: **all in one DB for v1**, behind a content-addressed artifact boundary so the object-storage split is a later, mechanical migration. Standing up object storage now is infrastructure v1 doesn't need; the immutable, point-read nature of these blobs makes the deferral safe.
- **Disposition identity.** *Reference a brief-local flag/chunk id* vs *anchor by content coordinates*. Chosen: **anchor** — brief-local ids are regenerated every brief and dangle immediately; anchoring is the only identity that survives regeneration (and is exactly what ADR 0007 carry-over needs).
- **Fetching granularity.** *Page = change-group + its diffs* vs *brief then all diffs at once* vs *brief index + per-file lazy diffs*. Chosen: **brief index + per-file lazy** — change-group ↔ file is many-to-many, so a group is neither 1:1 with files nor size-bounded (a 180-file refactor group exceeds the gateway cap), and "all diffs at once" reintroduces the cap. The file is the only dedup-able, size-bounded unit.
- **Brief delivery.** *Whole* vs *paginated groups*. Chosen: **whole** — the brief is metadata-only and stays well under the cap for realistic PRs; the constraint is FE render (virtualization), not transport. Group-pagination is a documented escape hatch for pathological briefs only.

## Decision

### Entities & keys
- **Brief** `(repo, PR, baseSHA, headSHA)` → brief JSON. Covers the whole PR (`base→head`); `baseSHA` = PR-base (merge-base / base-branch tip), **distinct from the Delta's checkpoint baseline**. Keyed on **both** endpoints — content is a function of both, so a head-only key would return a stale brief (and force a mutating overwrite, breaking immutability) when the base advances under a static head. Immutable, shared. (Amended, see Amendments.)
- **Delta core** `(repo, PR, baselineSHA, headSHA)` → the code-change narrative (new/changed groups + summary). Shared across all reviewers at that span; the expensive (LLM) part. Immutable, regenerable.
- **Carry-over overlay** `(reviewer, repo, PR, baselineSHA, headSHA)` → this reviewer's flag carry-over statuses + comment anchoring (ADR 0007). Per-reviewer (baseline-time dispositions differ); cheap (positional map + small LLM). Immutable, regenerable. Rendered Delta = core + the viewer's overlay. (Amended, see Amendments.)
- **DiffSnapshot** `(repo, PR, SHA)` → unified diff. Survives force-push GC (ADR 0006 #8). (Amended, see Amendments.)
- **Checkpoint** `(repo, PR, reviewer)` → lastSubmittedSHA, ts.
- **Disposition** `(reviewer, repo, PR, file, attribute, region, decidedAtSHA)` → decision (addressed/dismissed) + reason. **Anchored, not id-referenced**; matched forward to head via the positional line-map (ADR 0007). (Amended, see Amendments.)

### Storage
- **Single relational DB for v1.** Checkpoints and Dispositions as rows; Brief / Delta / DiffSnapshot as `TEXT` columns (the exact JSON/patch string), plus a small artifact index (key + size + createdAt + the SHA/pair it belongs to).
- **Passthrough reads.** Large artifacts are parsed **once, in the async generation worker** (to build line-maps, feed the model, compute carry-over) and stored finished. The interactive read path streams stored bytes — it does not re-parse megabytes. `TEXT` over `JSONB` because we serve these blobs, not query into them; queryable fields live in real columns.
- **Index keys, never blobs.** B-tree composite indexes on the natural keys above; large `TEXT` values are reached by row PK (out-of-line/TOAST), never indexed or scanned.
- **Deferred object-storage boundary.** All references to artifacts go through an opaque content key, so moving the blob payloads to object storage later (DB keeps a pointer) touches one boundary, not every reference. Trigger to migrate: blob volume hurting DB size/backup, *or* a single artifact exceeding the gateway response cap.

### Fetching
- **`GET brief` / `GET delta` — fetched whole.** The navigable index: `summary`, `changeGroups[]`, `chunks[]` (each with `file`, `addedRanges`/`removedRanges`, `concern`, `role`, `riskSurface`, group membership), `concernView`. No diff text.
- **`GET diff?file=<path>` — fetched lazily, per file.** Returns that file's full unified diff (the `diffs.json` sidecar granularity the categorizer already emits). (Amended, see Amendments.)
- **Client assembles the group view:** render groups/chunks from the brief immediately; fetch a chunk's file diff on view; **cache by file** (a file referenced by two groups is fetched once); **slice the file diff by chunk range** so each chunk's hunks render under its group; **order client-side** by the brief's group order; **prefetch the next file diffs ahead of scroll**; **virtualize** both the skeleton and the rendered hunks.
- **A per-file diff is a superset partitioned across groups.** One file's hunks may belong to chunks in different change-groups, so a single file's diff can render split across several groups. (Generation side: the categorizer prompt instructs the model to split a file's changed lines into separate chunks per intent and attach each to its proper group; `CONTEXT.md` documents the same.)

### Size / transport
- Brief and Delta are single responses, well under any gateway cap (e.g., Lambda's 6 MB synchronous limit).
- Per-file diffs are bounded; the rare single file exceeding the cap is served via **signed URL / CDN** from object storage (the deferred boundary), bypassing the API path — not via response streaming.
- **No response streaming for v1.** The wait UX is diff-first + determinate progress (ADR 0006 #9–10); transport is handled by per-file pagination, not streaming.

### Retention
- **Checkpoints & Dispositions** — durable through the PR's active life; frozen into the **Receipt** at submit; GC after PR close + grace.
- **Briefs & DiffSnapshots** — reference-counted on the current head and on live Checkpoints (a reviewer's checkpoint at an old SHA pins that SHA's brief + snapshot so their delta is still computable); GC artifacts referenced by neither; GC all working artifacts after PR close.
- **Deltas** — pure regenerable cache; TTL/LRU evictable at any time.
- **Receipts / Review Summaries** — the durable long-term record (ADR 0002); their existence is what lets the working delta state be GC'd after close.
- Shipped retention is ADR 0015's simpler model: the opt-in closed-PR sweep (`PR_RETENTION_DAYS`, `sweepClosedPullRequests` in `packages/persistence/src/stores/purge.ts`); reference counting and delta eviction are not built.

## Why This Way

One store keeps v1 operationally trivial while the content-addressed boundary keeps the eventual object-storage split cheap; correctness comes from content-addressing (immutable artifacts keyed by SHA) plus anchored dispositions, not from fragile brief-local ids. The fetching shape is dictated by the group↔file many-to-many: the file is the only unit that is simultaneously dedup-able and size-bounded, so brief-as-index + per-file-lazy is the one model that both bounds response size and renders the group view without duplicating shared files. Retention keyed on Checkpoints keeps exactly what a live delta could need and nothing more, and the Receipt being the durable record means working state is safely disposable.

## Consequences

- **FE owns real work:** per-file caching, range-slicing, group-order prefetch, and virtualization of both skeleton and hunks. The brief is an index; the view is assembled client-side.
- **The categorizer prompt is prescriptive** about splitting a file's lines into per-intent chunks across groups (`packages/brief-core/src/generation/prompt.ts`); `CONTEXT.md`'s Chunk term matches.
- **Deferred + reversible:** object storage, response streaming, the compute model (Lambda/ECS/SSE), and the DB vendor. This ADR commits only to the logical model. (Resolved, see Amendments.)
- **Cross-PR taxonomy querying** (a future engine capability noted in `CONTEXT.md`) would extract fields into real columns/tables rather than change this artifact model.
- Completes the delta subsystem design alongside ADR 0006 (generation/state) and ADR 0007 (anchoring/carry-over).

## Amendments

### 2026-06-18: Brief key spans both endpoints

The Brief key was amended from `(repo, PR, headSHA)` to `(repo, PR, baseSHA, headSHA)`; ADR 0012's per-distinct-head index stayed a display label over that key (ADR 0018 D3). ADR 0012's own Amendments later made the index the brief's address, unique per pull request.

### 2026-06-18: Compute model and DB vendor resolved by ADR 0015

A long-lived worker plus vanilla Postgres as the single stateful dependency.

### 2026-10-20: The diff is one live span diff, sliced on the client

The per-file lazy fetch was never built. The API serves one live `base...head` diff per span, read on the viewer's binding, cached per session server-side and never persisted (`apps/api/src/routes/repos/pr/reads/read-diff.ts`, query shape in `reads/schemas.ts`, contract `packages/contract/src/operations/index.ts`). The client fetches it whole and slices it per chunk (`apps/web/src/features/pulls/queries.ts`). The brief stays a metadata-only index fetched whole.

### 2026-10-20: Carry-over and Disposition identity under ADR 0040

The carry-over overlay entity was never built. Carry-over lives on Review Session rows and is evaluated on read over persisted `hunk_span` hops (`packages/persistence/src/stores/carry-over.ts`). A Disposition is keyed `(review_session_id, file_path, attribute, region_start, region_end)` and takes its SHA from the session's Brief; there is no `decided_at_sha`, `reviewer_id` or `pull_request_id` column (`packages/persistence/src/schema/disposition.ts`). The anchoring-by-content principle holds.

### 2026-10-20: DiffSnapshot was never built

No code wrote or read a `diff_snapshot`; migration 0058 dropped the table and its config gate (ADR 0018 D4 as amended). Nothing code-bearing is stored; a checkpoint span GitHub can no longer serve gets no delta, and the view falls back to the full Brief.
