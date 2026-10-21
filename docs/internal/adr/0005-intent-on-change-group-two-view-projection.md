# 0005: Intent Lives on the Change-Group; Brief Is a Two-View Projection

Status: amended (see Amendments)

Intent (Category + Summary) attaches to a **Change-group** — a cluster of chunks accomplishing one coherent piece of work — not to individual chunks. Each **Chunk** carries a **Concern** (`implementation`/`test`/`doc`/`spec`/`config`/`generated`), a **Role** (`carrier`/`supporting`), and its own **LoC**. The brief is read through two pivots over the same chunk set: a **Story view** (by Change-group) and a **Concern view** (by Concern).

## Context

Two product asks drove this: (1) show LoC (added/deleted) per category, non-prominent; (2) a higher-level split separating the actual code change from tests/docs/specs. Working through them exposed that the original model attached Category to the *chunk*, which produced nonsense for supporting artifacts — a test chunk in a bugfix PR would be tagged as its own "bugfix," when in reality it *supports* the production bugfix and carries no independent intent.

## Considered Options

- **Intent on the chunk (original).** Every chunk independently categorized. Rejected: produces "bugfix in a test file" noise; no clean home for the Concern split; doesn't match how engineers frame PRs (one intent, carried by implementation, with supporting tests/docs).
- **Concern as a pure independent per-chunk axis (Option A in grilling).** Every chunk gets both an independent Category and a Concern. Rejected: still independently categorizes supporting chunks, re-deriving intent where none exists.
- **Concern from file-path only, no intent linkage (Option C).** Compute Concern from path; leave Category on chunks. Rejected: gives the LoC split but severs the link between a test and the intent it supports.
- **Formal sub-operation tree within a chunk.** Decompose a hunk into sub-spans ("lines 10–18 are the move, 19–31 are the fix"), each with its own Category and LoC. Deferred, not rejected: genuinely powerful (generalizes `move-with-edits`) but explodes Phase 1 labeling cost and Phase 2 categorizer difficulty. The same signal is expressed cheaply for now via dominant+secondary Categorization on the group plus a text callout in the Summary. Revisit in v2 if reviewers want line-level operation attribution.
- **Intent on the Change-group + carrier/supporting Role + two-view projection (chosen).**

## Why This Way

Intent in real PRs lives in the implementation change; tests, docs, and specs are in service of it. Modeling the Change-group as the intent unit matches that reality and gives both product views a clean foundation from one dataset:

- **Story view** (pivot by Change-group): summary + dominant/secondary Categories + rolled-up LoC. The narrative/intent reading.
- **Concern view** (pivot by Concern): implementation vs test/doc/spec LoC. The attention router — "how much is real code vs scaffolding."

No recompute to switch views; they are two reads of chunks tagged `(group, concern, role, LoC)` and groups tagged `(categorization, summary)`. The carrier/supporting Role defaults from Concern (`implementation` → carrier) and is flippable for the rare case where a supporting artifact is the purpose (flaky-test fix, coverage backfill).

This also corrected a latent taxonomy bug: `test-only`, `config-only`, and `generated-code` were artifact-concerns masquerading as intents. They become Concern values; Category stays purely intent.

## Consequences

- **Hard to reverse.** Moving intent from chunk to group ripples into Phase 1 hand-labeling, the brief format, the stub brief, the playbook library, and the eventual data model / API schema.
- **Playbooks remain valid** but split by where they key: intent playbooks key on the group's Dominant Category; supporting-chunk checks key on Concern (e.g., a `test` Concern check: "does it fail without the carrier change?").
- **Phase 1 labeling protocol changes:** label Change-groups (summary + Categorization) and tag each chunk with Concern + Role + LoC, rather than labeling chunks with Categories directly.
- **LoC is a distribution, never a verdict** — shown only in-corner per Category and per Concern bucket, never as a headline size number. Consistent with the anti-anchoring / no-verdict stance (see ADR 0002, and the rejected "critical areas" framing).
- **Sub-operation decomposition is explicitly deferred** — if Phase 1 shows demand for line-level operation attribution, it becomes a v2 scope item.
- **Downstream docs must be propagated** to the new model: `docs/internal/mvp/phase-1.md`, `docs/internal/mvp/briefs/labeling-workflow.md`, `docs/mvp/briefs/nextjs-93940.md`, `docs/internal/mvp/playbooks.md`, `docs/vocabulary/risk-surface.md` (concern interplay).

## Schema realization (2026-06)

The categorizer schema now places group membership **on the chunk** — `chunk.changeGroupId` (+ its `role`) — and the **group carries no chunk-id arrays**, exactly matching this ADR's "chunks tagged `(group, concern, role, LoC)`, groups tagged `(categorization, summary)`." An earlier implementation listed `carrierChunkIds`/`supportingChunkIds` on the group; that representation let the model emit a chunk in two groups (duplicate) or in none (orphan) — both seen during dogfooding. Putting the group id on the chunk makes the partition structural: each chunk has exactly one required `changeGroupId`, so duplicates and orphans are impossible by construction. A light post-parse `validatePartition` covers the residuals (a dangling group ref, a group with no carrier). The Story view is `group by changeGroupId`; the projection is unchanged.
