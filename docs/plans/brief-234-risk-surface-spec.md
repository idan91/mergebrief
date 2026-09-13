# GroupCard Flag list

Status: NORMATIVE. Locked 2026-09-12 on the wayfinder map [GroupCard Flag list](https://app.notion.com/p/3d85e9400eeb819697bdc322fe0e3d90). Ready for `/init-plan`. Not `/to-tickets`. Commit of this file is the owner's call.

The working **Flag** list on an attributed **Change-group**'s GroupCard. A reviewer sees which attributes fired and which files carry them, then dispositions without the card becoming a checkbox wall.

The shape is **Chooser**. Leave-it is rejected.

Glossary: `CONTEXT.md` (**Flag**, **Risk Surface**, **Risk note**, **Disposition**, **Change-group**, **De-emphasis**, **Jump-rail**). **Jump-rail** stays the attribute-keyed TOC beside the group list; it is not a file list on this card.

Visual lock: `apps/web/src/prototype/group-card-flag-list/Chooser.tsx` (`/prototype/group-card-flag-list?variant=chooser`). Throwaway. This spec is the ship contract; the prototype is not.

## Scale

Measured from 110 local Postgres briefs, 541 attributed Change-groups (remainder excluded). One Flag is one `chunk.riskSurface` entry.

| per Change-group | p50 | p95 | max |
| --- | --- | --- | --- |
| Flag count | 2 | 10 | 21 |
| Distinct attributes | 2 | 5 | 9 |
| Distinct files in the Flag list | 1 | 6 | 17 |

141 / 541 groups have no Flags (26.1%). 90% have 0-6. Tail is twenty, not six, not thirty. Latest-brief-per-PR (30 PRs, 168 groups): Flag p50 2 / p95 13 / max 21.

Design against the tail. A two-Flag path is not the stress case.

## Shape

Chooser: file-major workplace on the card, checkboxes at glance, Address / Dismiss after select, act in the existing Evidence and Dismiss modals.

Losers:

| Candidate | Why not |
| --- | --- |
| Leave it (today's attribute-major wall) | 3092px of list in a 720px body. Still the checkbox wall. |
| Modal workplace | Working list leaves the card and covers the diff. Workplace stays the GroupCard list. |
| Progressive disclosure | Attribute accordion hides files. Scan unit is file-major. |
| Row diet | 1292px in an 856px body. Still overflows, still attribute-major. |

## Surface

This spec owns the GroupCard **working Flag list** (today `RiskSurface` inside the card body).

Unchanged: GroupCard title, summary, categories, sticky viewport-capped column (`max-block-size` in the split layout; `.body` is the only scroll region; the card never grows).

Removed from the GroupCard head: the header risk-chip union (`group-risk-union`). No GroupCard-level attribute chips. Per-file chips are the attribute glance.

Own-draft (`flagsReadOnly`) is the control-stripped mirror of this list, not a second design.

## Glance

Section heading: `Risk surface`. Counts on the right: `N files · N flags` (middle dot, no em dash). Drop `attributes, not verdicts` and the section `i` tooltip. Empty group: same heading, existing empty copy (`No risk-surface attributes on this group.`).

Open list: files with at least one open Flag. One row per file, even when two Chunks of that path fire (2 of 418 firing groups in the measured briefs, max two Chunks). File order is first appearance in the group's chunk order.

Row:

1. **Select** (24px column). 14px amber checkbox, 24px hit, same as today's GroupCard `.checkbox`. Selects or deselects every open Flag on that file. Disabled only when that file has no open Flags (those files are not in the open list).
2. **Identity**. Left-truncated path (`title` is the full path; basename and extension stay). Gap from checkbox to identity is 4px. No twist on this row; paths line up whether the file has Risk notes or not.
3. **Chips** wrap on the next line as a sub-row of the path. The notes twist sits on this row when the file has Risk notes. Files without notes keep an empty twist slot so chips line up and still read as a sub-bullet. Twist-to-chips gap is 8px. Twist hit expands toward the chips, not toward the checkbox. One chip per Flag on that file. Mixed files (some Flags resolved, some open) stay in the open list; resolved chips on that row dim in place.

No file list on the card. Jump stays on the path and is optional. Path jump goes to the first open Flag's Chunk on that file, else the first Flag's Chunk. Jump is unavailable while an Evidence or Dismiss modal covers the diff; covering the diff then is fine.

Address / Dismiss toolbar appears only after something is selected. No per-Flag button pair, no per-attribute select-all, no per-attribute bulk row.

## Copy split

Two lines, split. Do not put them in the same place.

- **Catalog copy** (what `dense-logic` means; the same on every file) lives in the chip callout. Reuse `RiskChipDisclosure` and the existing `Callout`. Overlay copy is `--font-size-sm` (11px), `--dim`. Do not restyle `Callout` itself; wrap the detail. For a repo-policy Flag, that callout is also where the repo's own criteria and implication appear.
- **Risk note** (why it fired on this hunk; optional) lives in a per-file fold, labeled by attribute, closed by default. Attribute label is amber mono `--font-size-sm`. Body is `--font-size-md` (12px), `--dim`. Sentence-case on render (first character only); the generator writes lowercase fragments. Twist is the ChunkCard filled-triangle SVG (10px) on the chip sub-row, faint, `--dim` on hover or open, rotates 90° when open. `prefers-reduced-motion`: no transition. Accessible name: `Risk notes`.

De-emphasized Flags stay on the row, quiet (`RiskBadge` de-emphasized styling). Never hidden. Floor co-fire stays un-quieted, same as today.

## Act

Workplace is this list. After select, Address / Dismiss open the existing Evidence and Dismiss modals. Those modals are the act. Addressed still needs a Comment; dismissed still needs a reason (`isThinReason` under 12 characters unchanged).

Disposition is per Flag. The file checkbox is a chooser over that file's open Flags; the toolbar acts on the current selection, which may span files.

Disposition is assistive. Open Flags do not block Submit.

Reopen survives: dismissed only, one Flag at a time, back to open. Not for addressed.

## Resolved fold

Files with nothing open leave the open list into an `N resolved` fold at the foot. Closed by default.

Inside: path (same jump grammar), dimmed chips, then either quiet `Addressed` (mono `--font-size-xs`, faint) or `Reopen` (`LinkButton`). Flush with the fold control, not the checkbox column. No evidence line, no reason line, no checkbox.

## Own-draft

`flagsReadOnly` strips checkboxes, toolbar, and Reopen. Heading, counts, paths, chips, Risk notes, and the resolved fold stay. Path jump stays.

## Chrome

Incumbent GroupCard tokens. Select column 24px; identity `minmax(0, 1fr)`; column-gap 4px; row-gap 4px. Path: mono `--font-size-sm`, `--faint`, RTL truncate, underline on hover only. Chip sub-row: 12px twist column, 8px gap to chips. Mixed and fold chips: opacity 0.62. Notes twist color `--faint`, open/hover `--dim`. Notes body hangs from the chip text, not the twist.

## Identity

A Flag is still one `(chunk × attribute)` (`${chunkId}-${attr}-${index}` today). The file row is presentation. Jump and Disposition stay per Flag / Chunk; the row does not merge Flags.

Unattributed remainder has no Risk Surface. This list does not appear there.

## Rejected

- Leave-it, modal workplace, progressive disclosure, row diet.
- GroupCard header risk-chip union.
- File list / path rail on the card.
- Attribute-major working list.
- Two rows for two Chunks of the same path.
- Risk notes always visible, or in the chip callout with catalog copy.
- Per-row Address / Dismiss.
- Act-at-glance; Select as a mode.
- Dimming fully resolved files in the open list.
- `attributes, not verdicts` on the section.
- Gating Submit on open Flags.
- Growing the sticky card.

## Out of scope

- ChunkCard risk chips.
- Focus mode chips and Focus Disposition.
- The Receipt tally as the workplace.
- Flag semantics and the submit gate.
- Evidence / Dismiss modal contracts.
- The CONTEXT **Jump-rail** (attribute-keyed TOC).
- The GroupCard visual restyle ticket.
- Shipping this prototype route.
- Playbooks.
