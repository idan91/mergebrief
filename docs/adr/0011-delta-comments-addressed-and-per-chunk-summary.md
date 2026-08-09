# Delta: Comments-Addressed + Per-Chunk Summary

The delta gains a **comments dimension** and **per-chunk summaries**. At the delta level, a `commentsAddressed` summary describes how the follow-up answers the prior review. Per chunk, a short `summary` (what this chunk changed) plus an optional `addressesComments` link to the review comment(s) that chunk resolves. The comment source for the stateless CLI is **GitHub review comments**; the per-reviewer version is the carry-over overlay (ADR 0007). Replies are **displayed, human-authored** — never AI-written in v1.

## Context

Dogfooding the delta showed it can describe "addresses prior review" only as text buried in `wholePrImpact`. To make re-review actually faster, that needs to be **structured and navigable**: a reviewer returning to a PR wants to see, per chunk, *what changed here* and *which of my comments this answers*, and to read the resulting comment thread in-tool — comment → reply → the change that resolved it — without bouncing to GitHub. The FE already models a `ReviewComment` (`apps/web/src/features/review/comments.ts`) anchored to a chunk (`CommentAnchor.chunkId`) with a `draft | submitted` status, so the resolution link maps onto an existing model.

## Decision

1. **Delta-level `commentsAddressed`** — a Markdown summary of how the follow-up answers the prior review as a whole. Present only when there are comments; empty/omitted otherwise.
2. **Per-chunk, option (c):** each delta chunk gains a short **`summary`** (one-line *what changed here*, comment-agnostic) and an optional **`addressesComments`** — the id(s) of the review comment(s) this chunk resolves (absent when it answers none). The what-changed line serves the scan; the link serves comment-resolution.
3. **Comment source.** The CLI fetches **GitHub review comments** at run time (stateless, public) and feeds them to the delta prompt — a shared, GitHub-sourced approximation. The **per-reviewer** "addressed / reopened / orphaned" classification remains the **carry-over overlay** (ADR 0007), which needs reviewer state; the CLI does not attempt it.
4. **Replies: display, don't author.** v1 **shows** comment threads + replies in-tool; it never authors them. The no-AI-text rule holds (agent assists, human writes). Hooking **AI comments / existing review tools / a headless mode** is an explicit future lane — **not v1**.
5. **FE.** Render comments GitHub-style by **reusing the existing `ReviewComment` component** (the **submitted** variant) in `apps/web/src/features/review`, extended to show **replies** (threaded). The per-chunk `addressesComments` link rides on the existing `CommentAnchor.chunkId` model.

## Considered Options

- **Text-only (status quo)** — the delta mentions addressed comments inside `wholePrImpact`. Rejected: not navigable, not tied to a chunk, not displayable as a thread.
- **Per-reviewer carry-over only** — wait for the state layer (ADR 0007). Rejected for now: the stateless GitHub-comments approximation is dogfoddable today and matches the original delta vision; carry-over is the product upgrade, not a blocker.
- **AI-authored / auto-resolved replies** — rejected for v1 (violates no-AI-text); deferred to the headless / tool-hookup lane.

## Why This Way

Structured beats free text: a re-reviewer scans chunks and immediately sees which ones answer which comments, with the delta-level summary as the overview. Sourcing from GitHub comments keeps it stateless and shippable now, while the per-reviewer carry-over overlay remains the product-grade version — the same core-vs-overlay split the rest of the delta already uses. Reusing the existing anchored `ReviewComment` component keeps the UX GitHub-familiar and the build small, and human-authored replies preserve the project's central honesty invariant.

## Consequences

- **`DeltaBriefSchema` grows:** delta-level `commentsAddressed` (string, empty when none); per-chunk `summary` (string) and `addressesComments` (string[] of comment ids). Per-chunk summary is **delta-specific** for now — not added to the full brief. **(Partially revised by ADR 0012:** review *comments themselves* are now carried on the full Brief too, **display-only** — no resolution analysis; the per-chunk summary stays delta-specific. Comments move to a `.comments.json` sidecar for both artifacts.**)**
- **CLI build:** fetch PR review comments (`gh api …/comments`), pass them to the delta prompt, emit the new fields. Comment→chunk attribution is the model's inference in the CLI; the product version uses the FE's `CommentAnchor.chunkId` + carry-over anchoring (ADR 0007).
- **Delta prompt:** instruct it to produce `commentsAddressed` + per-chunk `summary` + `addressesComments` grounded in the supplied comments; never author replies.
- **FE:** reuse + extend `ReviewComment` (submitted variant) with reply threads; wire `addressesComments` into the chunk view. Part of the FE wiring.
- Builds on ADR 0006/0007/0008; the per-reviewer comment-resolution is the carry-over overlay (0007). AI-comment / existing-tool / headless integration is a tracked future lane.
