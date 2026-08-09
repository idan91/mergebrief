# AI-Authorship Risk Attributes — Implementation Plan

> Implements [ADR 0026](../adr/0026-ai-authorship-risk-attributes.md). Decisions are locked;
> this records the execution shape, file by file. Created 2026-07-03.

## Scope

Add `new-dependency`, `new-abstraction`, `comment-contradicts-code` as ordinary
model-observed Risk-Surface attributes, end to end: categorizer emission + validation,
FE rendering. No new inputs, no detector pass, no in-product "AI" grouping (ADR 0026).

Out of scope (explicit): per-flag confidence field (2026-06-19 decision — separate work),
`unresolved-reference` / `diverges-from-sibling-pattern` (parked behind ContextSource,
ADR 0014), README/demo positioning copy (P1 surface, separate pass).

## Design notes

- **Evidence note (the one schema addition).** ADR 0026's cite-or-stay-silent for
  `comment-contradicts-code` needs a home; `riskSurface` today is a bare enum array.
  Additive optional field on the chunk: `riskNotes` as an **array of `{ attr, note }`
  objects** (not `z.record` — record keys compile to `additionalProperties` in JSON
  schema, which strict structured-output modes reject; every existing schema here is
  arrays/objects). One short factual note per attribute per chunk — for
  `comment-contradicts-code` it must cite both sides: "comment says X (L12), code does Y
  (L15)". Old artifacts parse unchanged (field optional); generic by design — any
  attribute may carry a note later.
- **Validator (warn-and-drop, mirrors `validateReadingOrder`):** drop the *attribute*,
  never the chunk; each drop logs a warn issue.
  - `comment-contradicts-code` with no matching `riskNotes` entry → drop.
  - `new-dependency` → mechanical confirm from the chunk's own diff: file is a package
    manifest (`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`,
    `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`) AND an added line
    introduces a dependency key that no removed line also carries (same key on both
    sides = version bump, which is `lib-bump`/`dependency-update` Category territory,
    not this attribute) → else drop.
- **Prompt discipline:** `new-abstraction` fires on existence of a new named
  abstraction only (never on relocations — `pure-move`/`move-with-edits`);
  `comment-contradicts-code` fires only when both the comment and the code are visible
  in the diff, else stays silent; `new-dependency` on new direct deps only. All three
  are authorship-agnostic — the prompt never mentions AI authorship.

## Steps

### 1. Categorizer — schema + prompt

- `tools/categorizer/src/types.ts`
  - `RiskSurfaceAttributes` const (~line 57): append the three tokens under the
    "about the CHANGE" comment. Zod enum + `RiskSurfaceAttribute` type follow for free.
  - `ChunkSchema` (~line 146, next to `riskSurface`): add
    `riskNotes: z.array(z.object({ attr: riskSurfaceEnum, note: z.string() })).optional()`
    with a `.describe()` stating the cite-both-sides requirement for
    `comment-contradicts-code`.
  - Delta path: mirror both additions on the delta chunk schema (~line 400 region) if it
    doesn't reuse `ChunkSchema` — delta chunks carry `riskSurface` today.
- `tools/categorizer/src/prompt.ts`
  - `RISK_GLOSS` dict (lines 37–66): three new descriptions under "about the CHANGE"
    (one-liners matching `docs/mvp/risk-surface.md`).
  - Brief "## Risk surface" section (~line 114): short firing-discipline paragraph for
    the trio + the `riskNotes` instruction (when to attach, citation format).
  - Delta prompt section (~line 199): same two additions.
- Tests: `prompt.test.ts` (tokens + discipline text present in built prompts),
  `types.test.ts` (riskNotes parses; absent field still valid).

### 2. Categorizer — validation

- `tools/categorizer/src/validate.ts`: new `validateRiskAttrTrio(chunks, fileDiffs)`
  returning `{ chunks, issues }` (pure — sanitized copy, no mutation). Rules per Design
  notes; manifest-file set + added/removed dep-key heuristic live here as small helpers
  (do **not** name anything `manifest.ts` — that file exists for the artifact manifest).
- `tools/categorizer/src/categorize.ts`: wire it where the other warn-and-drop checks
  run — after generation, before artifact assembly, both Brief (~line 121) and Delta
  (~line 224) paths; pass the parsed per-file diffs already available from `diff.ts`.
- Tests in `validate.test.ts`:
  - `comment-contradicts-code` with note → kept; without note → dropped + warn.
  - `new-dependency` on `package.json` chunk adding a new key → kept; version bump
    (same key added+removed) → dropped; non-manifest file → dropped.
  - Other attributes with notes pass through untouched; chunk itself never dropped.

### 3. FE

- `apps/web/src/features/brief/types.ts`
  - `RiskSurfaceAttributes` const object (line 26): `NewDependency: "new-dependency"`,
    `NewAbstraction: "new-abstraction"`,
    `CommentContradictsCode: "comment-contradicts-code"`.
  - `BriefChunk` (line 107): `riskNotes?: { attr: RiskSurfaceAttribute; note: string }[]`.
- `apps/web/src/features/brief/viewModel.ts`
  - `RISK_DESCRIPTIONS` (line 55): three entries in the existing reviewer-action tone
    ("…; verify the dependency earns its place — stdlib or an existing dep may cover it").
  - `RiskFlag` (line 30): optional `note?: string`; the flag-building loop
    (`buildViewModel`, ~line 146) looks up the chunk's `riskNotes` entry for the attr and
    threads it on.
- `apps/web/src/features/brief/components/GroupCard/GroupCard.tsx`: the rail's flag rows
  (risk-surface block, ~line 137+) render `flag.note` as a secondary line when present.
  Same visual weight as existing description copy — no "AI" styling (ADR 0026).
  Receipt/SummaryPreview/PreSubmitModal read the same `RiskFlag`; notes flow only if
  trivial, otherwise unchanged.
- `apps/web/src/features/brief/fixtures.ts`: one chunk gains a trio attribute +
  `riskNotes` entry so the characterization suite exercises the render path.
- Tests: `viewModel.test.ts` (note threading, missing-note flag renders without note);
  characterization `briefScreen.test.tsx` if flag-count assertions shift.

### 4. Verify

- `pnpm --dir tools/categorizer typecheck && test && lint`; same for `apps/web`
  (characterization suite green).
- Browser pass (`playwright-cli`) on the local demo brief: flag row with note in the
  rail, popover unaffected; screenshot for the PR.
- Manual (BYOK): regenerate a brief against one real PR that adds a dependency;
  eyeball trio firing + validator warns in the log.

## Git workflow (git-eng)

- Branch: `feature/risk-attr-trio` off `main`; PR back to `main`, **ready for review**.
- **Chunked commits**, one per step above (plan doc is its own commit).
- **Security review gate:** run `security-reviewer` on staged changes before every code
  commit; findings with confidence ≥ 80 → fix, re-stage, re-run until clean. (Skipped for
  the docs-only plan commit.)
- No `Co-Authored-By` trailers; no AI-attribution in commits or PR description.
- PR title: `feat: Add AI-Authorship Risk Surface Attributes`. Description via the
  standard Overview/Changelog template; include the rail/note screenshot
  (frontend-touching PR).
