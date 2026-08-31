# BRIEF-113 — E2E v1: Playwright dummy-brief suite (unauthenticated) + axe

Status: planned 2026-08-03. Policy source: [ADR 0038 §4](../adr/0038-constraint-mesh-test-quality-gates.md)
(+ the E2E-fidelity ticket resolution on the BRIEF-82 map). Board ticket:
BRIEF-113 (In progress).

## Goal

The first automated browser gate: a fixture brief rendered through the real
web server and exercised in a real Chromium — rendering, spans,
conversation interactions, thread-jump DOM behavior, reduced-motion — with
axe-core assertions riding along. Zero auth, zero DB, zero GitHub, zero
spend; runs on fork PRs.

## Locked decisions (ADR 0038 §4 — do not relitigate)

- Playwright, **chromium only, single worker**, `retries: CI ? 2 : 0`,
  `trace: 'on-first-retry'` (the browser-layer exception to the no-retry
  rule).
- **v1 = unauthenticated dummy-brief suite ONLY.** No seeded sessions, no
  DB-backed loader, no submit flow — that's E2E v2 (BRIEF-118). Recorded
  caveat stands: fixture path ≠ DB loader path; v1 proves the
  rendering/interaction layer.
- axe-core gates **serious/critical only**; moderate/minor logged.
- Runs on fork PRs (fully hermetic).
- Runtime budget: low minutes, piggybacking the web leg of CI — NOT a new
  matrix axis across all packages.

## Facts (verified 2026-08-03; re-verify details at implementation)

- Local-brief path: `/briefs/$briefId` route → server functions in
  `apps/web/src/features/brief/server/brief.functions.ts` →
  `readLocalBrief(briefId)` reading
  `tools/categorizer/out/<briefId>.{brief,comments,...}.json`. Real fixture
  files exist in that directory (e.g. `Idan91-code-review-13_1_*`), and
  `brief.server.test.ts` shows the fixture-writing recipe.
- The route has a `redirect` at `briefs.$briefId.tsx:42` — verify when it
  fires (missing brief vs auth) and what an unauthenticated request needs
  to land on the fixture brief. If any auth touches this path, STOP and
  report — the v1 premise is auth-free.
- E2E fixtures must be **committed test fixtures** (a dedicated
  `e2e/fixtures/` brief id), not the gitignored categorizer output —
  copy/craft a stable fixture set the way `brief.server.test.ts` does,
  wired via whatever mechanism the local-brief reader allows (out-dir
  override, or write-into-place during global setup).
- CI: new `e2e` job in `ci.yml`, gated on the same affected-selection
  (runs when apps/web or its deps are selected, or run_all). **MUST be
  added to `required-checks-passed.needs`** — the recorded invariant from
  #209. Playwright browser download needs caching
  (`~/.cache/ms-playwright`, keyed on the playwright version) or the job
  pays ~1min/run.
- QA docs: `pre-release-testing.md` steps tagged `manual-until: BRIEF-113`
  flip to `automated: e2e` where the v1 suite actually covers them —
  honest tags only; anything v1 doesn't cover keeps its manual-until
  pointing at BRIEF-118 (E2E v2) or stays manual-forever.

## Spec list (v1)

1. **Brief renders**: fixture brief loads at `/briefs/<fixture-id>`; story
   sections present; spans render; no console errors on load.
2. **Span interactions**: span hover/click affordances; deep-link with a
   span param lands scrolled/focused; malformed span param → 404 or
   normalized (assert whichever the route contract says).
3. **Conversation surface**: open conversation, walk rows, collapsed
   bot-group expansion, show-more cap reveal (the BRIEF-29 DOM rules that
   motivated browser testing).
4. **Thread-jump behaviors**: target row revealed behind the cap /
   inside collapsed groups, focused; reduced-motion media emulation →
   snap instead of smooth-scroll.
5. **axe sweep** on each stable page state: fail on serious/critical,
   log the rest.

Trim rule: if any spec needs DB/auth to be honest, it moves to BRIEF-118's
list instead of being faked here.

## Git requirements (git-eng — mandatory)

- Single PR, branch `chore/BRIEF-113/e2e-v1` off main. Chunked commits:
  (1) Playwright infra — deps, config, fixture wiring, first smoke spec,
  CI job + needs update; (2) full spec set + axe; (3) QA-doc tag flips.
- performance-reviewer before each commit (≥80 → fix).
- No Co-Authored-By, no AI attribution. Stop before push; then the
  approved PR-ready flow (push, PR, reviewer loop, CI green, hand
  to Idan). PR body needs an eval-presence note only if generation
  surfaces are touched (they must not be).

## Specialist skills (mandatory)

- `typescript-eng`; `web-accessibility` guidance for the axe integration
  (gate thresholds already locked).

## Work shape

Single PR, target <800 LOC (specs are verbose; fixtures JSON excluded
from the count). Run: Opus 5 subagent. Playwright + axe deps live in
apps/web devDependencies; e2e dir OUTSIDE `src/` (excluded from coverage
include set automatically) — verify vitest doesn't pick the specs up.

Gates: `pnpm -r test`, `pnpm lint`, `pnpm -r typecheck`, the new e2e suite
green locally (chromium), actionlint/zizmor on the ci.yml change.

## Out of scope

- Seeded-session slices, submit flow, compare bar with revisions (BRIEF-118).
- Full-loop webhook E2E (parked; fake generator adapter doesn't exist).
- Cross-browser, mobile viewports, visual regression.
