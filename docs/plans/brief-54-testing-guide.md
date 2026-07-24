# BRIEF-54 — Testing guide (manual smoke, /verify harness)

> Living doc for the BRIEF-54 stack. Updated as PRs evolve; final after PR 4.
> Run against the local /verify harness (see the `verify` skill: postgres,
> env wiring, session seeding).

## Setup

- Bring up the /verify harness as usual (API + web + worker + seeded session).
- You need PRs in three intent shapes:
  1. **Precise**: a PR whose description links a concrete ticket-like page
     (actionable asks) — expect populated buckets.
  2. **Broad/none**: a PR with an epic-style linked ticket, and one with no
     usable description — expect the unavailable line.
  3. **Pre-feature**: any brief generated BEFORE PR 1 merged (no `intentCheck`
     field at rest) — expect no bar at all.
- For the mark-ready checks you need an own-draft PR (viewer is author).

## PR 1 — generation surface (verifiable pre-FE via stored JSON)

- [ ] Generate a brief on a precise-intent PR; inspect the stored brief JSON:
      `intentCheck` present, `specificity: "precise"`, quotes verbatim from
      ticket/description, `ticketUrls` ⊆ the PR's linked-context URLs,
      `groupIds` all reference emitted change-groups.
- [ ] Broad/none PR: `specificity` correct and ALL buckets empty.
- [ ] Force a validator drop (e.g. hand-run categorize with a stub that emits
      a bad groupId, or check any real drop): warning line appears in
      `generationWarnings` with the `intent check` label.

## PR 3 — intent bar

- [ ] **Precise brief**: intent bar renders stacked with the attribute
      jump-rail; header shows neutral symmetric counts naming all three
      buckets; no warning colors/icons; body **collapsed** on load and never
      auto-expands (reload with gaps present — still collapsed).
- [ ] Expand: first line is the fallible framing; buckets list items with
      verbatim quotes; ticket-side quotes carry source links (href is the
      ticket URL, http/https only), `sourceUrl: ""` items show
      title/description attribution with no link.
- [ ] Group jump-links: clicking a `groupIds` chip jumps to that change-group
      (same behavior as the TocBar path).
- [ ] **Broad/none brief**: same quiet bar, single "intent check unavailable"
      line with the reason; no counts, no buckets.
- [ ] **Pre-feature brief** (no `intentCheck` at rest): NO bar renders.
- [ ] **Warnings chip**: on a brief where a validator dropped an item, the
      existing generationWarnings surfacing shows the intent-check warning
      (no new UI — verify the line is there).
- [ ] Collapse/expand state does not leak between briefs (switch revisions).

## PR 4 — mark-ready modal line

- [ ] Own-draft PR, precise intent, `statedButMissing.length > 0`, plus at
      least one unaddressed risk flag: modal opens (flags trigger it) and
      shows ONE count-only secondary line ("N stated asks not found in the
      diff") below the flags list, quiet styling.
- [ ] Click the line: modal closes and the page jumps to the intent bar,
      expanded.
- [ ] **Clean intent** (no gaps): no secondary line (absence, not a green
      verdict).
- [ ] **Gaps but NO unaddressed flags**: modal does NOT open — gaps alone
      never trigger it (mark-ready proceeds directly).
- [ ] Broad/none intent: no line regardless of buckets.

## Cross-cutting

- [ ] Delta view and revision-narrative comparison never show intent UI.
- [ ] Warnings chip on a validator-dropped item rides the existing
      generation-warnings surface (BRIEF-11), not a new component.
