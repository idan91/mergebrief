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
| --- | --- | --- |
| [ADR 0024 — Comparison Baselines and Generated Revision Narratives](../adr/0024-generated-revision-narrative.md) | **Main / controlling** | The controlling decision for this plan: View + Compare, generated Revision narrative, mechanical marks for selectable comparison spans, and replacement of the `Full / Delta` lens. |
| [ADR 0021 — Revision-Changes Overlay on the Full Brief](../adr/0021-revision-changes-overlay-on-full-brief.md) | **Main / inherited** | Defines the mechanical previous-brief line marks and full-Brief overlay rendering model. ADR 0024 supersedes the opportunistic-callout generation piece and the decision-5 toggle (default + persistence). |
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

Product default comparison — one precedence rule wherever the product picks a
comparison on the user's behalf (defaults, `changes + off` normalization):

- **`Your last review` if available, else `Previous Brief`.** The personal baseline
  is strictly more relevant when it exists.
- Availability means the mechanical marks exist. A marks-only `Your last review`
  (Delta narrative failed) still wins — the marks are the comparison; falling back
  to `Previous Brief` would silently switch the user's baseline, worse than a
  missing summary.

Defaults:

- Returning reviewer with an older Checkpoint: `View: Changes Only`,
  `Compare: Your last review` when arriving for re-review; preserve user choice within
  the session after they change it.
- First-time reviewer: `View: Full Brief`, `Compare: Off` by default.

Persistence model (View and Compare, decided during grilling): **session-only**.

- Selected state always lives in URL params — shareable and refresh-stable.
- Within a visit, the user's choice sticks across timeline navigation.
- No cross-session persistence (no localStorage): each arrival recomputes the
  product-aware default. Unlike ADR 0021's per-user toggle (a stable taste
  preference), Compare is lifecycle-dependent — persisting `Off` from a first read
  would suppress the `Your last review` default exactly on the return visit where
  it matters most. Revisit only if users report reset fatigue.
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

Marks emission rule — **whoever fetches a compare diff for a baseline also writes
the mechanical marks sidecar for that `(baselineSha, headSha)` pair**:

- The main generation path (step 4) writes `previous-brief` marks for
  `prevHead -> head`.
- `delta-cli` writes `checkpoint` marks from the incremental diff it already
  fetches, **before** the Delta LLM call. A failed Delta generation still leaves
  marks on disk; the FE shows highlights with the honest "summary unavailable"
  state. No reuse trick keyed on the delta baseline coinciding with `prevHead` —
  that is the coincidence dependency ADR 0021's local-first consequence forbids.
- Production Checkpoint pre-warming follows the same invariant: marks before
  narrative.

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

Huge-span fallback (mirrors ADR 0006):

- Reuse ADR 0006's size-fallback threshold — one shared per-repo knob, not a second
  narrative-specific one. Both fallbacks answer "is this span too big to summarize
  incrementally?"; two knobs invite unprincipled drift.
- Past the cap: skip the narrative LLM call, still write mechanical marks (diff
  parsing is cheap and ungated), and write an explicit stub artifact recording
  `skipped: span too large` so the FE can distinguish "deliberately skipped, retry
  won't help" from "generation failed, retry might help".

Config gate (BYOK cost control, per ADR 0023):

- Per-repo YAML namespace, default on:

  ```yaml
  revisionNarrative:
    enabled: true
  ```

- Namespace, not a bare boolean, so future cost knobs (e.g. push-frequency gating)
  extend it without a breaking config change. Frequency gating itself is deferred:
  ADR 0020's debounce is the existing per-push cost lever, and skipping narratives
  leaves permanent holes in the `prevHead -> head` chain (skipped means gone, not
  deferred), so the knob's shape should come from real OSS-user demand.
- When disabled: marks still generated; narrative stub records
  `skipped: disabled by config`.

Output naming:

- Keep `.revchanges.json` during migration for compatibility.
- Add a new sidecar, e.g.
  `<stem>_<index>_<head8>.revision-narrative.json`.
- If comparison marks are generalized immediately, prefer
  `<stem>_<baselineLabel>_<base8>-<head8>.comparison.json` for span-keyed marks
  (no `..` in filenames — hostile to globbing; label-keyed so checkpoint marks
  never clobber previous-brief marks when a checkpoint equals prevHead) and
  keep the old filename as an alias for previous-brief spans.

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
      /** Absent when Delta generation failed; marks still render. */
      deltaId?: string;
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
  - `/briefs/$briefId?view=full&compare=previous-brief`
  - `/briefs/$briefId?view=changes&compare=last-review`
  - `/briefs/$briefId?view=full&compare=off`

  Canonical `compare` param values: `previous-brief` | `last-review` | `off`
  (`previous-brief` matches the marks artifact's `baselineLabel`; `last-review`
  is the user-facing name for the `checkpoint` baseline).
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
- `delta-cli` writes checkpoint marks before the Delta LLM call; a failed Delta run
  still leaves the marks sidecar, and the FE renders highlights with the
  summary-unavailable state.
- Over-threshold `prevHead -> head` span skips the narrative call, writes marks and
  the `skipped: span too large` stub; FE surfaces the skip reason.

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

## Execution Tracking

Orchestrated as 4 sequential subagent stages with review gates between them.
Check items off as they land.

Git workflow (locked via git-eng):

- Branch: **`feature/comparison-overlay`** off `main` — all stage commits land here.
- Commit strategy: the Suggested Commit Chunks below, committed per stage. No
  Co-Authored-By trailers, no AI attribution.
- Pre-commit review agents: none — the orchestrator reviews each stage's diff at
  the gates instead.
- End state: push branch + open a **ready** PR to `main` after Stage 4 and the
  manual browser pass.
- Human gates: narrative-quality eyeball after Stage 1 (live generation against a
  real PR); browser/keyboard pass after Stage 4.
- Stage agents follow the `git-eng` commit rules and `typescript-eng` code
  standards.

**Session A — Categorizer artifacts**

- [x] Stage 1: steps 1-4 + categorizer tests (marks generalization, narrative
      schema/prompt/wiring, delta-cli marks-first, huge-span stub, config gate)
- [x] Verify: generate against a real PR, eyeball narrative + marks JSON
      (approved; summary-length guidance tightened to ~25-word budget)
- [x] ~~Handoff document~~ — not needed: stages run orchestrated in one
      session; as-built context travels in stage-prompt amendments

**Accepted deviations (Stage 1, reviewed):**

- Huge-span threshold did not exist in code (ADR 0006 documented it; the Delta
  path never implemented it). The one shared knob now lives in `huge-span.ts`
  (ratio 0.65, `HUGE_SPAN_RATIO` env override) wired into the narrative path
  only. **Follow-up (pre-existing debt, not this plan):** wire it into the
  Delta path too.
- Config gate is env-based (`REVISION_NARRATIVE_ENABLED`, default on), not
  per-repo YAML — no YAML loader exists anywhere yet (ADR 0013 defers it). The
  namespace-shaped `RevisionNarrativeConfig` interface lets a YAML loader slot
  in without caller changes.
- `delta-cli.ts` `main()` extracted into testable `generateAndWriteDelta`,
  mirroring `index.ts`'s existing pattern.

**Session B — FE**

- [x] Stage 2: steps 5-6 (timeline comparisons, View + Compare controls, URL
      normalization)
- [x] Stage 3: steps 7-8 (comparison overlay generalization, Changes Only
      rendering)
- [x] Stage 4: steps 9-10 (migration redirects, characterization/browser checks,
      keyboard access) + carried-in items below
- [x] Verify: manual browser pass against real local demo artifacts
      (`playwright-cli`) — legacy-alias Brief, jump-nav, Changes Only, old
      Delta-URL redirect; typecheck + full suite green
- [x] ~~Handoff document~~ — not needed: Stage 4 ran in the same session

**Accepted deviations (Stage 2, reviewed):**

- `BriefTimelinePoint` drops the top-level `deltaId` (only the nested
  `comparisons.lastReview.deltaId` remains).
- Default precedence split in two: `defaultComparison` (last-review, else
  previous-brief) backs `changes + off` normalization; the fresh-arrival
  default checks only `lastReview` — reconciling the precedence rule with
  "never force Previous Brief on first-timers".
- View/Compare render as native buttons driving `navigate` (same-route state,
  not links); URL stays the source of truth.
- `narrativeId` in availability means "artifact exists to fetch" — it may be a
  skip stub; readers discriminate on `artifactKind`.

**Accepted deviations (Stage 3, reviewed):**

- Changes Only + Previous Brief renders head-side rows within each narrative
  chunk's `addedRanges` plus a "−N lines removed" note — the FE holds base→head
  chunk diffs, not the prevHead→head incremental diff. Faithful subset, no
  fabricated rows. **Optional follow-up:** emit a prevHead→head per-file diffs
  sidecar from the categorizer for true incremental slices.
- Legacy `.revchanges.json` is not consumed by the overlay (availability is
  built purely from `.comparison.json`); wiring it as a previous-brief alias is
  step 10 — carried into Stage 4. Until then, briefs with only legacy sidecars
  show no Previous Brief comparison locally.
- `Changes Only + Your last review` renders a purpose-built **compact read-only
  digest** (delta summary + context + groups with read-only diff slices), not
  the old full-page Delta rendering the step 8 text implied. Accepted after the
  fact (initially unflagged): ADR 0024 defines the View axis as density — the
  same View setting must produce the same page shape for both baselines — and
  the interactive work surface (comments, flags, mind-map) deliberately
  consolidates on `Full Brief + Your last review` with the overlay. The old
  full delta view survives only via legacy direct URLs that cannot redirect.

**Carried into Stage 4:**

- Step 10 migration: read legacy `.revchanges.json` as previous-brief marks
  alias (see Stage 3 deviation above).
- Fix pre-existing jump-nav no-op: `useRevisionNavigation` queries
  `main .diff .railbtn-focus`, which CSS-module hashing never emits.

**Accepted deviations (Stage 4, reviewed):**

- Legacy alias is a read-time mapping, not a migration script: when no
  `.comparison.json` exists for a head, `readComparisonMarks` falls back to
  the brief's own `.revchanges.json` and remaps its header
  (`prevHeadSha`/`prevIndex` -> `baselineSha`/`baselineIndex`,
  `baselineLabel: "previous-brief"` implied) — `RevisionChanges.files` and
  `ComparisonMarks.files` are already the same shape. The availability
  builder hands out the brief's own id as `marksId` only for this alias path;
  no `narrativeId` ever accompanies it (legacy sidecars never had a
  narrative).
- `readLocalBriefSummaries` was hardened to fail-closed per-Brief (skip and
  warn) instead of throwing for the whole listing when one artifact is
  transiently unreadable/malformed — matches the fail-closed discipline
  already used for marks/narrative scanning in the same function. Found while
  adding the legacy-alias characterization test, which made an existing
  cross-test-file race (parallel test files writing/deleting fixtures in the
  shared `tools/categorizer/out` directory) visible; the hardening makes the
  listing itself robust regardless of the test-only trigger.
- `useRevisionNavigation`'s DOM query moved to `main [data-jump-target]`
  (`RevisionGutterCell`'s rail button), and the direction-picking logic was
  extracted into a pure, unit-tested `findJumpTarget` helper; the DOM-coupled
  measuring stays in the hook.
- Old Delta-artifact redirect implemented as a route `beforeLoad` (throws
  `redirect()`) rather than a loader-time check, so it runs before any Brief
  data fetch and the pre-ADR-0024 shape never renders even momentarily. Falls
  through to normal rendering (not an error) when the Delta's head Brief
  can't be found locally, rather than dead-ending the link.
- Small a11y fix folded into this stage (not scope creep — directly asked
  for): TimelineNavigator's View/Compare buttons only conveyed selected state
  via `data-state`/visual styling; added `aria-pressed` so the state is
  programmatically determinable (WCAG 2.2 4.1.2). Visible focus (global
  `:focus-visible` outline) and Esc-dismiss on the comparison rail/callout
  were already correct and are unchanged.
- Gap found, not fixed (pre-existing, unrelated to this stage): manual
  browser check surfaced a React duplicate-key console error
  (`widely-imported:src/index.ts`) specific to `Changes Only + Your last
  review` on one real local Delta artifact
  (`Idan91-components-4-35788079..a01bcf1d`), sourced in
  `buildBriefViewModel`'s risk-flag id construction (`viewModel.ts`), not in
  any Stage 4 code. Reachable before this stage too (via manual Compare
  selection); the redirect just routes an old URL to an already-existing
  view. Flagged for a separate fix, not expanded into this stage's scope.

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
