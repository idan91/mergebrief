# Labeling Schema — Controlled Vocabulary

**Single source of truth for the closed sets of labeling tokens.** If a token is not registered here, it is not valid — add it here (with status) *before* using it in a brief.

Division of labor:
- **This file** — the authoritative *index* of valid tokens across every axis + quick rules.
- `CONTEXT.md` — the *meaning* of each concept (glossary).
- `playbooks.md` — the per-**Category** review checklists + per-**Concern** checks (deep content).
- `risk-surface.md` — the per-attribute detail for **Risk Surface** (deep content).

## What attaches where

| Token type | Attaches to | Axis |
|---|---|---|
| **Category** (one dominant + secondary) + **Summary** | **Change-group** | intent |
| **Concern** | **Chunk** | artifact |
| **Role** | **Chunk** | carrier vs supporting |
| **Risk Surface** attributes | **Chunk** | factual flags |
| **LoC** | **Chunk** (rolls up to group + concern) | size/attention |

A **Chunk** = a contiguous run of changed lines sharing one Concern and one Change-group (sub-file; a git hunk may split into multiple chunks).

---

## 1. Category — intent (attaches to Change-group)

Closed set; expand deliberately. "Playbook" = status in `playbooks.md`.

| Token | One-line gloss | Playbook |
|---|---|---|
| `bugfix` | correct a defect in existing behavior | ✓ |
| `logic-refactor` | behavior-preserving restructure of logic | ✓ |
| `move-with-edits` | relocation of code with edits inside the move | ✓ |
| `lib-bump` | dependency version change *with* API/behavior impact | ✓ |
| `pure-move` | relocation only, bytes identical, no edits | ✓ |
| `new-feature` | adds a new capability | ✓ |
| `dependency-update` | dep version bump with no API/behavior impact | ✓ |
| `schema-change` | data-model / migration change | ✓ |

Not Categories (common mistakes): `test-only`, `config-only`, `generated-code` → these are **Concerns**, not intents.

---

## 2. Concern — artifact (attaches to Chunk)

Closed set. Mostly derivable from file path.

| Token | Gloss | Default Role |
|---|---|---|
| `implementation` | the functional change itself | carrier |
| `test` | tests, fixtures (incl. `.test.*` / `.spec.*` files) | supporting |
| `doc` | docs, READMEs, changesets, doc-only files | supporting |
| `spec` | specification document (NOT `.spec.ts` — that's `test`) | supporting |
| `config` | configuration files | supporting |
| `generated` | generated / vendored output (lockfiles, bundles) | supporting |

`generated` LoC is excluded from the adjusted Concern split by default (collapsed).

---

## 3. Role — carrier vs supporting (attaches to Chunk)

| Token | Gloss |
|---|---|
| `carrier` | holds the Change-group's intent (the implementation that carries the change) |
| `supporting` | serves the carrier (its tests, docs, specs, config) |

Default from Concern (`implementation` → carrier, else → supporting). **Flip** when a supporting artifact is itself the purpose (flaky-test fix, coverage backfill) — that chunk becomes carrier and takes the group's intent.

---

## 4. Risk Surface — factual attributes (attaches to Chunk)

Three buckets. Full detail in `risk-surface.md`. Factual only — never verdicts; severity emerges from *combinations*.

- **About the code:** `no-tests`, `no-types`, `legacy-area`, `dense-logic`
- **About the change:** `touches-auth`, `mutates-state`, `removes-validation`, `relaxes-permissions`, `widens-error-handling`, `adds-feature-flag`, `new-dependency`, `new-abstraction`, `comment-contradicts-code`
- **About the blast radius:** `external-io`, `cross-service`, `schema-adjacent`, `hot-path`, `widely-imported`, `release-imminent`

The last three change-bucket attributes (`new-dependency`, `new-abstraction`,
`comment-contradicts-code`) are the AI-authorship trio (ADR 0026) — registered 2026-07-03.
They are ordinary authorship-agnostic attributes in-product; the AI-failure-mode framing is
positioning copy only.

---

## 5. LoC — counts vs location (two distinct things)

A chunk carries both, and they must not be conflated:

- **Counts (size):** git `+added/−deleted`, plus the **adjusted LoC** (counts after exclusions).
  - **Displayed = adjusted**, not raw git.
  - **Moved** lines → `moved N`, excluded from +/−.
  - **Generated** Concern → collapsed, excluded from the adjusted split.
  - Raw **git LoC** reachable on click; carries an "adjusted" badge.
- **Location (where):** the *actual changed lines*, split by side —
  - **`(+) added`** = new-side line numbers; **`(−) removed`** = old-side line numbers.
  - Changed lines only, NOT the `@@` hunk window (which includes context).
  - Used for navigation and diff rendering; many disjoint ranges = scattered change = chunk-split candidate.

This added/removed-by-side model is exactly how diff-viewer libraries (e.g. diffs.com / `@git-diff-view`, react-diff-view) represent hunks — so a Chunk's data maps directly onto the FE rendering primitive: `{ filePath, concern, role, group, addedRanges(new-side), removedRanges(old-side), gitAdded, gitDeleted, adjustedAdded, adjustedDeleted, movedCount }`. The chosen FE lib renders the diff; our chunk metadata overlays category/concern/role/risk on top.

> **Naming:** this is **adjusted LoC** (objective — git minus moves minus generated). A future **signal LoC** (mechanically excluding blank/punctuation/import lines) is possible but deferred; it must be deterministic, never hand-judged, or it breaks inter-rater reproducibility and the git reconciliation.

---

## 6. Change-group boundary — quick rule

- One group = the largest chunk set expressible as **ONE Summary + ONE Dominant Category**.
- Need two unrelated summaries → split.
- Author commit structure is a *hint*, never the boundary.
- Intent lives on the carrier chunk(s); supporting chunks inherit it, are not independently categorized.

---

## 7. Special tokens & expansion protocol

- **`uncertain`** — valid output when confidence is below threshold on Category or a flag. Don't force a token; mark uncertain and move on.
- **Expansion:** to add a Category / Concern / Risk-Surface attribute, register it *here first* (with status), then draft its playbook (`playbooks.md`) or detail (`risk-surface.md`). Never invent a token inline in a brief.
- **Deprecation:** drop a token here if it never fires across 10+ PRs or always co-fires with another (redundant) — and update the deep files.

---

## Status

- Stable axes: Concern, Role, Risk Surface (starter set), LoC rules, boundary rule.
- Category: all 8 have playbooks (backfilled 2026-07-04 to match the shipped FE set).
- Concern checks: all 5 supporting Concerns covered (`test`, `doc`, `spec`, `config`, `generated`).
- Contribution rules for tokens, playbooks, and risk attributes: repo-root [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
