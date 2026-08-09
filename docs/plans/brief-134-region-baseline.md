# BRIEF-134 — details-section region: measured baseline

Measured 2026-08-05 against the running app (Chromium, `deviceScaleFactor: 1`,
`getBoundingClientRect` in document coordinates). Resolves the wayfinder ticket
_Measure the region (baseline, five modes × two viewports)_.

**The region** = distance from the sticky header's bottom edge to the top edge
of the first change group (or, where no groups render, the first content
block). The yardstick this map committed to at charting: **≈500px at
1440×900 in story mode**, i.e. the first change group visible without
scrolling.

## Method

- Local path: `pnpm -C apps/web dev`, artifacts read from
  `tools/categorizer/out` — no DB, no auth.
- DB path: Postgres via `docker compose`, seeded `github_grant` +
  `reviewer_session` + `pull_request` + `brief` rows under sentinel
  `installation_id` 777001, real repo id `1242926326`, PR **#151**.
- The conversation READ uses an **installation token**
  (`packages/api/src/routes/conversation.ts`), which a synthetic GitHub App key
  cannot mint. The endpoint was therefore intercepted in the browser and
  fulfilled with three fixtures, which also lets the bar be measured as a
  function of reviewer count. Interception happens client-side only, so the
  locked BRIEF-25 refresh-on-focus contract is what pulls the fixture in.
- Artifacts: `Idan91-code-review-194_1_3a4da724` (9 chunks / 4 groups — the
  **only** artifact in `out/` carrying an `intentCheck`, so the only one that
  renders `IntentBar`) and `Idan91-code-review-14_2_0ce51b97` (56 chunks /
  16 groups, has comparison sidecars).
- The DB run pairs PR #151's conversation with artifact 194's body. Geometry
  of the conversation blocks is real for the fixture; the summary block's
  geometry is artifact 194's, already measured independently on the local path.

## Region cost, by mode

| Mode | Artifact | 1440×900 | 1280×800 | Fits viewport? |
|---|---|---:|---:|---|
| story, local | 194 | **1024px** | **1147px** | no |
| story, local (large) | 14_2 | 925px | 1024px | no |
| story, DB — thin conversation | 194 + PR151 | 1227px | 1351px | no |
| story, DB — realistic conversation | 194 + PR151 | 1235px | 1359px | no |
| story, DB — heavy conversation | 194 + PR151 | **1295px** | **1451px** | no |
| concern view | 194 | 1118px | 1118px | no |
| changes-only view | 14_2 | 842px | 941px | no |
| focus mode | 194 | **177px** | **177px** | **yes** |

Available viewport below the header: **803px** at 1440×900, **703px** at
1280×800.

**Every mode except focus mode overruns the viewport.** Worst case (DB path,
heavy conversation, 1280×800) is **1451px — 2.9× the 500px yardstick and 2.1
viewport-heights.** The best non-focus case still misses the yardstick by 68%.

## Per-block heights

| Block | 1440×900 | 1280×800 | Notes |
|---|---:|---:|---|
| `SummarySection` | 826px | 949px | artifact 194; 776 / 875px on 14_2 |
| `SummarySection` (concern view) | 1052px | 1052px | wider column — main is not `split` outside story mode |
| `AttributeJumpRail` | 26px | 26px | collapsed state |
| `IntentBar` | 37px | 37px | artifact 194's intent check |
| `ConversationFilterBar` | 93 / 101 / 161px | 93 / 101 / 193px | thin / realistic / heavy |
| `ConversationSection` (collapsed) | 58px | 58px | header row only |
| `chunksLabel` (in `StoryView`) | 31px | 31px | 24px in focus mode |
| `FocusBanner` | 83px | 83px | sticky; out of this map's scope |
| `GroupTocBar` | 86px (4 groups) / 302px (16 groups) | same | `position: fixed`, gutter — consumes **no** flow height |

## Findings

**1. The region is a summary-text problem wearing a control-strip costume.**
`SummarySection` is **65–94%** of the region in every mode:

| Mode | Summary share |
|---|---:|
| concern view | 94% |
| changes-only | 92% |
| story, local @1280 | 83% |
| story, local @1440 | 81% |
| story, DB heavy @1280 | 65% |

Everything else combined — both rails, the intent bar, the filter bar, the
collapsed conversation section and the chunks row — is **94px on the local
path** and **245–345px on the DB path**. Deleting every control strip outright
would still leave every mode over the yardstick.

**2. A narrower viewport makes it worse, not better.** Summary text reflows
taller as the column narrows: +123px going from 1440 to 1280 on artifact 194.
The region grows ~12% while the available viewport shrinks 12%.

**3. The two-column summary wastes its right column.** With a changelog
present, the lead text column runs 800px+ while the changelog column ends
around 340px — roughly 500px of empty right column inside the tallest block
on the page.

**4. Concern view is 100% summary and 0% wayfinding.** Region 1118px, one
block. Confirms with numbers the gating defect at `BriefScreen.tsx:533`: the
attribute rail, intent bar and group TOC are all gated on
`viewMode === "story" && !focusMode`. Concern view is also the one mode whose
cost is **identical at both viewports** — its content column is capped, so it
does not benefit from a wider screen either.

**5. The filter bar scales with reviewer count, steeply.** 93px → 193px at
1280×800 going from 1 reviewer to 10 (chips wrap to a second line). +100px
purely from having a normally-reviewed PR. The `All` / `None` / `Clear
filters` cluster occupies its **own nearly-empty line** — a full row of
vertical space for three right-aligned buttons.

**6. Four stacked full-width bands is not a figure of speech.** On the DB path
the sequence is: filter-bar card → conversation-section card → chunks row →
first group, each a separate bordered or ruled full-width band, each with its
own padding. See `band-heavy.png` (linked on the ticket).

**7. Focus mode is the only mode that fits — and it was measured on the local
path, where no conversation surface exists.** On the DB path, focus mode keeps
`ConversationFilterBar` + `ConversationSection` (they sit outside the
`viewMode === "story" && !focusMode` guard), which would add **151–251px** to
that 177px. **Not directly measured** — the seeded DB path plus focus mode was
not captured. Worth confirming during the region-purpose ticket.

**8. `--top-bar-h`'s pre-hydration fallback is stale.** `tokens.scss:177` sets
`72px` with a comment to keep it in sync with `Header.module.scss`
`min-block-size`. The header is two tiers of 52px + 44px and measures **97px**.
The `ResizeObserver` corrects it after hydration, so the standing value is
right — but the first paint is 25px short, and every sticky offset in the app
is derived from this token. Relevant to the persistence-tier ticket, which may
change the header's height.

**9. BRIEF-103's PR state badge is shipped and visible** (`Open` pill in the
identity row) — the header measured here is post-BRIEF-103, not the pre-map
header BRIEF-134's text describes.

## Implications for the yardstick

Hitting ≈500px at 1440×900 is not reachable by compacting control strips.
It requires one of:

- `SummarySection` capped (the capped-text primitive locked at charting), and/or
- BRIEF-104's 1–3-line summary landing, and/or
- moving occupants out of flow into the persistent tier.

The measured numbers say the first two are critical and the third is
where the control strips go. A pure trim pass on the strips buys at most
~345px in the worst mode and ~94px in the common local one.

## Reproduction

Harness scripts were throwaway and are not committed. Recipe:
`.claude/skills/verify/SKILL.md` for the DB seed (note: sessions now link a
`github_grant` row via `grantId` — the skill's inline-ciphertext description
predates BRIEF-40 D15; `reviewerId` is the numeric GitHub user id, not the
login; `BriefWriteInput` requires `provider` / `model` / `effort`; the web
startup wiring additionally requires `GITHUB_OAUTH_CLIENT_ID`,
`GITHUB_OAUTH_CLIENT_SECRET` and `PUBLIC_BASE_URL`).
