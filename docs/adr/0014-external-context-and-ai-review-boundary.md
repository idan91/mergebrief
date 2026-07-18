# External Context and the AI-Review Boundary

> **Amended 2026-07-18 ([ADR 0033](./0033-contextsource-contract-providers-parked.md)).**
> The `ContextSource` seam in #5 now has a **locked contract** (query tiers, cited
> snippets, fail-open fan-out, provider registry) — but **all providers are parked to
> v2**: the local/git provider killed by its gating spike, context managers (BRIEF-61)
> deferred by scope. #5's escalation-tier sequencing is superseded: when enrichment
> ships, it runs on **every brief when providers are configured** (one capped fan-out
> per generation), not per-change-group escalation. Decisions 1–4 stand unchanged.

The tool does **not** consume an AI context manager (e.g. Unblocked) to hypothesize cross-context "issues" — that is the bug-bot the product is positioned against. External knowledge flows in exactly two narrow, honest ways, and AI *review* flows out a third: (1) external context may **enrich the Intent check and Risk Surface with cited facts only** (cite-or-stay-silent, never a verdict); (2) an org that wants AI review **hooks its own agent to consume our Brief** via the headless lane — that agent owns its verdicts, not us; (3) the **comment-to-rule loop** is the inverse arrow, where we *produce* repo-local agent context. Only (1) is a consume-side build, and it is deferred.

## Context

A proposal: hook context managers like Unblocked so the brief can "show whether a change has a potential technical / product / wider logic issue that can't be understood from the PR alone," for the whole brief and per change-group. Grilling surfaced a hard collision with load-bearing decisions:

- **Risk Surface is "attributes only — never verdicts"** (`CONTEXT.md`); severity emerges from combinations.
- **`center-of-gravity.md`** sells the quality layer as "risk-surface flags route attention … **no verdicts, no bug-bot noise**."
- **ADR 0003** scoped bug-hunting to *category-scoped, not general*; the discovery interviews (`synthesis.md`) named general bug-catch as the **anti-signal** ("CodeRabbit mostly noise… never catches actual business logic flaws").

A free-form "AI thinks this might be a problem, given the docs" detector *is* that bug-bot — and it puts the hallucination risk and the verdict on us. The reframe ("don't hook it to flag issues; let an org hook its own agent to review using the brief") resolves the collision and lands on the **dual-consumer / headless lane already in `CONTEXT.md`** (Analysis Layer "consumed by AI-agent reviewers via API, v1.5+ headless").

## Decision

1. **No consume-to-hypothesize-issues.** We do not build, and do not integrate a context manager for, AI-asserted cross-context issue detection. Verdict-shaped output is out of scope for the brief.
2. **Consume → enrich, cited only.** External context (docs, tickets, a context manager) may enrich:
   - the **Intent check** — widening its *sources* beyond the PR description / linked ticket (it is already fallible, shown to author + reviewer, never a verdict); and
   - the **Risk Surface** — externally-*evidenced* factual attributes (e.g. `cross-service`, `widely-imported`, `schema-adjacent`) justified by a dependency graph or arch docs rather than diff heuristics.
   **Cite-or-stay-silent:** if the model can't point to the external source grounding a claim, it doesn't make the claim (mirrors "outdated is read from GitHub, not recomputed"). A genuine unprovable suspicion may only appear as an **Uncertain Flag with its source cited** — never an asserted verdict. Fetched context is untrusted reference data (fenced, never instructions; same discipline as `fetchLinkedContext` and ADR 0011 comment fencing).
3. **Expose → headless AI review.** AI review of the *code* is the **dual-consumer / headless lane**: the org points its own agent (Unblocked or otherwise) at our **Brief** via API; the agent reviews and **owns its verdicts**. The no-verdict / no-AI-prose rules are preserved because we are the analysis substrate, not the reviewer (these rules are human-mode only and do not apply to agent-mode — `CONTEXT.md`).
4. **Produce remains the inverse arrow.** The **comment-to-rule loop** (we emit repo-local agent-context markdown from accepted, role-gated review comments) is unchanged and distinct — "we feed agents the rules they author with," complementing "we feed agents the brief they review with."
5. **Mechanism + sequencing.** When (2) is built, external sources sit behind a thin **`ContextSource` seam** (today's linked-context fetch is the first impl; MCP servers / context managers are later adapters — `github.ts` already anticipates this). Enrichment is **escalation-tier** (ADR 0010), per change-group plus a whole-PR roll-up, not run on every trivial PR. All of (2) is **deferred** (post core-validation); (3) is the **v1.5+ headless** lane.

## Why This Way

The reframe converts a positioning violation into reuse: instead of becoming the bug-bot, we let external context do only what it can do *honestly* (supply cited facts to surfaces that are already fallible and non-verdict), and we route the actual "review the code" job to the consumer who is allowed to hold an opinion — the org's own agent. That keeps our central honesty invariant (no verdicts, no anchoring) intact while still delivering the value the proposal wanted, and it spends no new build before the core brief is validated.

## Consequences

- **Explicit no-** recorded so the next person doesn't re-propose "just have it flag issues via Unblocked." `CONTEXT.md` "Flagged ambiguities" carries the resolution.
- **Intent check / Risk Surface** gain (later) a cited, externally-sourced provenance on individual items; the cite-or-silent rule becomes a prompt + validation constraint.
- **`ContextSource` seam** mirrors the `Generator` port of ADR 0013 — one interface, adapters per source, deferred.
- Reaffirms ADR 0003 (category-scoped, not general bug-hunt) and the Analysis/Engagement dual-consumer split; depends on ADR 0010 for escalation gating.
- The comment-to-rule loop (v2+) and the headless lane (v1.5+) are tracked elsewhere; this ADR fixes the *boundary* between them and the rejected middle.
