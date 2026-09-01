# BRIEF-231 — Intent check layout: locked spec

Decision spec assembled from the completed wayfinder map
([map](https://app.notion.com/p/3cd5e9400eeb8164bc91fc57a628d34d), seven
tickets). This is the WHAT; implementation planning happens at pickup via
`/init-plan`. Layout only — palette/type/radii/serif skin belongs to the
BRIEF-229 redesign, and bucket definitions/copy semantics are untouched.
Prototype evidence: `apps/web/prototype/intent-layout.prototype.html`
(`?v=splitbox2`) + `apps/web/prototype/shots/` — local throwaway artifacts,
not tracked; the decided render is
`shots/splitbox2-decided--frame-none-ticket-section.png`.

## Band anatomy (top to bottom)

**Header bar (collapsed-by-default toggle row).** Unchanged form: twist +
title + the flat five bucket counts, neutral and uncolored, one row (34px at
980px column). The "N linked tickets" count LEAVES the bar — it is
provenance, not a bucket count; it moves to the panel preamble (below).
flat-split (six counts + separator) was rendered and REJECTED — flat five
stands. Collapsed state loses the a-ticket-informed-this signal — accepted:
provenance matters when reading contents, and contents sit behind the twist.
Unavailable (broad/none) rendering is untouched.

**Panel preamble.** The framing line is REMOVED (`brief.intent.framing` and
its render go). The preamble is now:

1. Scope note (when present) — leads the panel.
2. Linked-ticket subsection: a dim count line ("N linked tickets") + one
   bullet per ticket, `id — title`, the id carrying the link. Ticket titles
   need a schema addition (see Dependencies); id-only bullets are the
   fallback, with the id derived from the URL tail.

The fallible-read stance survives only in the alarm buckets' caution lines —
accepted at the frame amendment.

**Split-box² body.** Two split sides, each a real heading over bento-boxed
buckets:

- **"Checks out"** — accomplished + acknowledged deviations (stated intent
  and diff agree, nothing pending).
- **"Needs a look"** — claimed-but-unachieved, unacknowledged deviations,
  stated-but-missing, done-but-unstated.

Sides render as two grid columns (`minmax` floor — see Wrap). Within each
side, buckets keep static relative order and stay individually boxed; empty
buckets are omitted (band must hold 1–6 buckets with uneven counts).

**Items.** Plain `▪` bullets everywhere — the jump chip is no longer the
bullet. The group jump becomes a right-aligned `↳` icon-button on the claim
line, sized to the ≥24px target floor (today's 22px `.goto` fails it).
Disambiguation is **ids-multi**: bare `↳` on single-group items; when a claim
carries several groups, each button is labeled `↳ g1`-style — ambiguity fixed
exactly where it exists. Evidence line (quote + citation) unchanged.

**ACKNOWLEDGED chip: removed.** The read path forces `acknowledged: false`
outside the deviations bucket and the render partitions acknowledged
deviations under their own label — the chip can only appear beneath a header
that already says it. Carries regardless of layout.

**Clamp.** A bucket with more than 6 items clamps to 5 + an in-place
"Show all N" / "Show fewer" expander. Expansion grows in place — nothing
behind a scroll. (Fifteen-item case: 2016px → 774px at rest.)

**Alarm emphasis: neutral.** Weight + `◇` glyph + caution line, exactly
today's register — decided in front of a colored render. Collapsed-by-default
stays; the body never auto-expands.

## DOM and reading order

**The DOM ships in split order**, not static bucket order. Proven (AFK
reading-order ticket): the split's groups are not contiguous in static order,
so a static-order DOM cannot render the split faithfully — shared grid rows
cost +40% band height, the wrap floor dies, and the accessibility tree reads
worse (heads detached from their groups, focus zigzags columns). The
as-rendered DOM's only static-order delta: acknowledged deviations move
6th → 2nd, inside an announced group. Visual order = DOM order holds at every
width.

**Headings become real.** Today the band exposes none (heads are `generic`,
bucket labels `paragraph`). Per apps/web heading rules (structure, not size;
screen h1 is the PR title; top-level sections h2):

- Band title: `h2` wrapping the toggle button (disclosure pattern).
- Split heads ("Checks out" / "Needs a look"): `h3`.
- Bucket labels: `h4`, subordinate to their split head.

## Wrap and edge behavior

- **Container-driven wrap via a 340px `minmax` floor** —
  `grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr))`.
  No viewport breakpoint (a media query is blind to a narrowed column; the
  floor IS the container-driven min-width wrap). Boxes go single-column when
  the container drops below ~840px; side-by-side tracks never get narrower
  than ~52 quote characters.
- **Wrapped single column**: boxes stack under their split heads in DOM
  order; clamp-to-5 unchanged.
- **72ch measure cap** on the wrapped single-column item text (boxes stay
  full width) — matches the current variant's cap; uncapped quotes ran
  ~100ch.

## Dependencies

**Ticket titles need a schema addition.** `ticketUrls` is `string[]` — URLs
only (`packages/brief-core/src/types.ts`). The approved preamble form shows
`id — title`, so the schema grows a title alongside each URL. This is
generation surface: prompt/schema change, eval-gated per repo convention
(scoped run, Idan-spend). If the addition is deferred, ship id-only bullets
and let titles ride the schema change later — the layout does not wait.

## Copy / i18n

- New keys: split heads ("Checks out" / "Needs a look"), "Show all N" /
  "Show fewer", linked-tickets subsection count line.
- Removed keys: `brief.intent.framing`, `brief.intent.acknowledged`; the
  bar's `brief.intent.linkedTickets` moves/renames to the preamble.
- Copy caveat from the frame round: "6 checks out" can scan as a verb
  phrase — the count-row copy keeps today's five bucket labels, but the
  split-head nouns get an i18n copy review.

## What the build touches

- `apps/web/src/features/brief/components/BriefScreen/IntentBar/` —
  `IntentBar.tsx`, `IntentBar.module.scss`, `IntentBar.test.tsx` (layout
  rebuild; `jumpToGroup` wiring and `expandAndScrollTo` handle unchanged).
- `packages/i18n` catalog — keys above.
- `packages/brief-core/src/types.ts` — ticket-title schema addition
  (separable; eval-gated).
- No other BriefScreen surface moves.

## Calls resolved at spec lock

- The charting line "static bucket order stands" is formally AMENDED to
  **"static order within each split side"** — the proof showed that is the
  true invariant (only acknowledged deviations move, 6th → 2nd, under an
  announced head).
- Heading levels confirmed: band title `h2`, split heads `h3`, bucket
  labels `h4`.
- The prototype artifacts (`apps/web/prototype/` fixture, page, NOTES.md,
  shots) stay untracked — throwaways; the verdicts live here and on the map.
