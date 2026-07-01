# OSS-Only — No Hosted or Commercial Arm

The project is **open-source and self-hostable only**. There is **no hosted offering and no
commercial/SaaS arm** — not deferred-behind-validation as ADR 0017 framed it, but a settled
direction. The goal is a high-quality OSS project with good word-of-mouth and credible public
work, not a business.

This **supersedes ADR 0017 in part**: 0017's "open-core, hosted *deferred not forbidden*"
becomes "OSS-only, hosted *not pursued*". The self-host-first architecture, BYOK default, and
static-demo funnel from 0017 all stand; only the latent hosted arm is removed.

## Context

- **CodeRabbit shipped the wedge.** "CodeRabbit Review" / **Atlas** ("the first AI-native code
  review interface") reorganizes a PR into semantic **cohorts** + dependency-ordered **layers**
  with per-range AI summaries, diagrams, snapshot deltas, no prescriptive verdict, posting back
  to GitHub natively — substantially our Analysis + Engagement wedge, built by a funded team.
  Competing for the *same commercial buyers* is no longer viable.
  - <https://www.coderabbit.ai/blog/introducing-atlas-the-first-ai-native-code-review-interface>
  - <https://www.coderabbit.ai/blog/coderabbit-review-reads-a-pr-how-author-would-explain-it>
- **Founder constraints make hosting the wrong shape anyway.** Hosting means personally
  holding other orgs' source code (data-liability), unbounded LLM cost, and oncall beyond
  sustainable side-project hours; separate contractual constraints gate commercial
  publishing. A non-hosted OSS side project is the safe, sustainable form. (Details in
  private project notes — not load-bearing on the architecture.)
- **No moat, and now no reason to chase one.** `CONTEXT.md` already records taxonomy +
  playbooks as reproducible. The prior docs tried to *earn* a moat (data exhaust, org-learned
  playbooks, switching costs) for an eventual hosted business. With no business, moat-building
  is dead weight.

## Considered Options

- **Open-core with a deferred hosted arm (ADR 0017's framing).** Keep hosting latent, decide
  later. Rejected: "later" is gated by legal headroom that isn't coming, and Atlas removes the
  commercial upside that justified carrying the option. Carrying it costs design attention and
  keeps moat-thinking alive.
- **Hosted SaaS first.** Rejected outright — blocked by the founder constraints and
  out-resourced by incumbents.
- **OSS-only, no hosted arm (chosen).** Commit fully to the OSS form; spend the freed
  attention on first-run experience, the playbook commons, and the taxonomy edge.

## Decision

1. **OSS-only.** Ship and maintain the self-hostable open-source tool. Do not build, plan, or
   carry seams *specifically* for a hosted/multi-tenant commercial offering.
2. **BYOK remains the default** and self-host remains the primary mode (per ADR 0015–0017) —
   these are OSS properties, not commercial ones, and they stand.
3. **Compete on the OSS axes, not features.** Open, self-hostable, no per-seat cost, no
   telemetry, hackable; plus the **stable taxonomy + community playbook commons** Atlas lacks.
   See [`../vision.md`](../vision.md).
4. **Retire the commercial strategy corpus.** Moat-building, open-core split, headless-as-
   distribution, and the formal validation phases are archived (`docs/archive/`), not active.
5. **Don't chase the incumbent arms race** (semantic/code graph, generated diagrams, scale).

## Why This Way

With the commercial path closed by both competition and constraints, the winnable game is
*mindshare for the thesis* via a genuinely good open tool. Removing the hosted option isn't a
loss — it deletes a large surface of work (multi-tenancy density, billing, central key vaults,
moat capture, validation gating) that was never going to pay off here, and refocuses effort on
what makes an OSS project spread: a frictionless first run, a clear point of view, and a
contribution surface (the playbook commons) that compounds with community, not with captured data.

## Consequences

- The **hosted "third run mode"** in ADR 0017 is dropped. ADR 0016's tenancy/audit seams are
  no longer maintained *for a future hosted arm*; they remain only insofar as they serve
  self-host correctness.
- **Moat / data-exhaust / org-learned-playbook** plans are archived and will not drive work.
  `CONTEXT.md`'s "Analysis Layer" no longer carries moat caveats.
- **Headless API as a distribution/business lever** is dropped. (A clean internal API for the
  static demo and self-host is still fine as engineering — it's just not a go-to-market play.)
- **The formal PMF validation track** (Phases 1–3, reviewer recruiting, kill-on-signal) is
  archived. We build because the tool is useful to peers, not gated on an experiment.
- **No telemetry** is now a hard product property, not just a privacy nicety.
- Prioritized work shifts to: front-door polish, narrative-on-top-of-taxonomy, the playbook
  commons, then self-host backend — see [`../oss-roadmap.md`](../oss-roadmap.md).
- ADR 0017 gets a "superseded in part by 0023" banner; its self-host substance stays valid.
