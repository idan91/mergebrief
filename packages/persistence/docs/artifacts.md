# Artifact stores

- Writes are idempotent `ON CONFLICT (natural key) DO UPDATE`; natural keys lead with `installation_id`. `comparison_marks` and `hunk_span` bodies are coordinates-only (strict Zod; no `baselineLabel`/`baselineIndex`/line content), so neither holds code. `revision_narrative` writes verify brief anchoring.
- `brief`, `delta` and `revision_narrative` carry a NOT NULL `body_version`, and every writer stamps its body shape version; a rewrite replaces the stamp with the body.

## Comparison marks

`comparison_marks` carries `prev_base_sha` and `new_base_sha`, NOT NULL: the bases each head's PR diff was read against when its span was computed. Every write replaces them, and marks never certify a core computed from other bases: a writer writes the row before the key's narrative and delta only when neither is stored, else after them, so its refs certify what is stored under the same key, and `comparisonMarks.delete` drops a stale row before the key is rewritten. `revision_narrative.skipped` and `delta.skipped` stamp any skip record at write, for the comparison listing. The span read refuses a key only when its stored narrative or delta body is a span-too-large skip record, read from the body, so a narrative off by config or a delta cut at its output cap is never a refusal.

## Generation parts

`generation_part` (`stores/generation-part/`) holds a multi-call run's grouping output and finished detail calls under the brief's span (`base_sha`, `head_sha`) and a `part_key` (`GENERATION_PART_KEY_PATTERN`, CHECK-held; the store writes and reads back only brief-core's `PartKey` shapes, and a stored key off them throws `InvalidArtifactBodyError`), so a retry resumes from them.

- Its body is a `kind`-discriminated union (`GenerationPartBodySchema`, `GenerationPartKinds`). A `grouping` part carries brief-core's `GroupingGenerationSchema` (the grouping answer) plus the sha-256 digest of the `.gitattributes` it was read under (`gitAttributesDigest`) and the anchor plan it grouped under (`anchorPlanDigest`). A `detail` part chunks only over brief-core's `PartChunkSchema` (which accepts a repo's custom risk names by shape). No key beyond the grouping output or a detail call's attribution, so a part never holds code text.
- The schema is closed at the body and the chunk, and nested shapes drop unknown keys; the stored text is the parsed value, and a body off the closed levels throws `InvalidArtifactBodyError` on write and on read.
- `deleteForSpan` is the only reader-side removal; `sweepStaleGenerationParts` and the pull request's cascade are the others.

## Chunk layouts

`chunk_layout` (`stores/artifact-store/chunk-layout.ts`, `createArtifactStore(...).chunkLayouts`) is the one sidecar keyed by a `brief` row (`brief_id` unique, the conflict target), holding the brief's per-chunk and per-remainder-file row counts under brief-core's closed `ChunkLayoutBodySchema`, so it never holds code text.

- `briefs.write` replaces it inside the brief's own transaction (a write without `chunkLayout` drops it), so a rewritten brief never keeps the previous run's counts.
- `chunkLayouts.backfill` backfills a brief stored without one, verifying the brief in scope and on the same PR in its transaction, and never replaces an existing row.
- The read joins `brief` on the span (`base_sha`, `head_sha`). A brief with no row is the reader's estimate path.
