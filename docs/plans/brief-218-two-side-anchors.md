# BRIEF-218 — Two-side draft anchors (GitHub start_side)

Implementation plan. Decisions were locked at the 2026-08-22 grill and live on
the BRIEF-218 ticket (Locked decisions section); this plan turns them into a
3-PR stack. Backward-compatible widening: single-side payloads stay valid and
byte-identical throughout.

## Locked decisions (summary — ticket is canonical)

1. GitHub-verbatim contract: `startSide` optional, defaults to `side`; both
   directions (old→new and new→old) allowed; shape-only validation, no diff
   index — GitHub judges at publish.
2. Ordering guards become conditional: the Zod `ORDERED_LINES` refine and the
   DB `review_draft_comment_line_range_shape` CHECK apply only when the range
   is same-side.
3. Normalization at write: `startSide == side` → stored NULL, never echoed.
   Invariant everywhere: non-null `start_side` ⇔ genuinely two-side.
4. Persistence: nullable `start_side` text column + numbered migration; side
   CHECK extended to the new column.
5. Carry-over: both-or-orphan. Old leg under the base rule, new leg under the
   hop rule; either leg unplaceable → whole draft `orphaned`. Never shrink to
   single-side.
6. Web authoring in scope: mixed selection allowed; start anchor from first
   selected row, end from last (del→old, add→new, context→new); a same-side
   result emits today's single-side payload unchanged.
7. Web render: side-blind contiguous span from start position to end
   position; label shows both signs via the i18n catalog; dedupe key gains
   `startSide`.
8. Scope adds: lockstep pin test for the web `SessionDraftComment` mirror;
   fix BOTH duplicated submit mappers; fold-degradation text shows sides.
9. CLI: `--start-side` on `draft create` and `draft reanchor` (shared anchor
   flags); `-F` payloads need no CLI change.

## Mandates

- **git-eng** must be used explicitly for all git operations (branching,
  commits, push, PRs). No `Co-Authored-By` trailers; no AI-attribution in PR
  bodies.
- Commit strategy: **chunked commits** per logical unit.
- Pre-commit gate on every commit: **security-reviewer + performance-reviewer**
  in parallel on staged changes; findings ≥80 confidence fixed before commit.
- Specialist skills mandatory: **typescript-eng** (all PRs), **impeccable**
  (PR3 rendered-UI audit; render-before-shipping-CSS rule applies).
- Per-PR flow: usual stack flow — push branch, **reviewer** subagent
  review, upstream-first fixes, 2-round review budget, Idan merges.
- Gates per PR: `pnpm -r test`, `pnpm lint`, `pnpm -r typecheck` (CI is
  billing-dead; local gates are the judge). Not a generation surface — no
  eval run.
- Repo rules bind: extensionless imports, no enum, named exports, verb-first
  function names, i18n catalog for user-facing copy, lean reference-free
  comments (this plan doc is the exception that may cite the ticket).

## Test fixture

Standing PR: `Idan91/git-playground#2` (keep open) — `two-side-fixture.txt`,
block A = del old 10-11 / add new 10-12, block B = del old 20 / add new 21.
Covers old→new (LEFT 10 → RIGHT 12), new→old across blocks (RIGHT 10 →
LEFT 20), single-side regression, and carry-over (push an insert above block A
for hop remap; rebase for base-moved orphan). Drive locally via the `verify`
skill recipe (seeded session + real repo id).

## PR stack

Stack order matters: PR2 depends on PR1's wire contract; PR3 on PR2's render
model. Sequential implementation in the main thread; model Fable 5 high
effort throughout (carry-over and refine logic in PR1 and the selection
derivation in PR3 are the subtle parts; nothing here is mechanical enough to
drop tiers mid-stack). Quota fallback per standing rule: Opus 5 high, noted
at runtime.

### PR1 — server: schema, persistence, submit, carry-over, CLI

Branch: `feature/BRIEF-218/server-start-side` (base: `main`)
Estimate: ~500-600 LOC incl. tests — single PR, review splits along commits.

Chunks:
1. **Wire schema** — `packages/api/src/routes/repos/pr/session/write-input.ts`:
   add optional `startSide` to `anchorShape` (one spot covers create +
   reanchor); rework `ORDERED_LINES` to apply only when
   `startSide == null || startSide === side`; normalize equal-to-side → strip
   before persistence. Echo in `payload.ts` only when non-null.
2. **Persistence** — `packages/persistence`: `review-draft-comment.ts` gains
   nullable `startSide` column; `types.ts` untouched (`DraftCommentSide`
   reused); new numbered migration: add column, extend side CHECK to
   `start_side`, make `line_range_shape` conditional on
   `start_side IS NULL`. Store row/patch/projections/insert pick up the
   field (`review-session.ts`).
3. **Submit mappers** — both copies: `review.ts` `shapeSubmitComment` and
   `comments.ts` `readDraftAnchor` map `startSide` old→LEFT/new→RIGHT with
   fallback to `side`; `foldedCommentBlock` degradation text renders sides
   for two-side ranges.
4. **Carry-over** — `packages/persistence/src/stores/carry-over.ts`: two-leg
   carry for non-null `start_side` — old leg base rule + new leg hop rule on
   one row; either leg fails → `orphaned`. Single-side paths byte-identical.
5. **CLI** — `packages/cli`: `--start-side` on `draft create` + `draft
   reanchor` (program.ts ×2, `AnchorFlags`/`FlagAnchor`, `anchorFromFlags`,
   `hasAnchorFlags`); raw string pass-through, server validates (exit 5).
6. **Tests** — write-input (both directions, normalization, conditional
   refine, single-side regression), migration/store round-trip, both submit
   mappers, carry-over legs (placed / hop-orphan / base-moved-orphan), CLI
   flag wiring.

### PR2 — web: render two-side drafts + mirror pin test

Branch: `feature/BRIEF-218/web-render` (base: PR1 branch)
Estimate: ~400-550 LOC incl. tests.

Chunks:
1. **Mirror + pin** — `serverState.ts` `SessionDraftComment` gains
   `startSide`; `isDraftComment` guard accepts it; NEW lockstep pin test
   copying the `pulls`/`brief` pattern (this closes the CI hole — do it
   first, red before the mirror widens).
2. **Render model** — `rowsForDraft` side-blind contiguous span from
   (startSide, startLine) to (side, endLine); `chunkForDraft` stays
   startLine-keyed but start-side-aware; stranded-row fallback correct for
   two-side; dedupe key (`store.ts`) gains startSide.
3. **Labels + copy** — mixed-range label with both signs via `packages/i18n`
   catalog entry; `CommentThread` and state labels stop assuming one sign.
4. **Write gateway** — `writes.ts`/`writeGateway.ts` types carry optional
   `startSide` (create + reanchor).
5. **Tests** — pin test, span selection across the fixture-PR diff shape,
   label rendering, dedupe collision case.

### PR3 — web: mixed-range authoring UI

Branch: `feature/BRIEF-218/web-authoring` (base: PR2 branch)
Estimate: ~300-450 LOC incl. tests.

Chunks:
1. **Selection derivation** — `comments.ts`: drop the `hasAdd && hasDel →
   null` rejection; derive start from first selected row, end from last
   (del→old, add→new, context→new); same-side result returns today's shape.
2. **Publish path liveness** — `utils/submit.ts` `WireComment`/
   `mapAnchorToWire`: widen for the still-live postComment/receipt paths;
   delete if the audit shows them dead (check before widening).
3. **Tests + audit** — selection derivation cases (mixed, same-side,
   context-bounded); then the **impeccable** audit on rendered states against
   the fixture PR via the `verify` recipe, screenshots measured before ship.

## Verification (end of stack)

Against `git-playground#2` locally: CLI-create both direction anchors, web
render check, web mixed-selection create, submit to GitHub (real POST accepts
`start_side`), carry-over push + rebase recipes. Single-side regression: an
existing draft flow unchanged end to end.
