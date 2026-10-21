# 0009: Author-Side Self-Review (v1, Secondary Surface)

Status: superseded in part by 0020

> **Amended 2026-07-13 ([ADR 0031](0031-single-brief-view-author-affordances.md)):**
> the FE realization is pinned down — there is **no separate author view or
> mode**; the author surface is state-derived affordances (`viewer == PR
> author && PR draft`, visibly labeled) inside the single Brief view, with
> receipt/submit machinery hidden in that state, flags as a read-only
> mirror, and mark-ready executed via `markPullRequestReadyForReview` with
> the viewer's token. The shipped author/reviewer toggle is killed. This
> ADR's analysis and decisions otherwise stand.

> **Amended 2026-07-24:** #2's intent-source **fallback chain**
> (linked ticket → PR description → none) is superseded by **composite intent
> sources**: PR title + description + all ticket-like linked blocks are judged
> *together*; the model resolves sources in-prompt and cites per-claim
> (verbatim quote + source URL for ticket-side buckets, change-group ids for
> diff-side). Specificity (precise/broad/none) is judged on the combined
> sources — split or vague sources are `broad` ⇒ unavailable, so
> unavailable-over-provisional stands unchanged, as do the three buckets,
> never-a-verdict, and de-emphasis. "De-emphasized" is realized as the
> **intent bar**: an always-visible neutral-counts header row stacked with the
> attribute jump-rail, body collapsed by default and never auto-expanded, with
> fallible framing; the soft gate (#3) carries a count-only secondary line
> (precise source + gaps only), never opening the gate by itself.

> **Amended 2026-07-25 (second amendment to #2):** the
> *precise* bucket grammar grows from three to **five factual buckets**; the
> two additions are alarm-class:
>
> - **`deviations`** — the diff moves *against* an ask the composite sources
>   state and **nowhere retract** (the retracted-nowhere rule: a reversal
>   acknowledged in the PR description means the sources no longer stand
>   behind the ticket's ask). Each item carries `acknowledged: boolean` —
>   when the description acknowledges the reversal the item is a quiet
>   receipt, not an alarm. `acknowledged` lives on the shared item shape
>   (which the grammar budget forces — see the wire-shape note below) and is
>   forced-`false` outside `deviations` (dead-field precedent).
> - **`maskedFixes`** — the sources claim a fix/delivery while the
>   diff operates only on the problem's *signal/check path* (log demotion,
>   catch-and-swallow, test skip/delete, threshold bump). **Routing rule**:
>   behavior moved against the ask ⇒ `deviations`; only the signal touched ⇒
>   `maskedFixes`; uncertain ⇒ `accomplished` — never a guessed
>   alarm.
>
> Tradeoffs and partial delivery are NOT deviations (partial delivery stays
> `statedButMissing`). Both alarm buckets are precise-only, like their
> siblings. Their validation posture is deliberately stricter than the
> warn-and-keep siblings: an alarm item lacking verified both-sides grounding
> — empty quote, zero surviving groupIds, or failed quote verification — is
> **dropped + warned**. FE realization: static bucket order (accomplished →
> maskedFixes → unacknowledged deviations → statedButMissing →
> doneButUnstated → acknowledged deviations), one muted caution line per
> non-empty alarm bucket, and **no yellow** — epistemic caution never borrows
> the code-risk palette; header counts stay neutral/uncolored and grow to
> five. The soft gate (#3) gains a second count-only line (unacknowledged
> deviations + maskedFixes), never blocking. The risk-surface link
> is structural only — groupIds resolve to group cards where
> `widens-error-handling` / `removes-validation` already render; no new risk
> category in v1. Revisit triggers: flagrant-under-broad misses (eval
> evidence) and a test-deletion risk attribute (labeling hits the gap).
>
> **Wire-shape constraint (measured 2026-07-25).** Five bucket arrays cannot
> be *generated*: Anthropic's structured-output grammar inlines the shared
> item shape at every `$ref` site, so cost is (arrays × fields per item) —
> not the count of distinct object shapes the first amendment assumed. Four
> arrays × four fields compiles; five arrays, or four plus a fifth field,
> both `400 "The compiled grammar is too large"`, and neither a newer model
> nor disabling thinking moves the limit. Generation therefore emits **one
> tagged `items` array** (each item carrying its `bucket`) and a mechanical
> fan-out produces the five buckets before validation. This is a
> representation detail, not a design change: the five buckets remain the
> stored vocabulary, the validation posture, and the FE contract.

The author view is the **same shared Brief**, shown one step earlier (pre-submit), with **no author-specific analysis engine and no persistent author state**. The only additions are two author-facing elements: an **Intent check** (a deliberately de-emphasized, ticket-gated section of the shared Brief) and a **Soft gate** (a transient, non-blocking pre-submit nudge). Post-review author flow is deferred to v2.

## Context

The 2026-06 reshape (`center-of-gravity.md`) promoted the author side from a v2 placeholder to a *secondary* v1 surface, on the logic that "minimal re-review" is mostly *prevented* before submit: if the author sees the issues during a self-review window, the review round never happens. `initial-scope.md` carried only ungrilled raw bullets ("critical code areas?", "trigger fix", pre-submit questions) and flagged the surface as needing its own grilling pass, held loosely. This ADR is that pass. It builds directly on the brief/delta subsystem (ADRs 0006–0008) and the dual-consumer Brief.

## Considered Options

- **Author analysis engine.** A separate author-specific analysis vs reusing the shared Brief. Chosen: **reuse the shared Brief** — one engine, one artifact (cached by SHA), author reads it first, reviewers inherit it. A second engine would double cost and break the dual-consumer model.
- **Intent check on a broad/absent ticket.** Generate a provisional check the author confirms/dismisses vs simply declare it unavailable. Chosen: **declare unavailable** — simpler, leaves the author side with zero persistent disposition state, and avoids a confirm/dismiss interaction whose value didn't justify the state it introduced.
- **Intent check prominence.** Headline vs secondary. Chosen: **secondary/de-emphasized** — LLM intent inference is the shakiest output; a prominent "you didn't do X" anchors (the design's chief enemy, CONTEXT.md). The Change-groups, grounded in the diff, carry the story.
- **Draft-phase generation.** Eager per draft push vs lazy on author self-review. Chosen: **lazy** — the only draft-phase consumer is the author; eager-per-push re-pays the model on every WIP commit (the cost gate draft-first introduces).
- **Post-review author flow.** In v1 vs deferred. Chosen: **deferred to v2** — for now the author reads reviewer comments on GitHub.

## Decision

1. **Author view = the shared Brief, pre-submit.** No author-specific analysis; no author **Checkpoint**, **Dismissal**, or **Receipt**. The author is a reader of the same artifact reviewers later inherit.
2. **Intent check** (a section of the shared Brief, both consumers see it):
   - **Source**: a linked ticket fetched from the PR description via the existing (SSRF-guarded) linked-context fetch → else the PR description itself → else none. No deep tracker integration in v1 (defer to MCP/connectors).
   - **Specificity is assessed in the prompt**: *precise* (an actionable ticket defining this change), *broad* (epic/parent/support — too general), or *none*.
   - *Precise* → three factual buckets: **accomplished**, **stated-but-missing**, **done-but-unstated**. *Broad/none* → "intent check unavailable (ticket scope too broad / not available)" — never a guessed gap.
   - **De-emphasized**: the Change-groups carry the story; the intent check is the AI's fallible read, framed as such, never a verdict or focal point.
3. **Soft gate** at the ready-for-review handoff:
   - Surfaces **unaddressed Risk Surface flags** (primary, factual) and — **only when the intent source is precise** — stated-but-missing intent gaps (secondary). The fallible signal never drives the nudge.
   - **Non-blocking**; the author fixes or authorizes. **No persistent author state** — it's a transient summary, not recorded or shared (the reviewer independently sees the same flags).
4. **Pre-submission lifecycle.** During draft, each settled head SHA can get a full Brief, generated **lazily when the author opens self-review** (cost discipline). **No deltas pre-first-review** — a Delta needs a reviewer Checkpoint, which doesn't exist yet. Intermediate draft briefs are transient (GC-able per 0008). At the **handoff**, the head-SHA Brief is eagerly pre-warmed; **reviewers start their first review from that handoff-head full Brief** (no delta on a first review).
5. **No author self-delta in v1.** The author re-opening their draft sees the latest full Brief, not "what changed since I last self-reviewed" (that would need an author checkpoint — out of scope; the reload value is a reviewer problem).
6. **Draft-first not required.** Author-side works on any draft (the author can open the web app and self-review manually); draft-first is the opt-in that automates pre-warm and the author→reviewer sequencing.
7. **Post-review author flow deferred to v2** (understanding reviewer comments, agent-assisted replies). For now: GitHub's native comments.

## Why This Way

Reusing the one Brief keeps the dual-consumer model honest and the cost flat — the author's self-review *is* the reviewer's warm artifact. Declaring the intent check unavailable on broad tickets (rather than guessing-then-asking) collapses the author side to zero persistent state, which is the simplest thing that delivers the value. Demoting the intent check and keeping it off the soft gate's trigger path puts the tool's least-reliable output where it can't anchor or nag, while the diff-grounded Change-groups and Risk Surface remain primary. Lazy draft generation pays for the author's self-review only when they actually use it, defusing the draft-first cost gate.

## Consequences

- **Amends `initial-scope.md`** — author is no longer "v2 / reviewer-only"; it is a secondary v1 surface. `CONTEXT.md` updated (Intent check, Soft gate; the user-ambiguity resolution).
- **Brief generation gains a ticket-gated Intent-check section** and an intent-source specificity judgment — a small prompt/schema addition to the categorizer, reusing the linked-context fetch already built.
- **No author identity/disposition/receipt tables** are needed for v1 — the author side adds no persistent state, only read access + a transient nudge.
- **FE** gains an author self-review surface (same web app), with the intent check rendered quietly and the soft gate at the ready-for-review action.
- Sits alongside the reviewer delta subsystem (0006–0008); shares its Brief, generation, and retention model.
