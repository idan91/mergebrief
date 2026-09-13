# GroupCard Flag list: implementation plan

Spec: `docs/plans/brief-234-risk-surface-spec.md` (NORMATIVE). Map: [GroupCard Flag list](https://app.notion.com/p/3d85e9400eeb819697bdc322fe0e3d90).

This plan ships the Chooser working Flag list on the attributed GroupCard. It does not ship the prototype route. Leave-it is rejected; do not keep today's attribute-major `RiskSurface`.

Confirmed 2026-09-12. Do not start implementation in this turn.

## Git requirements (git-eng, mandatory)

Invoke the `git-eng` skill for every git operation during implementation. No `Co-Authored-By` trailers. No AI attribution on commits or PR bodies.

Confirmed with Idan on 2026-09-12:

- Stay in this worktree.
- New branch `feature/BRIEF-234/chooser-flag-list` off `origin/main`. Do not continue the product work on `prototype/group-card-flag-list`.
- Do not stage prototype-only files: `apps/web/src/prototype/`, `apps/web/src/routes/prototype.group-card-flag-list.tsx`, the `prototype.groupCardFlagList.*` catalog keys, `apps/web/src/routeTree.gen.ts`, or the `src/prototype/**` coverage exclude in `apps/web/vite.config.ts`. Stash or leave them unstaged. Restore those tracked files before the product PR if they are dirty.
- Carry onto the feature branch: the spec, the `CONTEXT.md` **Risk note** entry, and the production UI.
- Agent commits, chunked (docs, then the green UI). Ready-for-review PR via `gh`, base `main`, title `[BRIEF-234] feat: Replace The GroupCard Flag List With A File-Major Chooser`. Body: Overview, Changelog, Images (screenshot of a heavy group), verification line. `unslop` the body.
- Before every commit: `performance-reviewer` on `git diff --cached`. Findings at confidence 80 or above get fixed and re-reviewed before the commit. No `security-reviewer`.

## Specialist skills (mandatory, confirmed 2026-09-12)

- `typescript-eng`: every code change.
- `tdd`: every production behavior. The prototype is exploration; do not copy `Chooser.tsx` into production and test after. Write the failing GroupCard / `RiskSurface` test first, watch it fail on today's list, then implement. The prototype stays a visual reference in this worktree.
- `web-accessibility`: the spec already locks the contract (24px hits, `aria-expanded` / `aria-label` on the notes twist, reduced-motion, path `title`). Implement it as you go, not as a follow-up.
- `vercel-react-best-practices`: the list sits in a sticky, viewport-capped column. No extra memo, no layout thrash, no new animation beyond the existing 0.2s twist.
- `impeccable` Operate audit at the end, incumbent tokens. The spec is the brief; do not redesign. One detector pass on the rendered GroupCard Flag list after the UI is green.
- Standing: `unslop` on the PR body; judge gates by exit code; no env-file globs.

Not in scope for implementation: `/prototype` as a ship vehicle, `/grilling`. Domain terms are already in `CONTEXT.md`.

## Shape

One PR. The header-chip union cannot come out before the per-file chips exist, and `groupFlagsByFile` has no other consumer, so a view-model-only PR is dead code.

Estimate ~800-1100 LOC, at the acceptable ceiling:

| Area | Why |
| --- | --- |
| `RiskSurface` rewrite + `RiskSurface.module.scss` | Replaces 334 lines of attribute-major list; new file-major chrome. |
| Drop `headerRisk` | `AttributedGroupCard` union, `buildGroupHeaderRisk`, viewModel tests, `.groupRiskRow`. |
| `RiskSurface/utils.ts` + tests | `groupFlagsByFile`, `capitalizeSentence`, path-jump Chunk pick. |
| i18n | Heading counts, notes toggle, resolved fold. `pnpm generate:types` if params change. |
| Tests | GroupCard reopen still; new chooser / fold / own-draft / mixed-chip cases. |
| Spec + CONTEXT | Already written; first commit if you want them on the branch. |

Do not split for review. The product is one surface.

**Model and effort:** high-capability, sequential, main thread in this worktree. The chrome is easy to drift from the spec. No subagents: TDD and the prototype reference have to stay in one conversation.

**Invocation:** one session. Docs commit first (optional). Then red-green on the list until the spec's glance / act / fold / own-draft cases are green. Then drop the union. Then browser-check a heavy group. Then impeccable Operate (incumbent tokens) on the rendered list.

## What to build

Replace `AttributedGroupCard/RiskSurface/RiskSurface.tsx`. Keep the GroupCard shell (title, summary, categories, sticky column). Own-draft stays `flagsReadOnly`: no checkboxes, no toolbar, no Reopen.

Decompose at birth: list SCSS moves to `RiskSurface.module.scss`. Reuse GroupCard `.checkbox` (14px amber) or the same declarations; do not invent a third checkbox. Twist is a filled-triangle SVG next to `RiskSurface` (one `.svg` per mark, 10px), not ChunkCard's unicode `▶` and not the prototype file (that file does not ship).

Reuse existing act machinery: `toggleRiskGroup`, `setEvidenceTarget`, `setDismissTarget`, `reopenFlag`, `jumpToChunk`. Do not open a second workplace. Evidence / Dismiss modal contracts do not move.

i18n lives under `brief.group.*`, not `prototype.groupCardFlagList.*`. Heading `Risk surface`. Counts `N files · N flags` as two plural keys composed in code (middle dot in the layout, not an em dash). Drop `brief.group.riskSurfaceCount` and `brief.group.attributesNotVerdicts` from the section once unused. Notes toggle: `Risk notes`. Fold: `N resolved`. Reopen stays `brief.group.reopen` / `ariaLabelReopen`. Address / Dismiss stay `addressSelected` / `dismissSelected`.

`groupFlagsByFile` is presentation. Flags stay `(chunk × attribute)` in the view model. File order is first appearance in the group's chunk order. Path jump: first open Flag's Chunk on that file, else the first Flag's Chunk.

Delete `headerRisk` / `buildGroupHeaderRisk` / `group-risk-union` in the same PR. Knip will flag the field if the render goes and the type stays.

Leave `RiskChipDisclosure` and `Callout` alone. Wrap catalog copy in `--font-size-sm` / `--dim`. Repo-policy criteria and implication stay in that callout. Risk notes are the per-file fold, sentence-cased on render.

## Tests (write first)

Extend `GroupCard.test.tsx` and add `RiskSurface` tests. Coverage must stay at the apps/web 75% floor. Prototype glob stays out of the product tree, so it does not help the floor.

Minimum behaviors, each watched red on today's list:

- Heading is `Risk surface` with file and flag counts. No `attributes, not verdicts`. No header `group-risk-union`.
- One row per file; two Chunks of the same path are still one row.
- Checkbox selects that file's open Flags. Address / Dismiss absent until a selection exists. No per-Flag button pair.
- Notes twist closed by default; opens labeled notes; files without notes keep a slot.
- Mixed file stays in the open list; resolved chips on it are present and dimmed.
- A fully resolved file leaves the open list for `N resolved`. Reopen only on dismissed. Addressed has no Reopen.
- `flagsReadOnly` strips controls and keeps the list readable.
- Existing reopen-to-wire case still passes (control now lives in the fold).

Do not add tests that snapshot the prototype.

## Verification

```sh
pnpm -C apps/web test
pnpm -C apps/web typecheck
pnpm -C apps/web lint
```

Judge by exit code. Browser-check the attributed GroupCard on a heavy Flag list (brief 73 / g3 locally, or the next heavy group in Postgres): glance, select, Address / Dismiss modals, notes twist, resolved fold, own-draft, jump on the path, reduced-motion. Compile the SCSS; do not ship unbuilt styles.

## Out of this PR

- Prototype route and `apps/web/src/prototype/**`.
- ChunkCard chips, Focus Disposition, Receipt as workplace.
- Evidence / Dismiss modal internals.
- CONTEXT **Jump-rail**.
- GroupCard visual restyle.
- Growing the sticky card.

## Confirmed before implementation

1. Skills: typescript-eng, tdd, web-accessibility, vercel-react-best-practices, impeccable Operate at the end.
2. Branch: `feature/BRIEF-234/chooser-flag-list` off `origin/main` in this worktree.
3. Commits: agent, chunked logical units.
4. Pre-commit review: `performance-reviewer` only.
