# 0006: Delta Brief: Per-Reviewer Generation, Caching, and State Model

Status: superseded in part by 0024, 0040

The **Delta Brief** is computed per reviewer, relative to that reviewer's **Checkpoint** (the SHA at which they last submitted a review), as a *generated* artifact over the checkpoint→head **tree diff** — not a mechanical diff of two briefs, not a replay of commits, and not a single reviewer-agnostic stream. The full **Brief** is generated per head SHA and shared; the **Delta Brief** is the per-reviewer overlay, generated only when a Checkpoint exists. Both are produced ahead of the reviewer by background workers on webhooks ("pre-warming") and cached, so generation is off the human's critical path.

## Context

The reshaped center of gravity (`docs/internal/mvp/center-of-gravity.md`) makes re-review the lead value: AI raises PR volume → more follow-up commits → more re-review *events*, each a costly mental-model reload that reviewers skip and rubber-stamp. The Delta Brief does the reload for them. That makes the delta the first feature requiring **persistent state** — the thin-slice categorizer (`tools/categorizer/`) is deliberately stateless (single PR, single call, no identity, no history). This ADR fixes the state/generation model the delta needs before that layer is built; the comment-anchoring and flag-carry-over mechanics are a sibling decision (ADR 0007, in progress) and are out of scope here.

Five forks drove the design.

## Considered Options

- **Baseline of a delta.**
  - *Reviewer-agnostic rolling chain* — delta always relative to the previous generated brief. Cheapest/shared, but breaks the core value for the away-reviewer: someone who reviewed three pushes ago only sees the last push unless deltas are composed.
  - *Fixed at activation* — always "everything since the PR was first briefed." Degrades to ≈ the whole PR on long-lived PRs.
  - **Per-reviewer Checkpoint (chosen)** — delta spans the SHA where *this* reviewer last submitted → head. Correct across any number of missed rounds.
- **How the delta is computed.**
  - *Mechanical diff of two briefs* — match chunks across SHAs by file/line range. Rejected: brittle under rebases, reformats, and moves.
  - **Generated mini-brief over the incremental diff (chosen)** — run the categorizer flow over the span, with relational inputs (prior review state, head brief). Replaces brittle matching with reasoning and yields change-groups + summary + "does this address the prior review / introduce undiscussed risk."
- **What the span is computed from.**
  - *Commit replay* — list/aggregate the commits since the checkpoint. Rejected: meaningless after a rebase/force-push.
  - **Tree diff (chosen)** — diff the checkpoint tree against the head tree. Well-defined regardless of history rewrites.
- **Generation timing.**
  - *Purely lazy* (generate on open) — every reviewer waits 30 s–minutes.
  - **Eager pre-warm (chosen)** — background workers generate on webhooks (push → brief; re-request → delta) and cache the result, so the open is a cache hit.
- **Huge span (big refactor).**
  - *Always generate the delta + warn the user it's large* — most expensive case, and a blocking warning drives reviewers away.
  - **Full-brief fallback (chosen)** — past a size heuristic, skip the delta call and default to the always-available full brief.

## Decision

1. **Two artifacts.** Full `Brief` per head SHA (shared across all reviewers of that SHA); `Delta` per `(checkpoint → head)` pair, selected per reviewer by their Checkpoint.
2. **Checkpoint** = the SHA at which a reviewer last *submitted* a review. Submitting advances it; viewing does not. Per reviewer, so two reviewers hold different checkpoints and receive different deltas over different spans.
3. **Brief generation** is debounced (~60 s trailing, ~~repo-YAML configurable~~ **amended 2026-07-12: instance-config configurable** — per-repo YAML is dead) on push, and warmed during the draft self-review window. Shared/cached by SHA.
4. **Delta generation** happens only when a Checkpoint exists (a prior submitted review). ~~It is pre-warmed on **re-request of an already-reviewed reviewer** (their checkpoint→head); otherwise lazy.~~ **Superseded (2026-07-05, per ADR 0024 §Generation):** delta cores are **pre-warmed on every settled push-bundle, one per distinct checkpoint SHA** on the PR — never lazy, never view-triggered (preserves ADR 0020's single trigger model; a lazy path would reintroduce click→compute). Staleness is bounded by the huge-span skip (#7): a checkpoint whose span crosses the threshold stops earning deltas and falls back to the full Brief. `review_requested` / `pull_request_review` events enqueue the same single `generate` job as gap-fillers; idempotent writes make repeats no-ops. Cached in two layers — a shared **core** (the code-change narrative, keyed by SHA-pair) and a per-reviewer **carry-over overlay** (keyed by reviewer × SHA-pair, per ADR 0007); reviewers sharing a checkpoint share the expensive core and each keep their own cheap overlay. A first-time review has no delta — just the shared Brief.
5. **Delta = tree diff** (checkpoint tree → head tree) plus relational inputs (the reviewer's prior review state and the head Brief). Robust to rebase/force-push.
6. **Cancellation.** At most one in-flight *speculative* brief generation per PR; when head advances, abort the superseded job. ~~Never abort a generation a human is actively awaiting.~~ **Amended (2026-07-05):** the "human awaiting" exception is retired — view-tracking was dropped with `activated_at` (ADR 0020 / ADR 0018 amendment), so it is unknowable; and the superseded-artifact residual value was judged below its token cost. Cancellation is **cooperative and mid-call**: supersession checked before each artifact call *and* by a cheap head-poll (~20s) during streaming; on mismatch, abort via the SDK's AbortSignal (stops output-token billing; input tokens of the in-flight call are already sunk). An abort is not a failure — no retry, no salvage/dump, `attempts` untouched; the generation projection records a terminal `superseded` status. Generation runs as a background **task** (debounced trigger → single-flight lock → fetch PR data → synthesize via LLM → write the content-keyed artifact). Because artifacts are keyed by content (SHA / SHA-pair), writes are **idempotent** — a lost race produces the same artifact (wasted LLM spend, never corruption), so the single-flight lock is a cost optimization + cancellation hook, not a correctness mechanism. Its backend (Redis, DynamoDB conditional writes, or a DB advisory lock) is deferred with the compute stack. **(Resolved: Postgres advisory lock + `graphile-worker` on a long-lived worker — ADR 0015.)**
7. **Huge-span handling.** Past a tunable ~60–70 % size heuristic (incremental changed-lines vs whole-PR), skip the delta call and default the view to the always-available full Brief. Surface a one-line honest label and a toggle between views — never a blocking warning.
8. **Durable baseline.** Persist each Checkpoint's Brief *and* a diff/tree snapshot at review time, so deltas survive force-push and GitHub's GC of unreachable commits.
9. **Pre-warming** = a background worker runs the model call on a webhook and stores the JSON; "warm" = the artifact is already cached when the reviewer opens. Fetching diffs is the cheap input step, recomputed on demand; only the model output and the baseline snapshot are persisted.
10. **No front-end progressive streaming in v1.** Backend streaming is retained only because the SDK rejects non-streaming calls over ~10 min. The wait UX is diff-first (raw diff visible immediately) + a determinate progress state; the structured brief renders atomically on completion.
11. **Delta spans checkpoint→head as one artifact; never per-commit.**

7. **Mid-review follow-ups use a session baseline, not the Checkpoint.** While a reviewer is mid-review (opened, not yet submitted), a follow-up commit is surfaced **in-tool** relative to their current view SHA (a transient *session baseline*) — a non-intrusive "N new commits since you opened" notice, then the **Fast-lane** (cheap) or full **Delta** of the change per the triage (ADR 0010). The reviewer never needs GitHub to see it and is never yanked off their current view; they choose when to advance to the new head (re-anchoring draft work via the line-map). The **Checkpoint** advances only on submit. Carry-over for a mid-review follow-up runs against the reviewer's **draft** comments/dispositions (Mind-Map state), not Settled flags. The client discovers a mid-review follow-up by **polling** the PR's latest head SHA (~30–60 s; a cheap SHA check, server-side pre-warmed by the webhook) — **not** SSE/WebSockets, which would force a stateful-compute choice (ECS / response streaming) for a low-urgency notice. SSE is deferred until a genuine low-latency need exists (e.g., live multi-reviewer presence). Polling keeps the stateless-serverless option open.

## Why This Way

The per-reviewer Checkpoint is the only baseline that satisfies the interview value — "reload *my* model since *I* last looked," across however many rounds were missed — and the obvious objection (it sounds like per-reviewer regeneration cost) dissolves once the delta is **cached by the `(checkpoint, head)` pair**: cost scales with distinct baseline spans actually opened, not with reviewer count, and reviewers on the same cadence share. That reconciles the per-reviewer correctness with the agnostic/sharing instinct that motivated the rolling-chain alternative.

Generating the delta (rather than mechanically diffing briefs) and computing it as a tree diff (rather than a commit replay) together remove the two brittle failure modes — cross-SHA chunk matching and history rewrites — and make the big-refactor case the feature's best showcase ("95 % mechanical rename; here are the 3 real spots and the 2 comments it broke") instead of its worst. Pre-warming + the full-brief fallback keep both latency and cost off the human path: the shared Brief is amortized across all viewers, and the delta is only spent when a returning reviewer actually needs it and only when the span is small enough to be worth it.

## Consequences

- **Introduces the system's first persistent state:** Briefs keyed by SHA, Deltas keyed by SHA-pair, per-reviewer Checkpoints, and baseline snapshots. The thin slice stays stateless; this is net-new infrastructure.
- **Requires a GitHub App + webhooks** (`push`/`synchronize`, `ready_for_review`, `review_requested`) and a **background worker** with debounce, single-flight, and cancellation — not a request/response path.
- **Cost** scales with distinct `(checkpoint, head)` spans opened plus one full Brief per reviewed head SHA; the full-brief fallback caps the worst case.
- **Comment anchoring and flag carry-over are deferred** to ADR 0007. The ownership split is already agreed (lean on GitHub-native tracking for shipped comments; build our own anchoring only for flags + draft/Mind-Map work), but the mechanism and "addressed vs moved" detection are still open.
- **Config** (debounce window, recompute triggers, size-fallback threshold) ~~lives in the per-repo YAML described in center-of-gravity, with org defaults~~. **Amended (2026-07-12, Instance-level generator config):** per-repo YAML (and org-default overrides) is **killed entirely** — all runtime config lives at the **instance level**, in one optional `mergebrief.config.yaml` located via `MERGEBRIEF_CONFIG` (ADR 0013 #6 as amended). These blocks' semantics stay with the Comparison-overlay follow-ups ticket, now targeting instance-level config.
- **Glossary updated** (`CONTEXT.md`): `Delta Brief` refined to a tree-diff-of-states that requires a Checkpoint; new `Checkpoint` term; the Brief-shared/Delta-per-reviewer relationship.
