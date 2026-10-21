# 0007: Delta Brief: Comment Anchoring and Flag Carry-Over

Status: superseded in part by 0040

In a Delta Brief, prior review work is re-placed against the new head **by ownership**: GitHub-native shipped **Comments** reuse GitHub's own position/outdated tracking; our **Flags**, dispositions, and unshipped drafts are anchored by us via the span's **positional line-map**, with the delta's LLM pass used only to *locate* moved items — never to override a positional result. Each prior flag is classified **New / Reopened / Settled / Dropped**, where Reopened is decided purely positionally (any change to the flagged region reopens) and every ambiguity biases to re-look.

## Context

ADR 0006 fixed the delta generation and state model but deferred how a reviewer's prior work — shipped comments, flags, dispositions (addressed/dismissed), and Mind-Map drafts — is re-placed when head moves. These are the `movedCommentAnchors`, `orphanedCommentIds`, `reopenedRiskFlagIds`, and `stillResolvedRiskFlagIds` fields in the delta fixture.

The asymmetry that drives every choice here: a false **"Settled"** is a silent rubber-stamp — the exact failure the product exists to prevent — while a false **"Reopened"** costs only a glance. The design must make the dangerous error structurally hard and the cheap error the default.

## Considered Options

- **Who anchors what.**
  - *Own all anchoring ourselves* (one uniform mechanism). Rejected: re-anchoring comments across rebases/force-pushes is exactly the brittle, never-perfect work GitHub has already absorbed for shipped comments.
  - **Split by ownership (chosen)** — lean on GitHub for shipped comments; build our own anchoring only for what GitHub can't see (flags, dispositions, drafts).
- **Anchoring mechanism (for what we own).**
  - *Pure positional line-map.* Cheap, deterministic, but reads a move/reformat as delete+add → false orphan.
  - *Pure LLM.* Handles moves semantically but is bad at exact line numbers and non-deterministic.
  - **Hybrid (chosen)** — positional line-map is the spine; the LLM pass refines only by *locating* moved-vs-orphaned items, and may never override a positional Reopened.
- **What triggers Reopened.**
  - *Infer whether the change was material.* Rejected — inferring "meaningful enough" risks missing a real change.
  - **Region-touched (chosen)** — any change to the flagged region reopens, no judgment.

## Decision

1. **Ownership split.** Shipped **Comments** → GitHub-native position + `outdated`, read not recomputed. **Flags**, dispositions, and unshipped drafts → anchored by us.
2. **Mechanism.** The positional line-map derived from the checkpoint→head **tree diff** (already computed per ADR 0006) is the spine. The delta's LLM pass refines only by *locating* a moved item (distinguishing **moved** from **orphaned**) and by producing the "does this address the prior comment" narrative. It can never turn a positional **Reopened** into **Settled**.
3. **Comment anchoring states** (our-owned items): **moved** (relocated to a new line) or **orphaned** (target line gone). Ambiguous → orphaned / needs re-look.
4. **Flag carry-over statuses:** **New / Reopened / Settled / Dropped**, resolved in this order:
   - attribute no longer fires at head → **Dropped**;
   - else the flagged region was touched in the span → **Reopened**;
   - else the reviewer had a disposition (addressed/dismissed) and the region is untouched → **Settled**;
   - else → **New**.
   Reopen is **purely positional** — any touch reopens; meaningfulness is never inferred. `Dropped` wins over `Reopened` (no point reopening a flag that no longer exists), and this is not materiality inference — it is just whether the head Brief still emits the flag.
5. **Bias rule.** Any ambiguity — can't map an anchor, can't tell if a comment was truly addressed — resolves to **Reopened** / needs-re-look, never **Settled**.
6. **Granularity.** Dispositions are per reviewer; carry-over statuses are a **per-reviewer overlay** on the shared head **Brief**, which carries the flags themselves. The Receipt aggregates across reviewers as before.

## Why This Way

The ownership split buys free correctness for the highest-volume case — GitHub already moves and outdates shipped comments across normal pushes — and confines our own (imperfect) anchoring to the data GitHub does not have. Within that, the positional spine is deterministic and right for the ~90 % case, and the LLM is used only for the one thing it is genuinely better at (semantic relocation) while being barred from the one move that is dangerous (downgrading a Reopened). Region-touched Reopen plus the bias rule make the safe error — an extra glance — the structural default, and eliminate the dangerous error — a silently stale "Settled" — by construction rather than by hoping a judgment call is right.

## Consequences

- **New state required:** per-`(reviewer, flag)` disposition records, carried across SHAs and re-evaluated each delta. The positional line-map is derivable from the same tree diff ADR 0006 already computes — no new fetch.
- **Dependency on GitHub** for shipped-comment position/`outdated`; its force-push outdating is coarse (binary) and is surfaced as-is rather than refined.
- **User-facing vocabulary** (`New` / `Reopened` / `Settled` / `Dropped`, and comment `moved` / `orphaned`) is added to `CONTEXT.md`; the FE may describe `Settled` as "still holds."
- **Over-reopening on trivial edits is accepted by design** — the cost of the no-inference rule, and the cheap side of the asymmetry.
- Together with ADR 0006 this specifies the delta subsystem (generation + state + carry-over). Line-level / sub-operation attribution remains deferred (ADR 0005).
