# BRIEF-231 — Intent check layout: implementation plan

Executes the locked spec (`docs/plans/brief-231-intent-check-layout-spec.md`).
Layout only; palette/type/radii stay with BRIEF-229.

## Git requirements (git-eng — mandatory for ALL git operations)

- All branching, commits, pushes, and PRs go through the `git-eng` skill.
- Stacked branches off `main`, one per PR, in order:
  1. `feature/BRIEF-231/split-box-layout`
  2. `feature/BRIEF-231/item-behaviors` (stacked on 1)
  3. `feature/BRIEF-231/ticket-titles-schema` (stacked on 2)
- Commit strategy: agent commits, chunked — one commit per logical unit.
- Pre-commit review agents: none. PR-level subagent review instead
  (stack lifecycle: adversarial `reviewer` per PR, 2 rounds, medium+ findings
  only; realign addresses comments; watch until all merged).
- No `Co-Authored-By` trailers; no AI-attribution in PR bodies.
- PR titles: `[BRIEF-231] feat: <Title Case>`; bodies: overview, surprises,
  one verification line — never a git-log restatement; `/unslop` every body.
- The uncommitted spec file commits as the first (docs) commit on branch 1.

## Mandatory specialist skills (user-confirmed)

- `typescript-eng` — all TS work.
- `tdd` — red-green per behavior; `IntentBar.test.tsx` leads each change.
- `impeccable` — rendered-UI audit on the finished band before each visual
  PR publishes.
- `web-accessibility` — headings h2/h3/h4, disclosure pattern, ≥24px
  targets, DOM/reading order.
- `verify` — drive the app locally; screenshot and MEASURE the rendered band
  (never ship CSS reasoned from tokens alone).

## Part / PR breakdown

Existing surface: 983 LOC across `IntentBar.tsx` (331), `.module.scss`
(280), `.test.tsx` (372). Rebuild touches most of it; split by review
context, not just size.

### PR 1 — Split-box² structure (`feature/BRIEF-231/split-box-layout`)

Est. ~600–900 changed LOC (near ceiling — justified: structure and its tests
are one review context; splitting DOM from its CSS would force reviewing
half-rendered states).

- Docs commit: add the locked spec.
- Header bar: "N linked tickets" count leaves the bar; flat five stands;
  unavailable rendering untouched.
- Panel preamble: framing line removed; scope note leads; linked-ticket
  subsection (dim count line + `id — title` bullets, id-only fallback with
  id derived from URL tail).
- Split-box² body: "Checks out" / "Needs a look" as two grid columns,
  buckets individually boxed, static order within each side, empty buckets
  omitted (1–6 buckets, uneven counts).
- DOM ships in split order; headings become real: band title `h2` wrapping
  the toggle (disclosure), split heads `h3`, bucket labels `h4`.
- ACKNOWLEDGED chip removed.
- i18n: add split-head keys + linked-tickets count line; remove
  `brief.intent.framing`, `brief.intent.acknowledged`; move/rename the bar's
  `brief.intent.linkedTickets`. Flag split-head nouns for i18n copy review
  ("6 checks out" verb-phrase scan risk).
- Model: Fable, high effort — design-heavy DOM/a11y restructure. Main
  thread, sequential.

### PR 2 — Item behaviors and wrap (`feature/BRIEF-231/item-behaviors`)

Est. ~300–500 changed LOC.

- Items: plain `▪` bullets; group jump becomes right-aligned `↳`
  icon-button on the claim line, ≥24px target (today's 22px `.goto` fails);
  ids-multi disambiguation (`↳ g1` labels only on multi-group claims).
  `jumpToGroup` / `expandAndScrollTo` wiring unchanged.
- Clamp: >6 items → 5 + in-place "Show all N" / "Show fewer" expander;
  grows in place.
- Wrap: `repeat(auto-fit, minmax(min(100%, 340px), 1fr))` — no viewport
  breakpoint; wrapped column stacks in DOM order; 72ch measure cap on
  wrapped item text.
- i18n: "Show all N" / "Show fewer" keys.
- Model: Fable, high effort — interaction + container-query-like CSS needs
  measured verification. Main thread, sequential (depends on PR 1).

### PR 3 — Ticket-title schema addition (`feature/BRIEF-231/ticket-titles-schema`)

Est. ~200–400 changed LOC. Generation surface — eval-gated.

- `packages/brief-core/src/types.ts`: `ticketUrls: string[]` grows a title
  per URL; prompt updated to elicit titles.
- Web preamble upgrades from id-only fallback to `id — title`.
- Check the hand-rolled wire types in `apps/web` and any API bounds that
  mirror the shape — CI's changed-package filter misses undeclared mirrors.
- Eval: PREPARE the scoped case selection (cases whose intent-check /
  ticket properties could move) with justification for the PR body — Idan
  runs the harness and spends; the agent never invokes it. Layout does not
  wait on this PR: if eval outcome defers it, PRs 1–2 ship id-only.
- Model: Fable, high effort — schema/prompt change is subtle, blast radius
  crosses packages. Main thread, sequential (stacks on PR 2 to avoid
  preamble-render conflicts).

## Implementation steps (per PR)

1. Branch via git-eng (stacked as above).
2. TDD loop: failing test → minimal change → green; keep coverage floors.
3. Visual PRs (1, 2): compile, run app via `verify`, screenshot, measure
   against the spec's numbers (34px bar row, ~840px wrap point, 72ch cap,
   ≥24px targets); `impeccable` audit on the rendered band;
   `web-accessibility` pass on the accessibility tree (headings, disclosure
   state, focus order = DOM order).
4. Gates by exit code: `pnpm lint`, `pnpm test`, typecheck — bottom-up
   across the stack after each realign.
5. Chunked commits via git-eng; push; PR per git-eng title/body rules,
   `/unslop` applied.
6. Subagent `reviewer` per PR (no branch checkout by the reviewer; hand
   perf-reviewer a diff file if used), 2 rounds, medium+ only.
7. Watch the stack through squash-merges (`watch-pr-stack`), realigning and
   retargeting until all merged.

## Out of scope

- Palette, type, radii, serif skin (BRIEF-229).
- Bucket definitions and item copy semantics.
- Prototype artifacts stay untracked.
