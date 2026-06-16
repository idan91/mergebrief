# Tiered Generation: a Cheap Triage Decides Experience and Spend

Every PR — and every follow-up — passes through a cheap **triage** cascade before any expensive generation: a free deterministic floor, then a small-model (**Haiku**) pass. The triage decides whether to spend the full Opus **Brief**/**Delta Brief** or show a cheap **Fast-lane**. **Risk decides escalation; size decides spend.** For follow-ups, touching a reviewer's prior flag/comment (carry-over) is itself an escalation. The human can always upgrade manually.

## Context

The GPT-5.5 review (`docs/reviews/2026-06-16_004323_gpt-5.5.md`, "Missing" #1–2 + Recommendation) flagged that the design handled only the **size** axis (the huge-span → full-brief fallback in ADRs 0006/0008) and missed the **risk** axis: a one-line change can be the dangerous one (widening a permission, flipping a boolean, removing validation, changing a flag default, a dep bump). It recommended a cheap deterministic triage on every PR that chooses the experience — compact for low-surface, full ceremony for sharp/returning. Cost is a live concern ($0.46/PR Opus), and Activation today is all-or-nothing ("no compute until click" / "compute on every draft").

## Considered Options

- **No-LLM deterministic scan only.** Good precision on keyword/path patterns (the `risk-surface.md` detects are grep-able), but **blind to semantic sharpness without keywords** — a boolean flip, a changed default, logic widening, an `isAdmin = true`. It would fast-lane exactly the dangerous keyword-less one-liner. Rejected as the judge; kept as a reliability *floor*.
- **Always generate the full brief; vary only the UI.** Bulletproof, but pays $0.46 on every trivial follow-up and makes every PR feel like homework (the review's explicit warning). Rejected.
- **Cheap-LLM triage cascade (chosen).**

## Decision

1. **Cascade, per PR event** (post-activation, debounced):
   1. **Deterministic floor (free):** always-escalate triggers — dependency/lockfile change, migration/schema path, auth-config path — plus the size signal. A dep bump escalates *deterministically*, not on a model's judgment.
   2. **Haiku triage (sub-cent), escalate-on-doubt:** reads the diff, decides trivial-vs-escalate, catching the semantic sharpness grep misses; when trivial, it emits the compact **Fast-lane** summary.
   3. **Opus full brief** only on escalation.
2. **Outcomes:** escalate → **auto-generate the full Brief** (pre-warmed per 0006); trivial → **Fast-lane shown** (the Haiku summary over the diff) **+ a "generate full brief" button** — a manual upgrade, because the tool never gates and the triage is always overridable.
3. **Follow-up commits (delta)** run the same cascade on the **incremental** diff, with one gate first:
   - **Carry-over gate (deterministic, per-reviewer):** if the follow-up **reopens** a Settled flag or **moves/orphans** a comment of this reviewer (line-map ∩ stored dispositions, ADR 0007) → **full Delta, regardless of size.** This is the re-review value; bias-to-reopen applies.
   - **Else** the standard cascade on the incremental diff: risky/large → full Delta; tiny + clean → Fast-lane delta + upgrade button.
   - The **carry-over gate is per-reviewer** (deltas are per-reviewer); the **intrinsic-risk triage gates the shared delta core**. Reviewer A (flagged the touched region) gets a full delta; reviewer B (didn't) can get the fast-lane on the same follow-up.
4. **Risk decides escalation; size decides spend.** Tiny-but-sharp escalates; large-but-clean gets the full brief (lots to comprehend); only tiny-and-clean fast-lanes. Non-verdict throughout — escalation reasons are factual risk-surface combinations ("full treatment — touches-auth + no-tests"), never "critical."
5. **Triage model = Haiku by default, escalate-on-doubt; Sonnet as the fallback** if dogfooding shows Haiku's recall on sharp-tiny changes is too low. A measurable, reversible knob.
6. **Activation refinement:** the cost gate moves from all-or-nothing to **"cheap triage always, expensive brief only when warranted."** The huge-span fallback (0006/0008) becomes the *size axis* of this same triage.

## Why This Way

Pure grep cannot see semantic sharpness, and that sharpness is exactly the dangerous one-liner; a cheap model can see it at ~1–2 orders of magnitude less than Opus — you spend a fraction of a cent to decide whether to spend $0.46. The deterministic floor still earns its place as a reliable always-escalate for the unambiguous cases. Failure is bounded: the fast-lane only ever applies to *tiny* changes, which the reviewer reads in full, and never to large or flagged ones; the carry-over gate guarantees the re-review-dangerous tiny follow-up escalates. The result is cost discipline and a "daily mode" that doesn't feel like homework, without sacrificing the catch on the change that matters.

## Consequences

- **New triage tier** in the worker pipeline (deterministic checks + a Haiku call) ahead of Opus generation, and a **Fast-lane** artifact type (a cheap summary).
- **Carry-over becomes a triage input**, not just a delta-render step — it gates delta generation per reviewer (extends ADR 0007).
- **Refines Activation** (ADR 0006 / `center-of-gravity.md` / `initial-scope.md`): the cost gate is the triage, not an all-or-nothing click/draft rule. The size-based huge-span fallback (0006/0008) is folded in as the size axis.
- **Adds a model knob** (triage model Haiku/Sonnet, escalate-on-doubt) that is measurable in dogfooding.
- **Glossary** gains **Triage** and **Fast-lane**.
- Sits atop the delta subsystem (0006–0008) and the author side (0009); the same triage governs reviewer briefs, deltas, and author self-review.
