# BRIEF-44 — FE conventions, token system, and the BriefPage split

Status: plan locked (grill 2026-07-26). Inputs: the ticket's Research subpage
(audit + five owner-direction sections) and the grill decisions recorded here.
Everything is in scope (owner call): convention + split + defects + styles
sweep, chunked across PRs.

## Locked decisions (the convention)

1. **Layers.** No pages layer: route files are glue only (data loading +
   composition). `features/<domain>/` is the domain layer; a feature root
   holds flat logic files with tests adjacent; `components/` inside it is the
   UI subtree, folder-per-component. Global layer: `src/components/`,
   `src/hooks/`, `src/utils/` (renamed from `lib/`), `src/styles/`.
   Revisit trigger: routes becoming 1:1 with features long-term.
2. **Subtree ownership rule (one rule, four surfaces: components, hooks,
   utils, styles).** Descendants may import an ancestor's co-located files;
   lateral imports (outside the owner's subtree) are forbidden and are the
   promotion tripwire. Promotion target = nearest common ancestor of all
   consumers; global is last resort. Dependency-direction cap: anything
   touching a feature's store/queries can never sit above that feature.
3. **Utils.** In-component functions = closure-dependent only; closure-free
   logic (transformations, formatting, derivations) extracts to a co-located
   `<Component>/utils.ts` for direct unit testing. Global utils:
   `src/utils/<type>.ts` per-type files (string/number/…); a new type file
   must start with 2+ functions serving 2+ consumers.
4. **Feature-root organization.** Flat by default; a cluster of ≥4 related
   files earns a topic folder (today only `features/brief/comparison/`
   qualifies). Provisional — reassess after the first structural PR.
5. **Tokens.** Zero raw values in `.module.scss` for colors, font-sizes,
   border-radii, and box-shadows — all via `var(...)`/mixins. Faithful-first:
   phase 1 tokenizes existing values with zero visual change; phase 2 (own
   screenshot-reviewed PR) collapses accidental scales into a deliberate one
   (`--fs-xs`…`--fs-xl` semantic-step naming). Off-scale oddities must be
   earned: declared as component-local tokens with a one-line justification,
   never added to the global scale. Spacing scale = out of scope (revisit
   trigger recorded).
6. **Token vocabulary.** Semantic `--color-*` family is canonical; legacy
   short names (`--bg`, `--line`, …) become aliases and retire file-by-file
   as the sweep touches each module.
7. **Data attributes.** `data-testid` for test selection; data-attrs for
   state/variant styling hooks (`data-state`, `data-variant` — CSS targets
   attributes, not toggled classes). Extracted components adopt both at birth.
8. **Enforcement.** Extend EXISTING tools only (stylelint in apps/web, oxlint
   at root — no ESLint/Biome): stylelint `declaration-property-value-
   allowed-list` for the token bar; oxlint rules for whatever it expresses of
   the TS standards (no-explicit-any, enum ban, restricted assertions,
   named exports, no-console in server dirs, import/no-cycle, lateral-import
   restriction if path patterns allow). What lint can't express stays prose,
   listed honestly. Test-as-enforcement: a guard test parsing every
   `var(--x)` usage and asserting definition in `tokens.scss` or locally.
   Editor-level `typescript-plugin-css-modules` (no build-time d.ts codegen;
   revisit trigger: a wrong-classname bug shipping past data-attr + plugin).
9. **Path alias.** Add `@web/` (or `@/`) alias; 89 triple-deep relative
   imports rewritten once, during structure motion (before the split so paths
   churn once).
10. **AGENTS.md.** The why + full rules land as an ADR; `apps/web/AGENTS.md`
    gets a lean ~10-line entry: only what agents cannot infer (placement
    procedure, token bar, inline-vs-utils, data-attr rule) + pointer to the
    ADR. Lint-enforced rules stay out of prose.
11. **BriefPage split shape** (all under `features/brief/components/`):
    `BriefPage/` (route wrapper) · `BriefView/` (data plumbing) ·
    `BriefScreen/` (layout + wiring, keeps the JSX; regions are already child
    components) with facade hooks `useReadingSession` / `useComparisonOverlay`
    / `useRiskFlagFlow` / `useOwnDraftFlow` / `useMarkReadyFlow` + `utils.ts`;
    `RiskFlagModals/` as a component. `useLatestRef` promotes to `src/hooks/`;
    `useChunkScroller` stays with the reading-session hook;
    `markReadyBatchFailureCopy` moves to the mark-ready flow's home.

## Git requirements (git-eng — mandatory for ALL git operations)

- Stacked PRs off `main` in spine order (standard stack pattern, confirmed).
  Retarget children to main BEFORE deleting merged parent branches
  (BRIEF-85 lesson). `--force-with-lease` only.
- Chunked commits per logical unit; security-reviewer + performance-reviewer
  on staged diff before every commit; findings ≥80 confidence fixed before
  committing.
- PR titles `[BRIEF-44] <prefix>: Title Case`; ready-for-review, base =
  predecessor branch; no AI attribution.
- fable-reviewer loop per PR until clean (medium+ iterates; low/nitpick-only
  = clean with leftovers noted in the PR body). Idan merges.
- LOC ceilings are hard gates: measure `git diff --stat` after every part;
  ideal <500 changed LOC, ceiling ~1000 (mechanical sweeps split per value
  family when they bulge). Chores get their own PR.

## Mandatory specialist skills (confirmed)

`typescript-eng` · `vercel-react-best-practices` · `codebase-design` (split
boundaries) · `web-accessibility` (extracted components keep/gain a11y;
focus-visible adoption) · `tdd` (guard/enforcement tests written test-first;
refactor PRs remain characterization-driven).

## PR spine

Sequential in spine order. Invocation (decided 2026-07-26, amended same day
for context-window management — no session-model switching, no bloated main
thread): ALL PRs dispatch to implementation subagents, spawned with the
model column below (`model: fable` for 1/5a/8, `model: opus` for the rest),
prompted from this plan plus a short per-PR brief. Context-heavy work (file
reads, sweeps, the BriefPage split) stays inside each subagent's context.
The orchestrating session (Fable 5) keeps only the compact parts: dispatch
briefs, git operations (chunked commits + pre-commit reviewer gates, judged
on `diff --stat` + reviewer verdicts), PR creation/bodies, and fable-reviewer
loops. Review-loop fixes: substantial ones continue the implementing
subagent (its context persists); trivial ones the orchestrator applies
directly. If orchestrator context still grows long, session-break points are
after PR 4 and after PR 5b — the memory note is the handoff.

| PR | Content | Est. LOC | Model / effort |
| --- | --- | --- | --- |
| 1 | ADR (FE placement + token conventions; next free ADR number) + lean `apps/web/AGENTS.md` entry | ~250 (docs) | Fable 5, medium |
| 2 | Defect fix: define `--accent`/`--muted`/`--danger` + the var-defined guard test (TDD: test first, red on main) | ~150 | Opus 5, medium |
| 3a | Color token sweep (92 hexes, focus-ring mixin at 24 sites, `#d9b36c` → token, dead-mixin adopt-or-delete w/ evidence in PR body) + stylelint allowed-list (colors) + `typescript-plugin-css-modules` | ~450 | Opus 5, medium |
| 3b | Font-size/radius/shadow faithful tokenization + stylelint rules extended + playwright screenshot baseline (local gate, before/after compare) | ~450 | Opus 5, medium |
| 4 | Structure motion: `@web/` alias + rewrite 89 deep imports, `lib/`→`utils/`, `features/brief/comparison/` topic folder, folder the `src/components` strays (Callout, ScreenReaderOnly) | ~700 (moves) | Opus 5, low |
| 5a | BriefPage split I: extract the five facade hooks + `utils.ts` + `useLatestRef` promotion. Step 0: verify `characterization/` selectors (data-attrs vs class/text; fix selectors first if needed — June lesson) | ~700 (moved) | Fable 5, medium |
| 5b | BriefPage split II: three component folders + `RiskFlagModals/` + `data-testid`/data-attr adoption on extracted components | ~500 | Opus 5, medium |
| 6 | Convention-violation cleanup + oxlint rules landing together: console.*→logging seam (ADR 0034), PascalCase vocab maps → SHOUT_CASE, inline-props export fix, no-cycle/no-console/enum/any rules | ~250 | Opus 5, medium |
| 7 | Wire-mirror drift pins (BRIEF-23-class gap; lockstep pins everywhere repoConfig already has them) | ~200 | Opus 5, high |
| 8 | Phase 2: scale normalization (deliberate type/radius/shadow scales, collapse fractionals, earned-oddity declarations) — screenshot-reviewed by Idan against the 3b baseline | ~200 | Fable 5, medium |

Verification per PR: `pnpm lint` (root, exit code) + `pnpm -C apps/web test`
suites green + characterization suite green (3a–5b) + screenshot compare
(3b, 5b, 8). No eval gate — FE-only, generation surface untouched.

## Sequencing rationale

Convention before code (PR 1); defect+guard first among code PRs (smallest,
user-visible bug); sweep before split so extracted components are born under
the token/lint regime; alias before structure motion so import paths churn
once; phase-2 normalization last because it is a visual decision, not a
refactor.

## Revisit triggers (recorded)

- Feature-root topic-folder threshold (decision 4) — reassess after PR 4.
- Spacing token scale — when a spacing-related bug or design pass warrants it.
- Build-enforced typed CSS modules — a wrong-classname bug shipping.
- pages/ layer — routes stabilizing 1:1 with features.
- BRIEF-84 executes after 3b (rem conversion = token definitions only) —
  coordinate, don't duplicate.
