# BRIEF-143 — Mechanical-Path Research: Cross-Revision Brief Stability

Research input for the BRIEF-143 design (carry over untouched regions of the
previous brief across revisions; regenerate only diff-affected regions).
Factual survey of what exists today, with file:line evidence. Paths are
repo-relative. Sections mirror the research brief: (a) computability of
"untouched by the incremental diff", (b) rebase/patch-equivalence detection,
(c) the stitching frame.

---

## (a) How reliably can "files/chunks untouched by the incremental diff" be computed today?

### Mechanical changed-range parsing (ADR 0021/0024)

- `packages/brief-core/src/diff/revchanges.ts:45-77` (`parsePatch`) walks one
  file's unified-diff patch: `+` lines recorded at **new-side (head) line
  numbers**, `-` lines at **old-side (baseline) line numbers**; only lines
  inside a `@@` hunk count; `\ No newline` advances neither side. Adjacent
  lines coalesce into inclusive `LineRange`s (`revchanges.ts:30-38`).
- Per-file result: `RevisionChangeFile { file, addedRanges, removedRanges }`
  (`revchanges.ts:11-17`). Files with zero added+removed lines **drop out
  entirely** (`revchanges.ts:88-98`).
- `packages/brief-core/src/diff/comparison.ts:42-59`
  (`buildComparisonMarks`) wraps the same parser for both baseline families
  (`previous-brief` = prevHead→head, `checkpoint` = checkpoint→head), keyed
  `(baselineSha, headSha, baselineLabel)`. Persisted coordinates-only via
  `store.comparisonMarks.write` (`packages/worker/src/task/generate.ts:1104-1117`;
  ADR 0018 D13 — never code-bearing, no origin tracking).

### How the prevHead→head compare diff is obtained

- Worker: `source.fetchCompareDiff(prevBrief.headSha, headSha)`
  (`generate.ts:787-789`) → `packages/github/src/operations/pull-request.ts:228-250`
  → `octokit.rest.repos.compareCommitsWithBasehead` with
  `basehead: "${base}...${head}"` and the `diff` media type. This is the
  **three-dot (merge-base) compare** — the only form the REST compare
  endpoint offers.
- CLI path: `packages/brief-core/src/github/fetch.ts:152-183`
  (`fetchCompareDiff` via `gh api repos/.../compare/base...head`), whose doc
  comment states the known limitation explicitly: three-dot semantics are
  "identical to a true tree diff when head descends from baseline … but
  after a rebase/force-push it can include merge-base noise. The
  rebase-robust two-dot (`git diff base head`, ADR 0006's intent) needs a
  local clone" (`fetch.ts:153-160`). No local clone exists anywhere in the
  system (worker is API-only; the CLI shells to `gh`, `fetch.ts:44-51`).

### Precision limits of the parser

- File splitting: `packages/brief-core/src/diff/diff.ts:11-39`
  (`splitDiffByFile`) keys each patch by the `diff --git a/… b/…` header's
  **new-side path** via a greedy regex (`diff.ts:11`, `GIT_HEADER`). Paths
  containing spaces are ambiguous under that regex (greedy `(.+) b\/(.+)`).
  The FE has a more careful sibling (`apps/web/src/features/brief/utils/diffSlicing.ts:125-176`,
  which keys deleted files by the pre path on `+++ /dev/null`); brief-core's
  splitter does not special-case deletions (harmless: git repeats the same
  path on both sides for a deletion).
- **Pure renames**: a rename-only file has `rename from/to` headers and no
  hunks → zero added/removed lines → the file **drops out of the marks**.
  Rename+edit emits hunks under the new path only. There is **no old-path →
  new-path mapping anywhere**: a previous brief's chunks keyed by the old
  path will never match marks or an incremental diff keyed by the new path.
- **Binary files** ("Binary files … differ", no hunks) and **mode-only
  changes** likewise produce zero ranges and drop out — the marks are blind
  to them.
- Huge spans: GitHub refuses to render very large diffs (406), classified
  permanent (`generate.ts:216-223`); a delta span that 406s is skipped, the
  view falls back to the full Brief (`generate.ts:1267-1276`).

### How brief chunks reference files/ranges

- `ChunkSchema` (`packages/brief-core/src/types.ts:221-265`): `file` (path
  string), `addedRanges` = "**new-side (+) line-number ranges** of the
  actual ADDED lines … NOT the @@ hunk window" (`types.ts:244-248`),
  `removedRanges` = old-side (−) ranges (`types.ts:249-253`). A full brief's
  ranges are coordinates of the **base→head whole-PR diff at that brief's
  head** — i.e. addedRanges live in that head's file coordinates,
  removedRanges in the PR-base's.
- These ranges are **model-emitted**, not mechanically derived: the model is
  instructed to copy diff coordinates, and the only mechanical cross-checks
  are warn-only overlap validations on the *narrative* artifact
  (`validate.ts:898-971`), not on the full brief's own chunks.

### Is "chunk untouched by incremental diff" a well-defined mechanical predicate?

Partially. The two coordinate systems line up on exactly one side:

- The **previous brief's** chunk `addedRanges` are in prevHead coordinates.
- The **incremental diff's** `removedRanges` are also in prevHead (old-side)
  coordinates (`revchanges.ts:14-16`).

So "no line the chunk claims at prevHead was removed/modified by the
incremental diff" is computable by range intersection (the same
`rangesOverlap`/`anyOverlap` helpers exist at `validate.ts:881-887`). Two
holes remain:

1. **Line shift**: an untouched chunk's content is unchanged but its head
   line numbers shift whenever earlier lines are inserted/deleted. Nothing
   in the codebase remaps ranges across revisions — a repo-wide grep for
   remap/shift logic finds only an unrelated header comment
   (`apps/web/src/features/brief/server/brief.server.ts:472`). A carried-over
   chunk with stale ranges breaks both FE joins, which are exact
   line-number joins against the **current head**:
   `markComparisonRows` (`apps/web/src/features/brief/comparison/comparison.ts:103-125`,
   joins `row.newLine ∈ addedRanges`) and `sliceChunkDiff`
   (`diffSlicing.ts:14-52`, slices the live head diff by chunk ranges;
   "an empty result means the chunk's ranges matched nothing").
   The hunk headers of the incremental diff carry enough data to compute
   the offset function (old-line → new-line for untouched regions) — the
   parser already tracks both counters (`revchanges.ts:48-75`) — but no
   such remapper exists today.
2. **Renames/binary/mode** (above): "no marks entry for this file" is
   ambiguous between "untouched" and "renamed/binary/mode-changed".

### Pre-warmed delta cores — what a "delta core" contains

- `DeltaBriefSchema` (`types.ts:658-706`): a **full generated mini-brief over
  the incremental span** — its own `changedGroups`, `DeltaChunk`s
  (= `ChunkSchema` + per-chunk `summary` + `addressesComments`,
  `types.ts:647-656`), `summary`, `commentsAddressed`, `wholePrImpact`.
  Its chunks frame "affected region" in **span-diff coordinates** (added =
  head coords, removed = checkpoint coords) — the same shape as brief
  chunks, but grouped by a *parallel* model-invented grouping, not the full
  brief's groups.
- Pre-warm loop: `warmDeltaCores` (`generate.ts:1235-1352`) — one core per
  **distinct checkpoint SHA** (`repo.checkpoints.listForPullRequest`,
  dedup at 1242-1246), skip-if-stored (1250-1253), reuses the prevHead span
  diff when a checkpoint coincides with prevHead (1254-1260), writes span
  marks **before** the LLM call (1283-1305).
- Contrast: the **revision narrative** (`RevisionNarrativeSchema`,
  `types.ts:730-788`) is the lean per-revision artifact whose chunks carry
  incremental-diff ranges AND attach to the **current full brief's**
  change-group ids (`briefChangeGroupId`, `types.ts:731-736` — "Never
  invent an id"). It is the one existing artifact that already frames
  "affected region → owning brief group".

### The huge-span guard

- `packages/brief-core/src/generation/huge-span.ts:16-42`:
  `isHugeSpan(incremental, wholePr)` = ratio ≥ 0.65 (`HUGE_SPAN_RATIO` env
  override; ADR 0006 #7 / ADR 0024 — one shared knob).
- Numerator: `countChangedLines(revDiff)` (`revchanges.ts:110-123`) — total
  added + removed lines **parsed from the span diff**.
- Denominator: `churn(files)` (`generate.ts:1009-1014`) — whole-PR
  additions+deletions from `pulls.listFiles` **metadata**
  (`pull-request.ts:90-115`), not a parsed diff. (Asymmetric sources; file
  metadata counts binary churn the diff parser can't see.)
- Sites: revision narrative — `generate.ts:1162-1169` writes a
  `"span too large"` skip stub instead of calling the model; delta cores —
  `generate.ts:1307-1314` skips the core (marks already written; absence IS
  the FE signal, view falls back to the full Brief).

**Implications for the design (a).** The mechanical predicate "this
prevHead region was not touched" is computable today from data already in
hand (prev brief chunk ranges × incremental `removedRanges`, both in
prevHead coords), but only *touched-ness*, not *position*: carrying a chunk
forward requires a line-offset remapper that does not exist, and every FE
join assumes ranges are exact current-head coordinates. Renames, binary
files, and mode changes are invisible to the marks parser, so "no marks
entry" cannot be read as "untouched" without a per-file status source (the
compare API's JSON `files[].status` is not fetched today — only the raw
diff). Chunk ranges are model-emitted, not mechanically verified, so
carry-over inherits whatever coordinate drift the original generation had.

---

## (b) What would rebase/patch-equivalence detection take?

### What's available at webhook time — the unused `before` SHA

- `packages/github/src/webhook/events.ts:119-122`: `ParsedPullRequestEvent`
  carries optional `before` ("the pre-push head, for force-push detection")
  and `after`, parsed at `events.ts:210-211` and threaded at
  `events.ts:326-327` — present on `synchronize` events.
- **No consumer exists**: `packages/persistence/src/stores/ingest.ts`
  (the event→state mapping) never reads `before`/`after`; nothing else in
  apps/web or persistence does either (repo grep). The generate-job payload
  carries only `{installationId, pullRequestId, baseSha, headSha}`
  (`ingest.ts:107,316,354`).
- ADR 0018 D4 (`docs/adr/0018-m1-postgres-schema.md:77`) records the plan:
  "Force-push *detection* uses the webhook `before`/`after` ancestry (free,
  per-event)" — designed, never implemented. Detection semantics: on
  `synchronize`, `before != stored head` or a non-ancestor `before→after`
  pair signals rewrite; ancestry itself needs one compare API call
  (`compare/before...after` → `status: "diverged"` for a force-push).

### The three-dot merge-base noise gap

- Documented at `packages/brief-core/src/github/fetch.ts:153-160`; the
  worker's octokit path (`pull-request.ts:233-238`) has identical
  semantics. Exact failure mode after a rebase/force-push: prevHead is no
  longer an ancestor of the new head, so
  `compare/prevHead...newHead` diffs from `merge-base(prevHead, newHead)` —
  typically the pre-rebase branch point. The "incremental" diff then
  re-includes (i) all previously-briefed work reachable from the branch
  point and (ii) upstream main changes absorbed by the rebase. Consequences
  today: over-marked comparison marks (everything looks new-this-revision),
  a span size that usually trips the 0.65 huge-span guard
  (`generate.ts:1162,1307`) → narrative skip stub + delta-core skips. On a
  **pure rebase** (identical patches, new SHAs) the honest answer is "nothing
  changed", but the system reports either everything-changed or span-too-large.

### Data that exists to mitigate

- **Per-revision `baseSha`**: every brief row stores its own
  `(baseSha, headSha)` span (`generate.ts:702-707`; ADR 0018 D3), and the
  skip-if-exists lookup already matches on **both** endpoints
  (`generate.ts:620-623`), so `prevBrief.baseSha !== info.baseSha` is a
  free, already-persisted rebase/base-advance signal at generation time.
  The webhook also delivers the current base SHA per event
  (`events.ts:110,321`).
- **`diff_snapshot`** (ADR 0018 D4; ADR 0006 #8 "durable baseline"): the
  table and store exist
  (`packages/persistence/src/stores/artifact-store.ts:149,338,616-…`) with
  the planned payload "the `base→checkpoint` diff we already fetched" —
  but there is **no production writer or reader**: nothing in
  `packages/worker` or `apps/web` touches `diffSnapshots` (repo grep). The
  force-push-durable baseline is schema-only today.
- **Local clone**: none, anywhere. ADR 0006 #5 chose tree-diff over commit
  replay precisely for rebase robustness, but the only tree-diff transport
  in the system is the (three-dot) compare API.

### Patch-equivalence with GitHub API data only

- What's fetched today: only the **raw diff** media type
  (`application/vnd.github.diff`) for both the whole PR
  (`pull-request.ts:122-141`) and compare spans (`pull-request.ts:228-250`).
  The same endpoints in their default JSON form also return per-file
  entries with `filename`, `status` (added/removed/modified/**renamed**),
  `previous_filename`, and a `patch` string per file (subject to GitHub's
  caps: patches omitted for very large files; compare file list capped at
  300 files) — none of that is consumed anywhere yet.
- Per-file patches are already derivable locally from the raw diff via
  `splitDiffByFile` (`diff.ts:20-40`), so a patch-equivalence check needs
  no new endpoint: fetch `oldBase...oldHead` and `newBase...newHead`
  (or reuse the stored previous whole-PR diff if one is retained — it is
  not persisted today, ADR 0016 #10 / ADR 0018 D4 "no raw diffs
  persisted"), normalize each per-file patch (drop `index`/hash lines and
  hunk-header line numbers — the fields `parsePatch` already ignores or
  regex-extracts, `revchanges.ts:27`), and hash — a REST-only approximation
  of `git patch-id`. Constraint: the previous head's compare diff must be
  re-fetchable, and force-push GC can make `prevHead` unreachable —
  GitHub keeps unreachable commits fetchable for a while but not forever
  (the same GC argument that motivated `diff_snapshot`, ADR 0018 D13).
- A true two-dot `git diff base head` is **not available over REST**; only
  the three-dot compare exists (`fetch.ts:157-159` calls the two-dot path
  "a known CLI limitation to revisit").

**Implications for the design (b).** Force-push *detection* is nearly free
(webhook `before`/`after` are parsed and typed but dropped on the floor;
`baseSha` drift per brief row is already persisted). Rebase-robust
*equivalence* is harder: the only rebase-proof primitives are (i) hashing
normalized per-file patches from two whole-PR compares (base…head is
merge-base-stable per side, so whole-PR patches are comparable even when
the incremental prevHead…head span is noise), and (ii) the unimplemented
`diff_snapshot` persistence that would pin the previous side against GC.
Anything comparing prevHead→head directly must first classify the push
(fast-forward vs rewrite), because three-dot output is only trustworthy in
the fast-forward case.

---

## (c) What partial frame exists for stitching cached + regenerated regions into one artifact?

### Id stability — the central hazard

- Chunk and group ids are **model-invented**: `"stable chunk id, e.g. c1"`
  (`types.ts:223`), `"stable group id … e.g. g1"` (`types.ts:270-274`).
  "Stable" means stable *within one artifact*, not across generations —
  nothing seeds or pins ids between briefs, and two generations over the
  same PR can partition groups differently.
- The persistence layer treats this as a known hazard: ADR 0018 D7 —
  dispositions are "anchored by content coordinates, never a brief-local
  id … brief-local ids dangle on regeneration"; ADR 0018 D12 — the
  revision narrative is FK'd to **one specific `brief` row** because its
  `briefChangeGroupId`s die with that brief ("a regenerated Brief cascades
  the old narrative away").
- CLI-owned metadata is cleanly separated: the model never produces `pr`,
  `index`, `commitRange`, `generation` (`BriefGenerationSchema` omit,
  `types.ts:604-612`) — those are assembled post-generation
  (`categorize.ts:286-295`), which is precedent for post-generation
  assembly of an artifact.

### Validators / salvage — what a merged artifact must satisfy

- Hard-fail: only Zod schema validity at generation time (strict
  structured output, plus the adapters' one feedback retry); salvage is
  limited to dropping bad tokens in `SALVAGE_FIELDS`
  (`categorize.ts:63-69` — supplementary enum arrays only, never
  structural fields).
- Warn-and-drop invariants a stitched brief must preserve
  (`packages/brief-core/src/generation/validate.ts`):
  - Partition: every `chunk.changeGroupId` resolves; every group has ≥1
    chunk and ≥1 carrier (`validate.ts:28-53`).
  - `readingOrder` is an **exact permutation** of group ids
    (`validate.ts:86-114`) — dropping or adding groups invalidates it.
  - `intentCheck.*[].groupIds` must reference live groups
    (`validate.ts:296-304`; alarm buckets *drop* on a dangling anchor,
    `validate.ts:364-383`).
  - `concernView` is model-produced and never recomputed/validated — a
    stitch that changes chunks silently stales the rollup.
- These validators run **inside `categorize()`** (`categorize.ts:230-299`);
  a post-generation stitch would sit after them and would need to re-run
  the structural ones itself (they are exported, pure functions).
- Read paths are tolerant: the worker's retry-recovery guard is structural
  only (`isBrief`, `generate.ts:974-988`); the FE has its own hand-rolled
  tolerant parser (`apps/web/src/features/brief/utils/validation.ts`), not
  a `BriefSchema.parse`.

### Would a stitched artifact break marks / narrative consumers?

- **Comparison marks are id-free** (file + ranges only, D13) — independent
  of stitching.
- **Narrative generation** consumes the brief as alignment context —
  group id/title/summary + chunk file/ranges/group-id
  (`renderBriefContext`, `categorize.ts:490-511`) — and its output is
  validated against `brief.changeGroups` (`validate.ts:63-77`). A stitched
  brief with coherent group ids feeds it identically.
- **FE narrative callout** resolves `narrativeChunk.briefChangeGroupId`
  against the rendered brief's groups with graceful fallbacks
  (`comparison.ts:235-273`); the delta callout matches by file+line, not id
  (`comparison.ts:281-304`). `groupSinceMarkers` uses only group→file sets
  (`apps/web/src/features/brief/components/BriefScreen/utils.ts:55-77`).
- The binding constraint is the **line-number joins** (section a): every
  overlay/slice consumer assumes chunk ranges are current-head coordinates,
  so carried-over chunks are only renderable after range remapping.

### Where a stitch step could sit in the worker pipeline

- The generation boundary is `generateArtifacts()` in
  `packages/worker/src/task/generate.ts`: fresh-brief branch runs
  `categorize(...)` at `generate.ts:690-700`, marks
  `GenerationPhase.WRITING` at 701, and persists via `store.briefs.write`
  at 702-713. A stitch step slots **between 700 and 702** — after
  generation (or replacing it for untouched regions), before the write; the
  written body is the single source every later consumer reads.
- Inputs available at that point: `priorBriefs` list (619), `prevBrief`
  row (625-627), and the previous body recoverable via
  `store.briefs.get` + `recoverBrief` (the retry-resume path already does
  exactly this, `generate.ts:743-750`). **Ordering caveat**: the
  prevHead→head span diff is fetched only *after* the brief write
  (`generate.ts:787-789`) — a diff-scoped regeneration needs that fetch
  hoisted ahead of the model call.
- Idempotency is preserved as long as the stitched artifact writes through
  the same `(baseSha, headSha)`-keyed store (skip-if-exists at 620-623;
  ADR 0006 #6 content-addressed writes). The narrative call requires the
  (stitched) `generatedBrief` in hand (`generate.ts:1119-1124`), so
  stitching must complete before revision artifacts.

**Implications for the design (c).** The artifact model already separates
model analysis from CLI-assembled metadata, validators are exported pure
functions, and every downstream consumer either ignores ids (marks), joins
by file+line (delta callout, slicing), or resolves ids with fallbacks
(narrative callout) — so a stitched artifact is structurally viable at one
clear boundary. The two hard constraints are: ids from a carried-over region
and a regenerated region must be made non-colliding and internally coherent
(partition/readingOrder/intentCheck invariants), and carried-over chunk
ranges are unusable without head-coordinate remapping. Whole-brief-scoped
fields (`summary`, `concernView`, `intentCheck`, `readingOrder`,
`commitRange`, provenance) have no per-region decomposition today — any
stitch has to decide per-field between recompute, regenerate, and accept-stale.
