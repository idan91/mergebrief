# 0019: Brief Timeline Navigation

Status: superseded in part by 0024, 0040

> Superseded in part by ADR 0024: timeline points remain full Brief heads, but the `Full / Delta` lens is replaced by **View** (`Full Brief` / `Changes Only`) plus **Compare** (`Your last review` / `Previous Brief` / `Off`).

> Amended 2026-09-30: the navigator leaves the Header on both routes. Points are rows of the Sidebar's **Revisions** tab, newest first, each a button; there is no Previous/Next stepper, picker or visual stepper (§2, §5, §7). A selection still updates the URL and is announced through a polite live region; once the next brief is live, focus returns to the current row in the Sidebar column, or to the bar's expand control on the narrow band, not to the brief heading. The tab sits in the Sidebar, so Focus mode and Changes Only, which hide the Sidebar, offer no revision navigation.

The Brief page exposes a discrete, accessible timeline of a PR's distinct head states. A timeline point is a full **Brief** at one head; a **Delta Brief** is a selectable lens on that same point when it is available for the selected reviewer baseline.

## Context

A returning reviewer needs to move through the PR's revision history without confusing a whole-PR Brief with the reviewer-relative Delta Brief. The existing Brief index already supplies the stable, PR-global order of distinct head SHAs (ADR 0012). A Delta Brief is keyed by a baseline→head span and exists only when it is meaningful for a reviewer (ADR 0006).

Treating briefs and deltas as one flat sequence would make adjacent navigation misleading: two Delta Briefs can have different baselines, and a Delta is not a replacement for the full state at its head.

## Decision

1. **Timeline points are Brief heads.** Each point represents one indexed, full Brief at a distinct PR head SHA. The timeline is ordered by Brief index and selecting a point selects its head.
2. **The full Brief is the default lens.** It shows the whole PR from PR-base to the selected head. The timeline moves through these points with Previous/Next and direct selection.
3. **The Delta Brief is a lens, not a point.** A Delta may be selected at a point only when a valid baseline→selected-head Delta exists. Every valid Delta must have its corresponding full Brief at the same head; the UI never renders a delta-only timeline point.
4. **Baseline selection supports current and previous submitted reviews.** The current Checkpoint is the default baseline. The reviewer can select a prior submitted-review point where a corresponding Delta is available. The selected baseline is always named in the Delta control.
5. **Navigation preserves the selected lens when valid.** Previous/Next continues to move between Brief points. If the requested Delta is unavailable at the newly selected point, the UI shows the full Brief as the fallback and clearly explains that the Delta is unavailable. Timeline points with an available Delta are visibly and accessibly identified.
6. **Historical points are writable behind an explicit submit acknowledgement.** *(Amended 2026-08-03; original decision: historical points are read-only, later extended to any span that is not the PR's current one.)* A stale-HEAD view — a historical revision, or the newest brief after the PR head advanced past it — keeps the comment composer live, and batch Submit requires an explicit acknowledgement beside the Submit control (in the receipt drawer originally; since 2026-08-04, on the submit modal's verdict view — the ack rides the commit affordance wherever it lives): comments stay pinned to the reviewed head, which GitHub accepts and may mark outdated. Rationale: drafts are span-keyed, so the previous hard block stranded a reviewer's staged work whenever the head moved mid-review; GitHub natively supports older-commit reviews, making the blocked footgun cosmetic. Two carve-outs stay hard read-only: a stale-BASE view (same head, superseded base — the rendered diff is not the PR's current one, so anchors can land wrong or nowhere; write-safety), and the own-draft state's composer on any stale view (post-now exists only at the current head, so a stale-staged draft would have no exit). Draft persistence is unchanged: session-scoped browser storage, `Clear local drafts`, cleared when the browser session ends; a production account/session change must also clear that reviewer's locally cached drafts.
7. **Accessibility is WCAG 2.2 AA.** The navigator provides labelled Previous/Next buttons, a native revision picker, and an ordered visual stepper. The picker supplies direct access to every revision; the stepper is an enhancement, not the only control. It renders at most nine nearby points plus first/last shortcuts and ellipses, so long-lived PRs do not create an unbounded button list. Selection changes update the URL, move focus to the loaded Brief heading, and announce the selected revision through a polite live region. On small screens the picker and Previous/Next remain available while the stepper may be hidden.
8. **Local-first delivery.** The first implementation operates over the existing local categorizer artifacts. It exposes only full Briefs and Deltas actually present in local output; it does not synthesize or generate missing Deltas.

## Consequences

- The read model groups artifacts by PR and head, rather than exposing the current flat local artifact list as the primary navigation model.
- URL state identifies both the selected head and lens, enabling deep links and browser navigation.
- The local UI needs session-scoped browser persistence for draft content and selected review context, plus a `Clear local drafts` affordance. Production persistence and Delta generation remain separate future work.
- The persistent **Checkpoint** stays the current reviewer baseline. Supporting a previous submitted-review baseline requires an immutable submitted-review history in the production model; the local implementation derives availability from the shipped artifact set.
- A full Brief remains useful when Delta generation is pending, fails, or is intentionally skipped for a large span. The UI communicates that state without blocking review.
