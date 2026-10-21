
# AI-Era Code Review — Problem Framing

> PMF-test framing. Scope: strictly PR/code review. Personas: PR author (incl. self-review), human reviewer, tech lead/staff eng, eng manager/org.

## Problem Statement
Code review — the last human checkpoint before merge — is collapsing under the volume, velocity, and opacity of AI-authored code. Reviewers (and authors reviewing themselves) cannot meaningfully engage with the diff stream, so they rubber-stamp; existing AI CR tools catch some bugs but reinforce the rubber-stamp loop instead of restoring human comprehension.

## Context & Background
- AI adoption among devs: **84–90%** (Stack Overflow 2025, DORA 2025).
- **Only 29%** trust AI output; **46% actively distrust** it (Stack Overflow 2025). Experienced engineers distrust most.
- AI generates code **5–7× faster** than humans can read/understand it (5 independent studies converged Feb 2026, per Addy Osmani / O'Reilly).
- AI-assisted PRs contain **~1.7× more issues** than human PRs (CodeRabbit 2025 report; 10.83 vs 6.45 findings/PR).
- GitClear: code churn 5.5% (2020) → **7.9%** (2024); duplicated lines 8.3% → **12.3%**; refactor lines 24.1% → **9.5%**.
- DORA: **7.2% drop in delivery stability** per 25% AI adoption increase.
- "**Comprehension debt**" (Osmani, 2026) now framed as a distinct debt class — engineers merge code they cannot explain.

## Current State
- Workflow norm: author prompts AI → AI writes code → AI CR tool comments → author skims AI summary → reviewer skims AI summary → LGTM → merge.
- SonarSource: **only 48%** of devs consistently check AI-assisted code before committing.
- GitHub data: most AI-generated PRs receive **no human review** or only-AI review.
- AI CR tools (CodeRabbit, Greptile, Graphite Diamond, Qodo, Bugbot, Copilot Review, Claude Code Review) compete on bug-catch rate, not on restoring human engagement. Greptile catches 82% but noisy; CodeRabbit catches 44% with less noise. The "tool" lens is post-submission, reviewer-side.
- Greptile itself flags "**there is an AI Code Review bubble**" — saturation in the reviewer-side comment-bot lane.

## Desired State
Hybrid loop where:
- **Pre-review (author side):** AI translates the diff into intent, business-logic shape, risk surface — so the author and reviewer start with shared comprehension, not raw diff.
- **Human review:** humans engage on architecture, intent, business correctness — the parts they uniquely can judge.
- **Post-initial review (machine side):** AI sweeps for hard-to-spot regressions, security, dead paths, hallucinated APIs — augmenting, not replacing, the human pass.
- Outcome: review time stays sane while comprehension and defect-catch both rise. Atlassian-style "saved hours but workload unchanged" gap closes.

## Scope (IS / IS NOT)

| Dim | IS | IS NOT |
|---|---|---|
| Surface | PR / merge-request review before merge | Pair programming, in-editor suggestions, CI/lint |
| Stage | Pre-merge review loop end-to-end | Production observability, post-incident review |
| Code source | Human, AI-assisted, AI-agent-authored | Infra-as-code reviews (out for v1), data/SQL review |
| Actors | PR author (incl. self-review), human reviewer, tech lead, eng manager | Security/compliance gatekeepers (adjacent) |

## Root Cause Analysis
- Symptom: rubber-stamp merges, missed bugs, growing review queue.
  - Why? Reviewers skim instead of read.
    - Why? Diff volume × cognitive load × low perceived signal per comment.
      - Why? AI-authored code looks confident and tidy (signals humans evolved to trust) regardless of correctness; AI CR tools add more comments but not more *understanding*.
        - **Root cause: the unit of review (the diff) and the work of review (reading code) were designed for a world where the author thought hard and could defend every line. AI-authored code violates that contract — neither author nor reviewer has internalized the change — so the review ritual continues with no actual cognition behind it.**

## Stakeholders
- **PR author (incl. self-reviewing AI-assisted author):** wants to ship without owning what they don't understand. Highest friction, lowest current support.
- **Human reviewer:** wants signal not noise; pays the comprehension tax. Burned out.
- **Tech lead / staff eng:** accountable for arch drift and quality regression; sees comprehension debt accumulating.
- **Eng manager / org:** watches DORA metrics, defect escape rate, review SLAs. Wants velocity *and* stability — currently trading one for the other.

## Constraints & Assumptions

**Constraints (verified):**
- Existing AI CR market is crowded post-submission (CodeRabbit 2M repos, Copilot 60M reviews, plus Greptile/Diamond/Qodo/Bugbot/Claude). Differentiation can't be "another reviewer bot."
- Humans must stay in loop (regulated industries, accountability, trust gap).
- Tooling must integrate with GitHub/GitLab/Bitbucket PR surface — devs won't leave it.

**Assumptions (need validation):**
- That **pre-review / author-side comprehension** is real white space, not just under-marketed. (Copilot for PRs, Graphite, Qodo do some summarization — need to test depth gap.)
- That eng managers will pay per-seat at $20–40/dev/month for a comprehension layer, not just bug-catch.
- That the bottleneck is comprehension, not bug-catch — if a perfect bug-catcher existed, would orgs still want humans? Studies suggest yes (trust + accountability), but worth probing.
- That fatigue is mostly volume-driven and AI-shaped, not org/process-driven (PR size norms, review ownership rules).

## Impact & Sizing
- TAM proxy: ~30M+ devs, ~84% AI-adopting → ~25M devs in scope. CodeRabbit alone monetizes ~2M repos at $24/dev.
- Pain frequency: review happens on near every merge; AI-authored share rising.
- Trend direction: **all metrics worsening** — churn up, duplication up, defects up, stability down, trust down. This is an accelerating pain, not a stable one.
- Cost of inaction (signal): one Fortune 50 saw **10× rise in monthly security findings** Dec 2024 → Jun 2025; review didn't catch it.

## Alternative Framings (HMW)
1. **Narrow:** HMW reduce rubber-stamping on AI-authored PRs?
2. **Medium:** HMW restore human comprehension before merge without slowing throughput?
3. **Broad:** HMW redesign the unit of review so it survives AI-scale authorship? (Maybe diff isn't the unit anymore — intent + risk delta is.)
4. **Lateral (author-side):** HMW make the AI-using author own their diff again — explain it, defend it, sign it — before a reviewer even sees it?
5. **Lateral (org):** HMW make code review a learning loop again instead of a gating ceremony?

Frames 3 and 4 likely point at the freshest white space.

## Open Questions
1. Where in the loop does the rubber-stamp actually happen — at "open PR," at "AI summary," at "first comment," at merge? (Determines product surface.)
2. Are existing PR-summary features (Copilot, Qodo, Diamond) failing because they're shallow, or because authors/reviewers ignore them anyway? Behavioral problem vs depth problem.
3. Does pre-review comprehension scaffolding actually move human engagement, or just add another thing to skim?
4. Who pays — IC reviewer (won't), eng manager (might), CISO/compliance (likely)?
5. Is the right wedge a *new product* or a *layer* inside CodeRabbit/Graphite/GitHub PR UI?
6. Self-review (author) and other-review (reviewer) — same product or two?

## Solutions Noted (surfaced, not pursued)
- Author-side pre-review brief: AI explains intent, risk surface, untested paths, defends or flags AI-generated sections — author signs off before requesting review.
- Diff-shaping: AI splits big AI-authored PRs into reviewable units with narrative.
- Two-pass: AI summary + risk map for human pass, then post-human deep sweep for bugs.
- "Comprehension proof": author must answer AI-generated questions about their own diff before merge (controversial).
- Review as conversation: AI mediates between reviewer questions and author/codebase, reducing back-and-forth tax.

## Recommended Next Steps (for PMF test)
1. **First and most important:** 8–12 problem-discovery interviews — split across PR author, reviewer, tech lead, eng manager. Anchor on the rubber-stamp *moment*: "walk me through the last AI-authored PR you merged — where did you stop reading?" Goal: validate that the *comprehension* gap (not the bug-catch gap) is the live pain.
2. Run a survey (≥100 devs) measuring: % of AI-authored PRs they (a) understood fully before approving, (b) approved with reservation, (c) approved without engaging. Use to size rubber-stamp rate quantitatively.
3. Audit 3–5 existing tools (CodeRabbit, Graphite Diamond, Qodo, Copilot PR review, Claude Code Review) on the *author-side / pre-review / comprehension* axis specifically — score depth, friction, adoption. Map the gap.
4. Sketch a wedge experiment: smallest possible "pre-review comprehension brief" that an author runs on their own diff before requesting review. Test if (a) authors run it voluntarily, (b) reviewers report changed behavior.
5. Pricing/ICP probe: which persona felt the pain enough to pull out a card — eng manager (org seat), tech lead (team seat), or IC (self-serve)? Pricing follows.
6. Decide v1 framing: build a *new product* (own surface), a *layer* inside an existing PR tool, or an *IDE-side* author-prep tool. Each implies different distribution and moat.

## Sources
- [DORA 2025 — State of AI-Assisted Software Development](https://dora.dev/dora-report-2025/)
- [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/)
- [Stack Overflow blog — Closing the AI trust gap](https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/)
- [GitClear — AI Copilot Code Quality 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [CodeRabbit — AI vs Human code generation report](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [The Register — AI-authored code needs more attention](https://www.theregister.com/2025/12/17/ai_code_bugs/)
- [Addy Osmani — Comprehension Debt](https://addyosmani.com/blog/comprehension-debt/)
- [O'Reilly Radar — Comprehension Debt](https://www.oreilly.com/radar/comprehension-debt-the-hidden-cost-of-ai-generated-code/)
- [Greptile — There Is an AI Code Review Bubble](https://www.greptile.com/blog/ai-code-review-bubble)
- [Greptile — AI Code Review Benchmarks 2025](https://www.greptile.com/benchmarks)
- [DevToolsAcademy — State of AI Code Review Tools 2025](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/)
- [GitHub Blog — Agent pull requests are everywhere](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/)
- [DEV — AI Is Quietly Destroying Code Review](https://dev.to/harsh2644/ai-is-quietly-destroying-code-review-and-nobody-is-stopping-it-309p)
- [arXiv — How Humans Review AI-Generated Pull Requests](https://arxiv.org/html/2605.02273v1)

## Pain Dimensions Discovered Post-Framing (2026-05-20)

Surfaced during qualitative validation with EM + engineer friends across multiple companies. Extends the original framing.

The original framing emphasized **short-term symptoms**: rubber-stamp merges, reviewer fatigue, comprehension debt at merge time. The post-framing conversation surfaced a second, related dimension that is potentially *more existential* for engineering organizations:

- **Skill atrophy from AI over-reliance.** Engineers who increasingly accept AI-generated code without engaging with it are gradually losing their own technical and domain instincts. Not just "the bug merged" — the human's ability to *catch the bug next time* is eroding. This is a slow-burn organizational pain: domain expertise distributing across the team becomes thinner, harder to maintain, and harder to recover.

Implication for product positioning: the wedge is not only "fewer bugs ship today" — it is also "engineers stay sharp tomorrow." The intent-categorization + playbooks layer is, in effect, **a forcing function for human engagement** with the codebase, not just a quality gate. That framing may resonate with eng managers + staff engineers more than the short-term rubber-stamp framing alone.

Sample is qualitative N=few from peer network — directional, not conclusive. Broader interviews (`docs/internal/next-steps.md` Phase #1) should test whether other engineers spontaneously describe this dimension.

## Project Intent (2026-06-09)

This doc is written in PMF-test language (TAM sizing, pricing probes). Correcting the record on actual intent so future sessions don't over-rotate on business validation:

- **Primary goal: build something genuinely useful** for a real pain Idan and peers experience. Commercial success is upside, not the bar.
- **Business case is tracked seriously but secondarily** — it informs scope discipline (don't build what nobody wants) rather than gating decisions on revenue potential.
- **Practical consequences:** kill criteria emphasize "do I and people I know reach for it weekly", not "will strangers pay". WTP/pricing probes are optional, deferred until organic pull appears. ICP/pricing open questions stay parked without blocking anything.
- TAM/pricing sections above remain valid as context; read them as "if this works, here's the upside", not as targets.

## See Also
- [[PM Tools Pain - Problem Framing]]
