# BRIEF-249: Build the Brief sidebar (This PR tab, desktop and narrow)

Ticket: https://app.notion.com/p/3ce5e9400eeb81d59288e79ad73c00b4
Spec: Brief sidebar IA spec (BRIEF-243), https://app.notion.com/p/3ce5e9400eeb8169b527f8401da710d8
Vocabulary: `CONTEXT.md` entries Sidebar, Tab, Focus mode, Scope, Header.

The spec decides every contract. This plan decides the cut into PRs, the order of work, and who runs each part. Where this plan and the spec disagree, the spec wins and this plan gets fixed.

## What ships

One Sidebar replacing three pieces of chrome, with no flag:

- `GroupTocBar` (desktop right-edge strip) becomes the collapsed Sidebar's group lines.
- The floating `?` button (`kbdHint` in `BriefScreen.tsx`) moves to the Sidebar foot, next to a new scroll-to-top control.
- The narrow-only toolbar group stepper in `ReadingToolbar` is removed. The bottom bar's arrows take over.

Expanded, the Sidebar shows a tabs row with one tab, This PR, listing the change groups. Desktop resizes the reading column to make room. Below the `tablet` breakpoint the same object is a bottom bar plus a modal sheet.

Non-goals stay non-goals: no Activity or Repo chat tab, no presence dot, no drag or swipe, no server-side preference, no breakpoint-scale rework (BRIEF-247), no change to J/K or the desktop stepper, no locale-picker move (BRIEF-250).

## Git requirements (git-eng, mandatory)

Invoke the `git-eng` skill for every git operation during implementation. Confirmed with Idan on 2026-09-02:

- Branches stack off each other, never wait on a merge. `feature/BRIEF-249/sidebar-foundations` off `main`, `feature/BRIEF-249/sidebar-desktop` off foundations, `feature/BRIEF-249/sidebar-narrow` off desktop.
- The agent commits in logical chunks within each branch. No `Co-Authored-By` trailers, no AI attribution anywhere.
- Before every commit, run `performance-reviewer` on the staged diff. That agent has no Bash, so write `git diff --cached` to a file in the scratchpad and hand it the path. Findings at confidence 80 or above get fixed and re-reviewed before the commit lands.
- Push each branch and open a ready-for-review PR with `gh`, base `main` for PR1, the previous branch for PR2 and PR3. Retarget children to `main` as parents merge (watch-pr-stack).
- Titles follow git-eng: `[BRIEF-249] feat: <Title Case>`. Bodies follow the git-eng template (Overview, Changelog, Images & Videos for the two visual PRs) and get an `unslop` pass before publishing or editing. Keep bodies short: what changed, what surprised us, one verification line.
- After the stack is up, the PR-stack lifecycle applies: one review subagent per PR, at most two rounds, medium-and-above findings only, fixes upstream first. Merging is Idan's.

## Specialist skills (mandatory, confirmed 2026-09-02)

- `typescript-eng`: strict TS, repo conventions from `CLAUDE.md` and `apps/web/AGENTS.md`.
- `impeccable`: design audit on the rendered UI for PR2 and PR3, before either is marked ready. The This PR list is explicitly "not a plain numbered list".
- `web-accessibility`: the spec's disclosure, tabs, dialog and focus rules are WCAG 2.2 work; audit each against the pattern before review.

Also binding, from repo rules rather than skill choice: render and measure CSS before shipping (compile, screenshot, measure with the browser, never reason from tokens alone), and the eval harness is untouched since nothing here is on the generation surface.

## Facts the cut rests on

From the code survey (2026-09-02):

- `GroupTocBar` is 384 LOC across tsx, scss and test, rendered inside `<main>` but `position: fixed`, hidden by a hand-written `@media (width <= 1120px)`. It reads `activeGroupId` from the reading-position store and jumps through `jumpToGroup`.
- `deriveVisibleRegions` in `regions.ts` returns `summary`, `toolbar`, `conversation`, `groupToc`. `BriefScreen.tsx` is its only consumer. Tests pin all four cases.
- The shortcut registry is a pure map in `useKeyboardShortcuts.ts`. Adding `S` is one entry, one action variant, one dispatch arm, one catalog row.
- The body is a column flexbox with no wrapper grid. An `<aside>` after `</main>` must be fixed-position, and `.main` (max 980px, auto margins, in `base.scss`) gets room via a CSS variable for padding, the way the prototype did with `26.5rem` and `4rem`.
- No tabs primitive, no bottom sheet, no scroll lock, no matchMedia hook, no zod in `apps/web`. `Modal` has a focus trap and dialog semantics but no scroll lock. `test/setup.ts` stubs `matchMedia` to always report `false`.
- `$breakpoints` and the `for-breakpoint` mixin exist in `styles/_functions.scss` and `_mixins.scss` but are marked unused. Until BRIEF-247 wires them, the 1120 value lives twice: once in SCSS, once in a TS constant beside the hook.
- Persistence precedent is the reply-draft module: `mergebrief.` prefix, try/catch, hand guards. The spec asks for a schema parse, which adds `zod` to `apps/web`.
- Coverage floor is 75% lines. Roughly 1,180 new source lines need about 380 lines of tests to hold it.
- The prototype stash on main (message contains "BRIEF-243") is reference only. Its reusable ideas: a matchMedia hook, the padding-resize effect, a body scroll lock, a tablist with roving tabindex. Read it, do not apply it.

## PR breakdown

Net change is about +1,170 LOC. Three PRs, each under the 1,000 changed-line ceiling, cut so PR1 has no visible change, PR2 is the desktop object and PR3 the narrow one. The stack lands as one unit before release; a partial merge leaves the page working at whichever width the merged PRs cover.

### PR1: foundations, no user-visible change

Branch `feature/BRIEF-249/sidebar-foundations`. About 320 changed lines: 200 source, 120 tests.

1. Create `apps/web/src/features/brief/components/BriefScreen/Sidebar/` with a curated `index.ts`. Files land in later PRs; this PR adds the state and hooks only.
2. `Sidebar/storage.ts`: the one localStorage key `mergebrief.sidebar`, a zod schema for `{ expanded: boolean, tab: "this-pr" }`, `readSidebarPreference` and `writeSidebarPreference` with try/catch, default collapsed on missing or corrupt. Add `zod` to `apps/web/package.json`. Tests cover corrupt JSON, missing key, unknown tab falling back to This PR, write failure swallowed.
3. `Sidebar/useSidebarState.ts`: reads once at mount, exposes `expanded`, `tab`, `toggle`, `expand`, `collapse`, `selectTab`. Focus mode and Changes scope never call these. Test the write-on-change and read-once behaviour.
4. `hooks/useViewportBoundary.ts` beside `useScrollSpy`: a matchMedia hook on `(width <= 1120px)` with the constant `TABLET_BREAKPOINT_PX = 1120` and a one-line comment that BRIEF-247 replaces the literal with the token. Extend `test/setup.ts` so a test can flip the stub.
5. `regions.ts`: rename `groupToc` to `sidebar`. Update the four pinned tests and the `BriefScreen.tsx` read. `GroupTocBar` keeps rendering off the renamed cell until PR2 deletes it.
6. Shortcut `S`: registry entry, `ShortcutAction` variant, dispatch arm calling the sidebar toggle passed through options, and the `brief.shortcuts.*` catalog row. The dispatch arm is a no-op until PR2 mounts the Sidebar. Test `resolveShortcut` for `S` and shift-S.
7. i18n keys for everything PR2 and PR3 will render: `brief.sidebar.ariaLabel`, `brief.sidebar.expand`, `brief.sidebar.collapse`, `brief.sidebar.scrollToTop`, `brief.sidebar.tabs.thisPr`, `brief.sidebar.narrow.prevGroup`, `brief.sidebar.narrow.nextGroup`, `brief.sidebar.sheet.handle`. Regenerate `catalog.generated.ts`. Reuse `brief.toc.*`, `brief.toolbar.groupCount` and `brief.shortcuts.*` where they already say the right thing.

Done when `pnpm lint` and `pnpm test` pass by exit code and nothing on the page looks different.

### PR2: the desktop Sidebar and the This PR tab

Branch `feature/BRIEF-249/sidebar-desktop`, off PR1. About 850 changed lines: 600 added, 420 deleted, 250 tests. Reviewers read about 430 new source lines.

1. `Sidebar/Sidebar.tsx`: the `<aside>` with its accessible name, rendered as a sibling after `</main>` in `BriefScreen.tsx`, fixed to the right edge, present only when `visibleRegions.sidebar` is true. Force-collapsed while hidden without writing the preference.
2. Collapsed column: chevron at top (`aria-expanded`, `aria-controls`, names from the catalog, same hover callout as the lines), the group lines with callout, current marker and jump, the foot with scroll-to-top and the `?` trigger. Port the callout and the magnification loop from `GroupTocBar` if they survive the design audit; drop the loop if it does not earn its place.
3. Expanded column: fixed `26.5rem`, no drag. A CSS variable `--sidebar-inline-size` that `.main` reads for its padding, so the reading column narrows and nothing overlays. Animation honours `prefers-reduced-motion` through the existing `utils/motion.ts` seam. Group lines stay alive on the outer edge.
4. `Sidebar/TabsRow.tsx`: WAI-ARIA tabs (tablist, tab, tabpanel, arrow-key roving tabindex) listing only tabs that exist. One tab today.
5. `Sidebar/ThisPrTab.tsx`: numbered list of `GroupView` rows. Each row: ordinal, name, category label, "N core · M supporting" mirrored from the group card, current marker from `activeGroupId`, live-conversation marker from `conversationGroupIds`, jump through `jumpToGroup`. Number, text and markers sit on one alignment grid. Hover, active and current states are designed, not defaulted.
6. Focus rules: expand and collapse leave focus on the chevron. Escape with focus inside collapses and returns focus to the chevron, and never reaches the page-level Escape. Sidebar-originated jumps move focus to the group heading (`tabIndex=-1` on the heading); J/K and the stepper keep their scroll-only behaviour.
7. Wire the `S` shortcut to the mounted toggle. List it in `ShortcutsModal`.
8. Delete `GroupTocBar/` (three files) and the `kbdHint` block in `BriefScreen.tsx` and its scss. Keep the Focus-mode exit button where it is; it loses its neighbour, so re-anchor its fixed position. Deletion goes through Python `os.remove` and `git add -A`; the block-destructive hook refuses `git rm`.
9. Delete the prototype code if any of it is present in the working tree. The stash stays; it is Idan's to drop.
10. Tests: Sidebar disclosure and focus return, tabs row keyboard, This PR row content and markers, hidden in Focus mode and Changes scope with preference untouched, `S` toggle. Extend `characterization/briefScreen.test.tsx` for the landmark order (`main` then `aside`).
11. Design audit with `impeccable` on the rendered page against Idan's dev server. Measure the collapsed and expanded widths and the reading-column padding in the browser. Screenshots go in the PR body.
12. Shell-compatibility check with the column narrowed by 26.5rem: diff table, header popovers, sticky toolbar, toast, Focus-exit button, composer. Any breakage is a named bug fixed in this PR.

### PR3: the narrow bottom bar and sheet

Branch `feature/BRIEF-249/sidebar-narrow`, off PR2. About 620 changed lines of code: 430 source, 70 deleted, 120 tests. Plus the plan folder deletion, roughly 350 lines of Markdown that reviewers can skip.

1. `Sidebar/NarrowBar.tsx`: fixed bottom bar inside the same `<aside>`, rendered when `useViewportBoundary` reports narrow. Left to right: chevron, previous-group arrow, group lines as a position indicator with the current group's name, next-group arrow, scroll-to-top, `?`. Lines are not tap targets. Arrows reuse the stepper's clamped `stepGroup` logic, moved out of `ReadingToolbar` into a shared helper.
2. Safe area: `padding-block-end: env(safe-area-inset-bottom)` on the bar, `viewport-fit=cover` added to the viewport meta in the HTML shell, and bottom padding on `.main` equal to the bar height through a second CSS variable.
3. `Sidebar/Sheet.tsx`: two snap heights, half in `dvh` units and full as viewport minus `--sticky-stack-h`. Opens at half, a handle toggles, no drag. Tabs row on top in place of the lines. `role="dialog"`, `aria-modal`, focus trap (reuse `Modal`'s trap logic by extraction, not by copy), scrim as a `<button aria-label>` (oxlint rejects a `<div onClick>`), and a new `useBodyScrollLock` hook.
4. Open and close: chevron opens and moves focus to the active tab. Escape, chevron and scrim collapse and return focus to the chevron. `S` toggles. A jump collapses the sheet. Entering Focus mode or Changes scope force-collapses without writing.
5. Persistence at narrow width: read and write `tab` only. The sheet always starts collapsed. Crossing the boundary shows a collapsed bar; crossing back restores the stored desktop preference.
6. Remove the narrow-only stepper markup and its media query from `ReadingToolbar` and its test. The desktop stepper stays.
7. Tests: bar contents and arrow stepping, sheet dialog semantics and focus return, jump collapses, boundary crossing keeps `expanded` untouched, scroll lock applied and released.
8. Design audit with `impeccable` at 390px and 1024px on the dev server, plus the `axeSweep` and `reducedMotion` Playwright specs. Measure bar height and the sheet's two heights.

9. Delete the plan folder. This file and everything else under `docs/plans/` go in this PR, through Python `os.remove` and `git add -A` since the hook refuses `git rm`. The `CLAUDE.md` exemption for `docs/plans/**` stays for future open-ticket plans. The comment in `eslint.config.js` that still points at a deleted `docs/plans/button-migration-plan.md` loses the path reference in the same commit.

Done when the ticket's "Done when" list is true across the stack: all three chrome pieces gone with no flag, both widths ship, every landmark and key rule present, the shell-compatibility list verified, design audits done.

## Model, effort, invocation

Fable 5.1 at high effort for every part, by Idan's instruction on 2026-09-02. Same model throughout means the parts run sequentially in the main thread; subagents are for the review rounds only.

| Part | Model and effort | Invocation |
| --- | --- | --- |
| PR1 foundations | Fable 5.1, high | Main thread |
| PR2 desktop Sidebar + This PR tab | Fable 5.1, high | Main thread, after PR1 |
| PR3 narrow bar + sheet, plan-folder deletion | Fable 5.1, high | Main thread, after PR2 |
| Review rounds | Fable 5.1, high | One subagent per PR, parallel once the stack is up |

If the Fable quota runs out mid-run, the part falls back to Opus 5 high and the PR body says so.

## Run mode

Auto mode, end to end. Once Idan says go, the run carries PR1 through PR3, the review rounds and the comment fixes without returning between PRs. Idan reviews the finished stack, not the parts. Every confirmation this run needs is already recorded in this plan; a hands-off run still never answers a question the plan does not answer. The only reasons to stop are a decision only Idan can make that this plan and the spec both leave open, a broken base, or exhausted quota with no fallback.

## Order of work and gates

1. PR1, push, open PR. Gates: `pnpm lint`, `pnpm test`, both judged by exit code.
2. PR2 off PR1, push, open PR targeting PR1's branch. Gates plus the design audit, the browser measurements and the shell-compatibility list.
3. PR3 off PR2, same.
4. Review stack, fix upstream first, hand to Idan to merge. Run `watch-pr-stack` for the realigns.
5. After the last merge: update the `CONTEXT.md` Sidebar entry only if implementation changed a word of the contract, close BRIEF-249, and unblock BRIEF-109 and BRIEF-224 on the board. The plan folder is already gone with PR3.

## Open items the implementer settles

- Whether the dock-magnification effect from `GroupTocBar` survives. Default: drop it unless the design audit misses it.
- The exact half-sheet height. Default `50dvh`.
- Collapsed column width. Default: today's strip width, measured in the browser before PR2 starts.
- Where the shared group-stepping helper lives. Default: `Sidebar/groupStepping.ts`, imported by `ReadingToolbar` for the desktop stepper.
