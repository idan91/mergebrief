# 0012: Brief Index, Commit Range, and Comments on the Full Brief

Status: superseded in part by 0027

The full **Brief** gains three things: a PR-global **index** (the Nth distinct head SHA briefed for the PR), the **commit range** it covers (whole-PR base→head), and the PR's shipped **Comments** (from all reviewers) carried for **display only**, each with GitHub-native **outdated** status. Comments live in a separate `.comments.json` sidecar — for both the brief and the delta — and the per-reviewer focus of comment-resolution stays the **Delta Brief**'s job (ADR 0011), deferred to the product runtime.

## Context

Re-review is the lead value (ADR 0006 / center-of-gravity). A returning reviewer opens a *fresh* full Brief at the new head alongside their Delta. To make that reload legible the Brief needs to say *which* brief in the PR's sequence it is and *what span* it covers, and to show the existing review conversation GitHub-style — including which comments are now **outdated** — without bouncing to GitHub. Today the full Brief has none of this: no index, no commit range, and (per ADR 0011) it deliberately carried no comments at all — comments were scoped to the delta. The CLI is also deliberately stateless (`tools/categorizer/`), which collides with "the *Nth* brief."

## Decision

1. **Index = PR-global ordinal by distinct head SHA** (amended, see Amendments). The Nth *distinct head SHA* briefed for this PR, shared across all reviewers (consistent with "Brief cached by SHA / shared per SHA"), never per-reviewer. A display/ordering label on top of the canonical SHA key, not a new identity.
2. **Stateless derivation via a per-PR manifest.** The CLI keeps a tiny `out/<owner>-<repo>-<number>.briefs.json` mapping head SHA → ordinal in first-seen order; a new SHA increments, a re-run at a known SHA reuses its index (idempotent). This is artifact-dir bookkeeping, explicitly superseded by the product DB later — not real state in the CLI's code path.
3. **Commit range = whole-PR base→head SHA + commit count.** The full Brief covers the whole PR, so its range is the PR's base→head with a commit count. "New since the previous brief" is *not* duplicated onto the Brief — that is the Delta's span.
4. **Comments on the Brief are display-only.** The full Brief fetches the PR's review comments (all reviewers, on demand) and carries them for GitHub-style display. It runs **no** comment-resolution analysis — `commentsAddressed` / per-chunk `addressesComments` remain delta-only (ADR 0011). Clean split: **Brief = display, Delta = analysis.**
5. **Outdated is read from GitHub, never recomputed** (ADR 0007 ownership split). Derived from a **nulled `line`** on a line comment (GitHub nulls the anchor line once it leaves the current diff; the legacy `position` field proved unreliable). Exact on the full Brief (always at current PR head); on the Delta it is outdated-*relative-to-current-PR-head*, not the delta's head — a documented limitation, like the existing three-dot compare-diff caveat in `tools/categorizer/src/github/fetch.ts`.
6. **Comments live in a sidecar, one convention.** `<stem>.comments.json` for the brief and `<stem>.delta.comments.json` for the delta (threaded: a flat array carrying `inReplyToId`; the FE builds the tree). The delta's current *inline* `reviewComments` bolt-on is dropped in favour of the sidecar, and `outdated` is added to it. Index + commitRange ride on the **Brief artifact type** but are **omitted from the model's generation schema** and filled by the CLI (extending the existing `pr`-overwrite pattern, so the model never echoes metadata or comment bodies).
7. **Reviewer-focused delta summary is deferred.** The stateless CLI has no reviewer identity, so the delta summary stays all-reviewers. The per-reviewer focus is the carry-over overlay (ADR 0007), built with real reviewer state in the product runtime.

## Considered Options

- **Index scope.** Per-reviewer sequence / per-generation counter — rejected: conflicts with the shared-per-SHA Brief; the meaningful unit is a distinct PR state, not a reviewer's open count or a re-run.
- **Index source in a stateless CLI.** `--index` flag (human-supplied, mislabel-prone) or "CLI emits range, runtime numbers it" (then the CLI artifact can't show `_1`/`_2` today). Rejected for the manifest, which makes the ordinal real now while staying disposable.
- **Comments on the Brief: also analyze** (compute resolution like the delta). Rejected: an LLM pass on every shared per-SHA Brief, duplicating the delta and reversing ADR 0011 for no gain — the Brief's value here is display.
- **Comment storage: inline in the brief JSON.** Rejected: comment bodies are large display data; a sidecar keeps the brief artifact lean and (importantly) keeps the bodies out of the model's structured output. Also unifies brief + delta on one layout.
- **Outdated: recompute per artifact head.** More exact for arbitrary deltas, but contradicts ADR 0007 ("outdated is GitHub's word, read not recompute") and re-does anchoring GitHub already owns.

## Why This Way

The index and range make the re-review reload self-describing ("brief _2, the 4 commits since _1") with a label that does not fight the canonical SHA key. Display-only comments give the reviewer the GitHub conversation in-tool at near-zero added cost on the shared Brief, while leaving the expensive, reviewer-specific *resolution* analysis where it belongs — the Delta. Reading outdated from GitHub buys free correctness on the high-volume case and confines our imperfect anchoring to what GitHub can't see (ADR 0007). The sidecar + omit-from-generation keep large comment bodies off the model's output path, and the manifest keeps the stateless CLI honest about a sequence concept it does not truly own.

## Consequences

- **Artifact + filename change:** `<owner>-<repo>-<number>_<index>_<head8>.{brief,diffs,comments}.json`; a new per-PR `*.briefs.json` manifest in `out/` (`tools/categorizer/src/artifacts/manifest.ts`, `output.ts`). Existing `<repo>-<num>.brief.json` consumers must migrate.
- **`BriefSchema` grows** `index` + `commitRange` (CLI-owned: omitted from the model schema, filled after — same treatment now extended to `pr`).
- **New comment sidecar schema:** a formalized zod `ReviewComment` (id, file, line, originalLine, author, body, inReplyToId, **outdated**); `tools/categorizer/src/github/comments.ts` reads `line`/`subject_type` (for outdated) and the PR base SHA + commit count.
- **Full Brief now fetches review comments** (it did not before) — one extra `gh api` call per brief, amortized by per-SHA sharing.
- **Delta output shape changes:** comments move from inline to `<stem>.delta.comments.json`; `outdated` added.
- **Partially revises ADR 0011's scope:** comments now reach the full Brief (display-only); the per-chunk *summary* remains delta-specific. The per-reviewer comment focus is still the ADR 0007 overlay, deferred.
- **CONTEXT.md updated:** `Brief` gains index / commit range / display-only comments; a relationship line ties the index to distinct head SHAs and to the Delta's span.
- **CLI range affordance:** the brief CLI accepts an optional explicit `<base> <head>` span (mirroring the delta CLI), briefing that span instead of the whole PR at current head. This is a dogfood/testing affordance — it lets us generate `_1` at an earlier head, a delta, then `_2` — and does **not** change the product semantics (in product a Brief is always the whole PR at a head). Default remains whole-PR.
- **Storage identity (ADR 0018):** in the product DB the Brief is keyed on the full `(base, head)` span — its content is a function of both endpoints (content-addressing / immutability). The **index stays a per-distinct-head display label**, resolving to the current Brief for that head; no change to index semantics. (Amended, see Amendments.)

## Amendments

### 2026-07-07: The comments-display half is the local CLI path

The comments-display half of this record is the **local CLI path** design (sidecar snapshot, nulled-`line` outdated). For the product runtime it is superseded by [ADR 0027](0027-pr-conversation-live-display.md) (live GraphQL fetch, no snapshot, `isResolved`/`isOutdated` first-class). Index + commit range are unaffected.

### 2026-09-26: The index is the brief's address

A brief URL names it as `?rev=<index>`; the index counts every brief on the PR, retargets included, and the database holds it unique per pull request (`brief.head_index`, `brief_pull_request_head_index_key` in `packages/persistence/src/schema/brief.ts`). It is no longer a display label layered over the SHA key.
