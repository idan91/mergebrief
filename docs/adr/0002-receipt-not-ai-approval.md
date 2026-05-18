# Tool Issues a Receipt, Not an AI Approval

The final review submitted to GitHub carries the reviewer's human approval plus a scoped tool-verification receipt — never an "AI approval" or "double approval" stamp. The receipt reports what the tool mechanically verified, what it did not check, and the disposition of every flag (addressed vs dismissed-with-reason).

## Considered Options

- **AI as gate / veto** — AI must approve before reviewer can submit. Rejected: kills the "human authority" wedge and reproduces the CodeRabbit power dynamic the product is positioned against.
- **"Double approval" stamp** — "AI + human both approved" presented together. Rejected: the combined signal reads to the *author* as a stronger gold star, deepening comprehension debt downstream. Solves rubber-stamping on the reviewer side while creating a new rubber-stamp loop on the author side. Recursive.
- **AI rates the reviewer's review** (comprehensive / shallow). Rejected: AI judging human depth is brittle and patronizing.
- **Scoped tool-verification receipt** (chosen). The tool signs only what it mechanically verified — playbook items completed, pure-move byte integrity, lib-bump call-site coverage, risk-surface flag dispositions — and is explicit about what it did *not* check (business intent, perf, integration with other services).

## Why This Way

A "tool approved" framing collapses two different kinds of judgment (mechanical verification vs human reasoning about intent) into a single signal. That collapse is exactly what enables downstream rubber-stamping: future readers (authors, managers, auditors) see one stamp and treat it as one decision. The scoped receipt refuses that collapse — it tells the truth about which claims the tool can stand behind and which it cannot, so the human's name still carries the judgment weight.

This also sidesteps accountability ambiguity: if "AI approved" carries weight and a bug ships, responsibility is unclear. If the receipt is scoped to checkable claims, the reviewer remains the accountable party and the receipt is auditable evidence — far more valuable to the eng-manager / org persona than a vibe stamp.

## Consequences

- The receipt format must be clearly distinguishable from a human approval — same visual frame as approval is forbidden.
- "Not checked" items must be visible by default on the receipt, not hidden. Hiding them would re-introduce the false-certainty problem.
- Marketing / positioning must avoid the word "approval" anywhere near the tool's output — the language is intentional.
- Some customers will ask for an "AI approval" or "double approval" feature explicitly. The position is: explain the recursive rubber-stamp risk, hold the line. If the customer pull is overwhelming, revisit — but the default answer is no.
