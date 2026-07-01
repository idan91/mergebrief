# Plan — Comparison Overlay and Revision Narrative

> Status: **approved, ready to implement.** Created 2026-07-01.
>
> Purpose: replace the current "Full / Delta" split with a clearer product model:
> the timeline selects a **Brief** head, **View** selects full context vs changed-only,
> and **Compare** selects whether that head is compared against the **Previous Brief**
> or **Your last review**. This plan implements the generated **Revision narrative**
> for the shared previous-brief comparison, and extends the FE so comparison highlights
> work inside the full Brief for both shared and personal baselines.

Grounded in: `CONTEXT.md` terms **Comparison baseline**, **Comparison overlay**,
**Previous Brief**, **Revision changes**, **Revision narrative**, **Delta Brief**;
ADR 0019 (timeline navigation), ADR 0021 (revision-changes overlay), and ADR 0024
(comparison baselines + generated revision narratives).

## Reference ADRs

Read these before implementation; they define the boundaries this plan relies on:

| ADR | Role | Why it matters here |
| --- | --- |
| [ADR 0024 — Comparison Baselines and Generated Revision Narratives](../adr/0024-generated-revision-narrative.md) | **Main / controlling** | The controlling decision for this plan: View + Compare, generated Revision narrative, mechanical marks for selectable comparison spans, and replacement of the `Full / Delta` lens. |
| [ADR 0021 — Revision-Changes Overlay on the Full Brief](../adr/0021-revision-changes-overlay-on-full-brief.md) | **Main / inherited** | Defines the mechanical previous-brief line marks and full-Brief overlay rendering model. ADR 0024 supersedes only the opportunistic-callout generation piece. |
| [ADR 0019 — Brief Timeline Navigation](../adr/0019-brief-timeline-navigation.md) | Supporting | Keeps timeline points as full Brief heads; superseded only where ADR 0024 replaces the `Full / Delta` lens. |
| [ADR 0006 — Delta Brief: Per-Reviewer Generation, Caching, and State Model](../adr/0006-delta-brief-generation-and-state-model.md) | Supporting | Defines **Checkpoint -> head** Delta Briefs, pre-warming, huge-span fallback, and why personal deltas are per reviewer. |
| [ADR 0007 — Delta Comment Anchoring and Flag Carry-Over](../adr/0007-delta-comment-anchoring-and-flag-carry-over.md) | Supporting | Owns the personal carry-over semantics that remain part of `Compare: Your last review`. |
| [ADR 0008 — Brief & Delta: Persistence Model and Fetching](../adr/0008-brief-delta-persistence-and-fetching.md) | Supporting | Defines Brief, Delta core, carry-over overlay, and diff artifact keys; use this when mapping local artifacts to production storage. |
| [ADR 0011 — Delta Comments Addressed and Per-Chunk Summary](../adr/0011-delta-comments-addressed-and-per-chunk-summary.md) | Supporting | Explains the existing Delta per-chunk summaries that `Changes Only + Your last review` reuses. |
| [ADR 0012 — Brief Index, Commit Range, and Comments on Brief](../adr/0012-brief-index-commit-range-and-comments-on-brief.md) | Supporting | Defines Brief indices and endpoint labels; required for **Previous Brief** selection and artifact naming. |
| [ADR 0013 — Provider-Agnostic Generation and BYOK](../adr/0013-provider-agnostic-generation-and-byok.md) | Supporting | Defines the Generator/provenance boundary the new Revision narrative prompt should use. |
| [ADR 0020 — Brief Trigger and Activation Model](../adr/0020-brief-trigger-and-activation-model.md) | Supporting | Defines eager/debounced Brief generation, which this plan extends for non-first Brief comparison generation. |

## Product Model

The top-level mental model becomes:

```text
Timeline:  Brief _N at head SHA X

View:      Full Brief | Changes Only
Compare:   Your last review | Previous Brief | Off
```

Timeline navigation remains one point per full **Brief** head. The current top
`Full / Delta` lens is replaced by **View** and **Compare** controls:

- **View: Full Brief** renders the full Brief at the selected timeline head.
- **View: Changes Only** renders only the selected comparison span.
- **Compare: Off** is available only in Full Brief view; it means no comparison
  highlights, callouts, or filtering.
- **Compare: Previous Brief** means `prevHead -> currentHead`, shared by all viewers.
- **Compare: Your last review** means `checkpoint -> currentHead`, personal to the
  reviewer.

Valid states:

| State | Meaning |
| --- | --- |
| `Full Brief + Off` | Normal full Brief for the selected head. |
| `Full Brief + Previous Brief` | Full Brief with shared latest-revision highlights and callouts. |
| `Full Brief + Your last review` | Full Brief with personal since-checkpoint highlights and callouts. |
| `Changes Only + Previous Brief` | The generated Revision narrative for `prevHead -> currentHead`. |
| `Changes Only + Your last review` | The existing Delta Brief for `checkpoint -> currentHead`. |

Invalid state:

- `Changes Only + Off` has no product meaning. If a user switches to Changes Only
  while Compare is Off, select the product default comparison. If no comparison is
  available, disable Changes Only.

Defaults:

- Returning reviewer with an older Checkpoint: `View: Changes Only`,
  `Compare: Your last review` when arriving for re-review; preserve user choice within
  the session after they change it.
- First-time reviewer: `View: Full Brief`, `Compare: Off` by default.
- First-time reviewer on a non-first Brief may select `Previous Brief`; do not force it
  as the default unless user research says latest-revision highlighting is less noisy
  than the clean full Brief.

## Decisions Locked During Grilling

| Decision | Resolution |
| --- | --- |
| Shared latest-revision summaries | Generate them as product behavior for non-first Briefs, not merely opportunistically. |
| Artifact shape | Add a lean **Revision narrative** artifact, not the existing Delta Brief schema. |
| Prompt | Add a separate revision-narrative prompt. Do not reuse the Delta prompt's "since you last looked" language. |
| Inputs | Generate from the incremental `prevHead -> head` diff plus the current full Brief as context. |
| Grouping | Revision narrative chunks attach to the full Brief's existing Change-group IDs; no parallel changedGroups. |
| Highlighting | Always mechanical, keyed by `(baselineSha, headSha)`. Generated narratives explain marks but never decide them. |
| FE model | Timeline selects the Brief head; View selects full vs changed-only; Compare selects previous-brief / personal / off. |
| Naming | User-facing changed-only view is **Changes Only**. "Delta Brief" stays internal/domain language. |

## Implementation Sequence

### 1. Generalize Mechanical Comparison Marks

Current state:

- `tools/categorizer/src/revchanges.ts` builds `prevHead -> head` changed-line ranges.
- The FE calls these `RevisionChanges` and treats them as the only full-Brief overlay.

Change:

- Rename or wrap the underlying concept as a comparison-marks artifact keyed by
  `(baselineSha, headSha)`.
- Keep a compatibility path for existing `.revchanges.json` while the local demo is
  migrated.
- The data can stay structurally identical:

```ts
interface ComparisonMarks {
  baselineSha: string;
  headSha: string;
  baselineLabel: "previous-brief" | "checkpoint";
  baselineIndex: number | null;
  files: {
    file: string;
    addedRanges: LineRange[];
    removedRanges: LineRange[];
  }[];
}
```

Notes:

- `Revision changes` remains the domain name for the shared `Previous Brief` case.
- Do not derive highlights from generated narrative chunks or Delta chunks.
- FE matching still joins on head-side added/context rows and old-side deletion rows.

### 2. Add Revision Narrative Schema

Add a lean schema in `tools/categorizer/src/types.ts`:

```ts
interface RevisionNarrative {
  artifactKind: "revisionNarrative";
  pr: PrRef;
  prevHeadSha: string;
  headSha: string;
  prevIndex: number;
  headIndex: number;
  generation: Generation;
  overview: string;
  chunks: RevisionNarrativeChunk[];
}

interface RevisionNarrativeChunk {
  id: string;
  briefChangeGroupId: string;
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
  summary: string;
}
```

Deliberately excluded:

- `commentsAddressed`
- `addressesComments`
- `wholePrImpact`
- reviewer identity / Checkpoint
- independent `changedGroups`

Validation:

- Every `briefChangeGroupId` must exist in the current full Brief.
- Every narrative chunk should overlap mechanical comparison marks for the same file.
- Warn, do not hard-fail, on imperfect coverage unless schema validity itself fails.

### 3. Add Revision Narrative Prompt and Categorizer

In `tools/categorizer/src/prompt.ts`:

- Add `buildRevisionNarrativeSystemPrompt()`.
- Reuse the closed vocabularies and line-range rules from the brief/delta prompts.
- Use shared, non-personal language:
  - "in this revision"
  - "since the previous Brief"
  - never "since you last looked"

In `tools/categorizer/src/categorize.ts`:

- Add `categorizeRevisionNarrative(input, generator, log)`.
- Input includes:
  - PR metadata and linked context
  - `prevHeadSha`, `headSha`, `prevIndex`, `headIndex`
  - incremental `prevHead -> head` diff
  - current full Brief, trimmed to the context needed for alignment:
    - change group IDs, titles, summaries, categories
    - chunks with file/ranges/group IDs

Prompt instruction:

- Attach each narrative chunk to an existing full Brief Change-group.
- Summarize only the incremental changed lines.
- If a changed line belongs to a full Brief group, use that group's ID.
- If the model cannot confidently align a changed line, still emit a chunk with the
  closest group and mark uncertainty in prose rather than inventing a group.

### 4. Wire Generation for Non-First Briefs

In `tools/categorizer/src/index.ts` / shared generation path:

1. Generate and write the full Brief.
2. If `index > 1`, find `prevHeadSha` via the manifest.
3. Fetch `prevHead -> head` compare diff.
4. Write mechanical comparison marks.
5. Generate and write the Revision narrative.

Failure behavior:

- Mechanical marks failure should be surfaced because it means comparison data is
  unavailable.
- Revision narrative failure should not fail the full Brief. Write logs clearly and
  allow FE to show "summary unavailable" for callouts.

Output naming:

- Keep `.revchanges.json` during migration for compatibility.
- Add a new sidecar, e.g.
  `<stem>_<index>_<head8>.revision-narrative.json`.
- If comparison marks are generalized immediately, prefer
  `<stem>-<base8>..<head8>.comparison.json` for span-keyed marks and keep the old
  filename as an alias for previous-brief spans.

### 5. Represent Comparison Availability in the Local Read Model

Current state:

- `LocalBriefSummary` knows `artifactKind: "brief" | "delta"`.
- `buildBriefTimeline` maps each head to at most one `deltaId`.

Change:

- Keep timeline points as Brief heads.
- Add comparison availability per timeline point:

```ts
interface BriefTimelinePoint {
  briefId: string;
  headSha: string;
  index: number;
  comparisons: {
    previousBrief?: {
      marksId: string;
      narrativeId?: string;
      baselineSha: string;
      baselineIndex: number;
    };
    lastReview?: {
      marksId: string;
      deltaId: string;
      baselineSha: string;
      baselineIndex: number | null;
    };
  };
}
```

Local/demo limitation:

- There is no real reviewer identity or Checkpoint yet. For local artifacts, infer
  `Your last review` from available Delta artifacts, as today.
- Production will select the reviewer Checkpoint through auth/session state.

### 6. Replace Full/Delta Lens with View + Compare Controls

Current state:

- `TimelineNavigator` renders Previous/Next, revision select, and a `Full / Delta`
  lens linked to different artifact IDs.

Change:

- Timeline controls continue to navigate Brief heads only.
- Replace `Full / Delta` with:
  - `View`: `Full Brief`, `Changes Only`
  - `Compare`: `Your last review`, `Previous Brief`, `Off`
- Store state in URL search params, not path artifact IDs:
  - `/briefs/$briefId?view=full&compare=previous`
  - `/briefs/$briefId?view=changes&compare=last-review`
  - `/briefs/$briefId?view=full&compare=off`
- Invalid URL states normalize:
  - `view=changes&compare=off` -> choose default active comparison.
  - unavailable comparison -> fallback to `compare=off` in Full Brief, or the other
    comparison in Changes Only if available.

Copy:

- Use labels `Full Brief`, `Changes Only`, `Your last review`, `Previous Brief`, `Off`.
- Do not show "Delta" in the primary UI.
- When a comparison is unavailable, disable the button with a short title:
  - `No previous Brief for this revision`
  - `No submitted review checkpoint yet`

### 7. Render Full Brief Comparison Overlays

Current state:

- Full Brief can show Revision changes marks when `revisionEnabled`.
- Callouts bind against a matching Delta artifact if present.

Change:

- Replace `RevisionOverlayState` with `ComparisonOverlayState`.
- Feed it:
  - selected comparison kind
  - mechanical marks
  - narrative source (`RevisionNarrative` or `DeltaBrief`)
- Generalize `buildChunkRevisionView` to `buildChunkComparisonView`.
- Generalize `DeltaCallout` to `ComparisonCallout`.

Callout content:

- For `Previous Brief`, title comes from the full Brief's Change-group; body comes from
  the matching Revision narrative chunk summary.
- For `Your last review`, title/body come from the existing Delta Brief matching logic
  until a cleaner adapter is introduced.
- If marks exist but no summary matches, show the existing honest unavailable state.

### 8. Render Changes Only

For `Compare: Previous Brief`:

- Render the Revision narrative as a compact changed-only view.
- Group narrative chunks by their attached full Brief Change-group.
- Use the full Brief group title/category for headers.
- Render only the incremental diff slices for narrative chunks.

For `Compare: Your last review`:

- Reuse the existing Delta Brief rendering path.
- Rename visible copy from "Delta brief" to "Changes Only".
- Keep Delta-specific context sections where useful, but avoid introducing the word
  Delta as a primary label.

Out of scope:

- `Changes Only + Off`
- a compact base->head "overview" mode

### 9. Tests

Categorizer:

- Schema accepts a valid Revision narrative and rejects invented fields.
- `categorizeRevisionNarrative` fills CLI-owned metadata and generation provenance.
- Validation warns when `briefChangeGroupId` does not exist.
- `generateAndWrite` writes Revision narrative for non-first Briefs and skips it for
  first Briefs.
- Revision narrative generation failure does not fail full Brief generation.

FE unit tests:

- Timeline points preserve Brief navigation independent of comparison availability.
- URL state normalization handles invalid `changes + off`.
- `Compare` buttons disable unavailable baselines.
- Full Brief + Previous Brief uses previous-brief marks and Revision narrative callouts.
- Full Brief + Your last review uses checkpoint marks and Delta callouts.
- Changes Only + Previous Brief groups narrative chunks under full Brief groups.
- Changes Only + Your last review renders the Delta artifact under "Changes Only" copy.

Characterization / browser checks:

- Existing full Brief route still renders with `compare=off`.
- Non-first Brief shows `Previous Brief` comparison available.
- When a local Delta exists, `Your last review` appears as a peer compare option.
- `Changes Only` cannot be selected without an available comparison.
- Keyboard access: segmented controls are reachable, labelled, and update route state.

### 10. Migration / Compatibility

- Keep reading existing local `.delta.json` artifacts.
- Keep reading existing `.revchanges.json` during migration.
- Existing direct links to a Delta artifact should redirect or normalize to the
  corresponding head Brief with `view=changes&compare=last-review`.
- Existing direct links to a Brief artifact should default to
  `view=full&compare=off`.

## Risks / Watch-outs

- **Concept overload.** The UI must not teach "global delta" versus "personal delta."
  It should teach View and Compare.
- **Prompt drift.** Revision narrative must not say "you" or imply reviewer state.
- **Parallel grouping.** Revision narrative must not create a second taxonomy. It
  attaches to full Brief groups.
- **LLM incompleteness.** Highlighting must stay mechanical; narrative summaries can be
  absent without hiding marked lines.
- **Local identity gap.** "Your last review" is only approximated from local Delta
  artifacts until production has real Checkpoints.
- **Route churn.** Changing Delta from a path artifact to a `view=changes` state needs
  redirect compatibility so old demo URLs do not break.

## Suggested Commit Chunks

1. `docs`: ADR/context already captured; add this plan.
2. `feat(categorizer): add revision narrative schema and prompt`.
3. `feat(categorizer): generate previous-brief comparison artifacts`.
4. `refactor(web): model comparison availability on timeline points`.
5. `feat(web): replace Full/Delta lens with View and Compare controls`.
6. `feat(web): generalize revision overlay to comparison overlay`.
7. `feat(web): render Changes Only for previous-brief narrative`.
8. `test`: characterization/browser coverage for the new state matrix.

## Out of Scope

- Real production Checkpoint selection and auth; local uses available Delta artifacts.
- Carry-over overlay changes beyond consuming the existing Delta Brief for
  `Your last review`.
- A base->head compact mode for `Changes Only + Off`.
- Selectable arbitrary baselines beyond `Previous Brief` and `Your last review`.
