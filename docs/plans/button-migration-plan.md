# Button migration plan (BRIEF-187)

Implementation plan for `button-component-spec.md`. Shape: **bounded
strangler** — one planned 8-PR stack; each PR is atomic (component + ALL its
call sites + the now-dead CSS deleted in the same PR). No
"introduce component, migrate later" PR ever. Coexistence exists only inside
the stack's lifetime; the final Button PR deletes `.btn` from `base.scss` with
grep-proof of zero users. Siblings ride the same stack — no follow-on stacks.

Disposition source: `button-call-site-census.md`, with two remaps locked by the
sibling-set decision: link-like BESPOKE rows (GroupCard file jump, SinceMarker
delta link, SummarySection toggle, MarkReadyModal prose jumps) → LinkButton;
ReadingToolbar steppers → IconButton. Scope additions: plain `target="_blank"`
anchor sweep → AccessibleLink; `compact` → `sm` rename rides the `.btn`
migration.

## PR stack (8 PRs, stacked, in order)

| # | PR | Scope | Est. LOC |
|---|---|---|---|
| 1 | Button + `.btn` sites | Button component (+ AccessibleLink-less `as="a"` stub via plain anchor branch), 26 `.btn` sites incl. 2 anchors, `compact`→`sm` rename | ~900 — watch ceiling |
| 2 | Button remainder | ~24 sites (`rowStyles.action` grammar, GroupCard, TokenSettings revoke, …) + delete `.btn` from `base.scss` (grep-proof) + dead local classes; fixes the `rowStyles.action` aria-disabled styling bug by construction | ~500 |
| 3 | IconButton | ~11 sites (7 icon + 4 steppers); 26px→sm nudge flagged; BriefDetailsPanel 18px→sm/24px hit area | ~450 |
| 4 | RowButton | 7 sites + delete InlineThreads `botButton` dup; adds missing `aria-expanded` at CommentThread collapsed card | ~400 |
| 5 | ToolbarButton + Chip | 5 + ~7 sites; kills the byte-identical tbtn/trigger triple | ~500 |
| 6 | MenuItem + menu triggers | 5 items; OrgSwitcher/LocalePicker triggers → Button `secondary` + delete their dup rules | ~450 |
| 7 | LinkButton | ~10 link-like sites incl. remapped bespoke + MarkReadyModal prose jumps; adds missing `aria-expanded` at SummarySection | ~400 |
| 8 | AccessibleLink + lint | AccessibleLink + `_blank` anchor sweep + wire Button `as="a"` through it; both lint rules (see Enforcement); ~11 bespoke disables-with-reason | ~450 |

Ordering rationale: Button first establishes the Base+AsX type pattern and the
disabled model the siblings inherit. A11y fixes ride the PR that touches the
site. Each PR stays under the ~1,000 LOC ceiling; PR 1 is the one to watch —
if it busts the ceiling at implementation time, split the `.btn` sites by
feature folder, never by "component now, call sites later".

## Enforcement (lint, not convention)

- ESLint `no-restricted-syntax` banning raw `<button>` JSX in `apps/web/src`
  outside the shared components' own files. The ~11 bespoke sites (scrim,
  tooltip anchors, gutter overlay, mini-map tick, ChunkCard select-text toggle,
  Tab, …) each carry `eslint-disable-next-line` + one-line reason — the
  disables ARE the allowlist, visible at point of use, reviewed like any
  lint-disable. Ships in PR 8 when grep is already zero.
- Companion rule banning `target="_blank"` on raw `<a>` — ships in PR 8 with
  AccessibleLink.
- No headless `BareButton` escape hatch — rejected as pure indirection; a
  disable-with-reason carries more information.

## Proof obligations (every PR)

- Before/after playwright screenshots of migrated surfaces (BRIEF-185 harness
  recipe). Hosting: agent stages PNGs + SendUserFile; Idan drag-drops into the
  PR description — raw.githubusercontent URLs never render in this private
  repo. No orphan screenshot branches.
- /impeccable audit per PR on the migrated surfaces (plan-time election),
  plus the full audit after PR 8.
- `pnpm -C apps/web test` + lint green per branch (exit codes, per-branch on
  the stack).

## Execution requirements

- **Git (mandatory via `git-eng` skill for all git operations):** stacked
  branches off main, one per PR, `feature/BRIEF-187/<slug>` naming; PR titles
  `[BRIEF-187] refactor: …`; chunked commits; no AI-attribution trailers or
  footers. Squash-merge realignment via `rebase --onto` (watch-pr-stack flow);
  never plain-pull a rebased branch.
- **Reviewer gates per PR:** `reviewer` + `performance-reviewer` on the
  branch diff before marking ready. Medium+ findings iterate; nitpick-only =
  clean. Two review rounds max without stated reason.
- **Mandatory specialist skills:** `typescript-eng` (const-map unions,
  Base+AsX pattern, strict TS), `web-accessibility` (aria-disabled model,
  min targets, roving tabindex), `impeccable` (per-PR + final audits).
- **Model + invocation per PR:** all 8 PRs = Fable 5, medium effort — the spec
  locks every design decision, so implementation is transcription + careful
  call-site migration; reviewer gates catch slips. Sequential in the main
  thread (each PR stacks on the previous); no parallel subagent
  implementation. Reviewer gates run as subagents per branch.
