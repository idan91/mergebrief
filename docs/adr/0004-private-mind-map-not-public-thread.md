# Private Mind-Map Space, Not a Public PR Thread

> **Amended 2026-08-17 (BRIEF-197 → [ADR 0040](./0040-review-session-server-store.md)):**
> the term **Mind-Map Space is retired**; this private workspace is a **Review
> Session** — one reviewer's work on one PR, pinned to one **Session baseline**
> (now the durable key of that session, not a transient label). The durable
> per-(PR × reviewer) home this record demanded is a server-side row keyed
> `(installation, brief, reviewer)`, not browser storage. Everything else here
> stands unchanged: the discussion stays private, only finalized comments and
> the Receipt ship to GitHub.

Agent ↔ reviewer discussion — pushback, corrections, dismissals, draft thinking — happens entirely inside the tool's web app, scoped to a private (PR × reviewer) workspace. Only finalized human comments and the scoped tool verification receipt ship to the GitHub PR thread. Selective "promote to PR thread" affordance is deferred to v1.5+.

## Considered Options

- **Public — on the PR thread.** Agent challenges, reviewer corrections, dismissal debates all visible to the author and the rest of the team in real time. Rejected: confuses authority (who's authoritative when agent and reviewer disagree visibly?), makes the reviewer perform competence in front of an audience, slows the author by forcing them to read a long agent-reviewer back-and-forth, and erodes the "human is the authority" external framing.
- **Hybrid — private by default, reviewer can promote individual exchanges to the PR thread.** The correct end-state. Best of both worlds, but adds non-trivial UX for v1. Deferred.
- **Private mind-map space** (chosen). The conversation never leaves the tool. Outcomes only — final comments + receipt — land on the PR.

## Why This Way

The product metaphor is a reviewer's *thinking space*. Thinking is not done in public. A reviewer who must perform every half-formed question, every reconsidered dismissal, and every retracted hypothesis in front of the author is a reviewer who reverts to surface engagement — exactly the rubber-stamp behavior the product exists to fix.

Keeping discussion private also preserves clean external semantics: the author sees a clean PR thread with human comments and an auditable receipt, not a noisy debate. The receipt's audit trail (every flag, addressed or dismissed-with-reason) gives the author and org all the visibility they actually need, without dragging them through the reasoning that produced it.

The edge case worth naming: a reviewer dismisses a flag that *did* contain a real concern, and the agent's challenge died inside the private space. The mitigation is the receipt — every dismissal ships with reason verbatim, so the author can challenge it. Author retains agency without seeing the raw debate.

## Consequences

- The mind-map space must persist reliably per (PR × reviewer) — draft comments, agent chat history, per-chunk read state, per-flag intent. Loss of this state is loss of trust.
- The receipt becomes the *only* externally visible artifact of agent-reviewer interaction. It must be honest about dismissals, missed playbook items, and "not checked" gaps — otherwise the privacy guarantee turns into opacity.
- Multi-reviewer hybrid (ADR 0004 + Multi-Reviewer model): brief is shared, mind-map is private per reviewer, receipt aggregates. Reviewers do not see each other's private thinking — by design.
- Selective promote (v1.5+) introduces UX cost: which exchange? what gets quoted? attribution to agent vs reviewer? Worth solving once the core surface is validated.
