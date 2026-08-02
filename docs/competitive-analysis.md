# Competitive Analysis — AI Code Review

Snapshot: **2026-06-18.** Supersedes the preliminary scan in `docs/next-steps.md` (2026-05-19) and the Linear updates there. Funding/valuation/sentiment move fast — re-verify before any external use.

> **Reading frame.** Our wedge is deliberately *not* bug-catching (see `CONTEXT.md`, ADR 0003/0014): no-verdict, risk-surface *attributes*, human-authored comments, comprehension + the delta brief, receipt-not-approval. Almost the entire funded field below is in the **bug-catching / verdict-emitting** lane. So "features to take" are filtered hard through our positioning — some of what these tools do is exactly what we are positioned *against*.

## 1. Market context (the "cap")

- **Market size.** "AI code tools" ≈ **$9.35B in 2026**, ~**24–27% CAGR**, → **~$26–30B by 2031**. Code review is a *slice* of that, not the whole.
- **The driver everyone cites:** AI authorship → PR-volume explosion → **review is the new bottleneck**. Identical thesis to ours; they answer it with "catch the AI's bugs," we answer with "help the human comprehend."
- **Consolidation is underway:**
  - **Cursor/Anysphere acquired Graphite** (Dec 2025, > $290M) — code creation + review folding into one platform.
  - **GitHub Copilot code review** now leads *organizational* adoption (a 40M-PR analysis claims it "crushed" the startups); bundled + free + native.
  - **Korbit shut down** in 2025 despite traction — a purpose-built reviewer that couldn't outrun the platforms.
- **Read:** the bug-catching lane is being won by **platforms with distribution we can't match**. This *reinforces* our different-lane + self-host/OSS-BYOK strategy rather than refuting it.

## 2. The field

### Tier 1 — funded pure-play AI reviewers (bug-catching lane)

| Tool | Funding / valuation | Positioning | Favorability |
|---|---|---|---|
| **CodeRabbit** | $88M raised; **$550M** val (Series B, Sep 2025); ~$40M ARR; 8k+ customers; top GitHub-Marketplace AI app | **Breadth / workflow leader.** Summaries, walkthroughs, inline comments, linters; all 4 hosts; $24/dev. **2026-08: "Change Stack" standalone review UI — see addendum below; now pitching comprehension** | **High but cracking** — "invaluable", low-noise praised; **poor support + security/data-handling complaints** |
| **Greptile** | $29M raised; **$180M** val (Series A, Benchmark, Sep 2025) | **Depth leader** — full-codebase graph context. 82% bug-catch (vs CodeRabbit 44%)… | **Mixed** — praised for catching hidden cross-file issues; **noisy (11 false-positives/run)**, single-repo |
| **Qodo** (ex-CodiumAI) | **$120M** raised ($70M Series B) | **Governance / policy-first**, test-generation tie-in; Gartner Visionary; enterprise (Walmart, NVIDIA, Ford) | **Solid in enterprise**; less loved by individual devs; heavier |
| **Graphite** (was *Diamond*) | $81M raised; ~$290M val → **acquired by Cursor/Anysphere** Dec 2025 | **Stacked PRs + review**; "Diamond" deprecated Oct 2025 into Graphite Agent | **High** — **< 5% of comments get negative feedback** (low-noise benchmark); Shopify/Snowflake/Figma |

### Tier 2 — platform incumbents (the real strategic threat)

| Tool | Position | Why it matters |
|---|---|---|
| **GitHub Copilot code review** | Bundled free in Business/Enterprise; **agentic review** (Mar 2026) + autonomous fix-PRs | Owns org adoption. The "good-enough + free + native" gravity well. **Un-out-bundleable.** |
| **Cursor BugBot** | IDE-native; **2M+ PRs/mo, 80% resolution**; "**real bugs, not style/formatting**" | Disciplined low-noise; + now owns Graphite → end-to-end create→review |
| **Linear Diffs** (May 2026) | Review **inside Linear**, alongside product context; **guided reviews** (separates glue/secondary from core); agents + **MCP server** | Converging on our **grouping substrate** (carrier/supporting) → that substrate is now **table stakes**, not a differentiator |

### Tier 3 — quality / static-analysis hybrids

- **DeepSource** — code-quality platform + AI; **< 5% false-positive rate**, consistently praised. Tuning rigor.
- **SonarSource/Sonar** — **3.2% FP across 137M issues** (2025); the gold standard for FP-tuning discipline.
- **Sourcery** — Python-specialized; **real-time IDE refactoring** (pre-PR).
- **Bito** — context-aware review agent, security-leaning.

### Tier 4 — small / at-risk / OSS

- **Entelligence** — $5M (Mayfield); eng-leadership analytics + review; small.
- **PR-Agent** (Qodo, **open-source, self-hostable**) — the closest to our *distribution* posture (full data isolation). Stateless.
- **Korbit** — shut down 2025. **Ellipsis**, Panto, CodeAnt, Baz — minor / early.

### Addendum (2026-07-14) — Unblocked risk policies

**Unblocked** (getunblocked.com) added **risk assessment** to its Code Review Agent
([docs](https://docs.getunblocked.com/code-review/risk-assessment)): user-defined policies in
`.unblocked/risk-policies.yaml` (name + tier + **natural-language criteria**, ≤4k chars,
evaluated by the model), five tiers, highest-match wins per PR — and **auto-approves at
`low`/`lowest`**. Their pitch line is our thesis verbatim ("reviews are the bottleneck, not
the code"); their conclusion is the opposite of ours — they *gate approval*, we *allocate
attention*.

- **Take:** repo-local user-defined policy file (→ custom risk-surface attributes layered on
  our built-in library; board ticket filed 2026-07-14); natural-language criteria evaluated by
  the model; the **default-branch trust rule** ("uses the policy from the default branch, not
  policy changes proposed in the PR") as a standing invariant for any repo-local config we honor.
- **Reject (positioning):** PR-level risk score (severity label — non-gap), auto-approve
  (anti-thesis of receipt-not-approval, ADR 0002), highest-wins verdict aggregation. Their
  tier examples (`auth-highest`, `DB-high`, `deps-medium`) are facts we already surface as
  attributes (`touches-auth`, `mutates-state`, …) without the verdict.
- **Watch:** include Unblocked in the quarterly re-scan going forward.

### Addendum (2026-08-02) — CodeRabbit "Change Stack"

CodeRabbit shipped **Change Stack** (`app.coderabbit.ai/change-stack/...`), a standalone
review web app (seen via sponsored Theo segment, ~41s; UI + transcript analyzed frame by
frame). Pitch line: *"It's time to understand your code again."* **They are now marketing
comprehension, not bug-catching** — direct convergence on our lane, from the
best-distributed pure-play. What it shows:

- **Layers**: PR decomposed into numbered cross-file semantic layers, each with
  title/summary/file+comment counts; per-layer diff view. (= our change-groups; grouping
  substrate now fully commodity, confirming the Linear Diffs read.)
- **Per-layer delta header**: "1 file changed since `<sha>`" — incremental review vs a
  since-marker. (= our checkpoint/delta core.)
- **Overview**: mergeability state, "Merge blockers needing your attention" vs
  "Doesn't block merge, but may warrant attention" — an editorial blocking/non-blocking
  split.
- **Review filter bar**: state chips with counts (Approve/Comment/Request changes),
  human-vs-**Bots** split, per-reviewer chips (they list cursor/greptile/vercel/etc. bots
  as peer reviewers), recency toggle "only most recent from each reviewer".
- **Diff niceties**: inline blame per hunk (author+date), symbol-level hunk labels
  ("constant `MessageNavigationItemValidator` added · 278-283"), per-file complexity
  meter (score only, **no recommendation**), Files/**Diagrams** tabs, mark-viewed,
  activity feed with deploy events, review-history "Stale" marker, ⌘K.

**Take** (prioritized 2026-08-02):
1. **Reviewer filter bar w/ counts + "most recent per reviewer"** — pure FE on the
   existing conversation digest; our bot grouping already exists, add per-reviewer chips.
2. **Mergeability/blocker aggregation** — `reviewDecision` + `statusCheckRollup` +
   `mergeStateStatus` via GraphQL; deterministic, zero LLM tokens. Their
   blocking/"warrant attention" split is attention-allocation phrased our way — adopt the
   frame, not a verdict.
3. **Symbol-level hunk labels** — deterministic-first (git hunk function context /
   light AST), LLM only as opt-in fallback; compounds the Story view.
4. **Explicit per-group since-marker** ("changed since `<sha>`") — we have the delta
   substrate; surface it in group headers.

**Reject / reframe (positioning):**
- **Naked complexity score** — a severity label, non-gap (same reasoning as Unblocked's
  risk score). *Reframe:* a **review-depth recommendation** per group ("deep read /
  standard / skim") derived deterministically from existing blast-radius attributes +
  LOC — allocation-of-attention, not a verdict, and a surface they don't have (score
  without recommendation).
- ⌘K palette (our J/K reading flow is deliberate), diagrams tab (cost/taste), deploy
  events in feed (webhook scope creep).

**Watch:** whether Change Stack gets a delta brief / re-review mental-model reload —
that's the last piece of our wedge they haven't copied. Include in quarterly re-scan.

## 3. Favorability synthesis — the universal pain *is* our wedge

The single most-repeated complaint across **every** tier: **false positives / noise.** Best-tuned tools sit at 5–15% FP; untuned LLM reviewers 40–80%. The failure mode is named explicitly in the literature: *"flags 100 issues, 70 wrong → devs hit dismiss reflexively → the tool becomes noise nobody reads."*

That validates the product's core bets:
- **No-verdict + risk-surface attributes + `Uncertain` + human-in-loop** = the anti-noise stance, structurally.
- **Comprehension + delta brief** competes on an axis (re-review mental-model reload) the noise-makers don't touch.

But the **honest counter-risk** stands (unchanged from "Moat Honesty"): the market's *loud* signal is "catch more bugs." We sell a mental model the market isn't explicitly asking for. The noise pain is real leverage *only if* we convert it into "that's why no-verdict comprehension is better," not into "so we'll catch bugs more quietly" (which loses to bundled platforms).

## 4. Features to take — filtered through our wedge

**Take (additive to the Analysis/Engagement layers, no positioning drift):**
1. **Full-codebase / graph context** (Greptile) — feeds better change-group understanding + blast-radius risk-surface (`widely-imported`, `cross-service`). Analysis-layer upgrade.
2. **FP-suppression rigor + "real bugs, not style"** (Graphite < 5%, Cursor BugBot, DeepSource, Sonar 3.2%) — directly operationalizes our `Uncertain` threshold + no-noise discipline for Flags.
3. **PR walkthrough / summary UX** (CodeRabbit) — parity check against our change-group Summary + Story view.
4. **Guided reviews / glue-vs-core separation** (Linear) — = our carrier/supporting + concern split; now table stakes, ensure we match cleanly.
5. **MCP / agent-native integration** (Linear, Copilot) — our headless dual-consumer lane (ADR 0014): an MCP server exposing the Analysis Layer.
6. **Benchmark-driven marketing** (Greptile) — publish our own *comprehension/re-review* benchmark (the Phase-1 B′ test) rather than a bug-catch number.
7. **IDE / pre-PR presence** (Sourcery, Cursor) — aligns with the author-side soft-gate (ADR 0009): comprehension *before* request-for-review.
8. **Governance / receipt-as-audit-trail** (Qodo) — enterprise/hosted framing for the Receipt later.
9. **GitHub Marketplace distribution** (CodeRabbit) — discovery channel for the eventual hosted arm (M1 is self-host).

**Deliberately do NOT take (these are what we're positioned against):**
- Auto-verdicts / "approve-reject" gates, AI-authored review prose, severity-graded bug assertions, "catch the most bugs" as the headline metric. Taking these collapses us into the noisy bug-bot lane we can't win and don't want.

## 5. Strategic implications

- **Don't compete on bug-catching.** The lane is funded, consolidating, and platform-owned (Copilot/Cursor). Our defensibility is the **comprehension + delta + receipt + comment-to-rule** layer riding on the (now-commodity) grouping substrate.
- **Distribution is the actual battleground.** Incumbents win via bundling; our counter is **OSS self-host + BYOK** (ADR 0017) — "keys/code never leave you," which the bundled SaaS players structurally can't match for trust-sensitive orgs. PR-Agent is the only one near this posture, and it's stateless (no delta/state — our differentiator).
- **Linear is a complement, not a competitor** — narrative grouping vs our taxonomy; watch if they add stable taxonomy + playbooks.
- **Watch the consolidation:** if Copilot or Cursor ship a credible *comprehension/delta* surface (not just bug-catching), the window narrows. Quarterly re-check.

## Sources

- [CodeRabbit — Sacra](https://sacra.com/c/coderabbit/) · [TechCrunch ($550M)](https://techcrunch.com/2025/09/16/coderabbit-raises-60m-valuing-the-2-year-old-ai-code-review-startup-at-550m/) · [G2 reviews](https://www.g2.com/products/coderabbit/reviews?qs=pros-and-cons)
- [Greptile — Sacra](https://sacra.com/c/greptile/) · [$180M val (TFN)](https://techfundingnews.com/ai-startup-greptile-eyes-180m-valuation-to-disrupt-future-of-ai-code-review/) · [Benchmarks](https://www.greptile.com/benchmarks)
- [Qodo $70M Series B](https://www.techcompanynews.com/qodo-raises-70-million-in-series-b-funding-round/) · [Qodo — Wikipedia](https://en.wikipedia.org/wiki/Qodo)
- [Graphite $52M + Diamond](https://graphite.com/blog/series-b-diamond-launch) · [Cursor acquires Graphite — InfoWorld](https://www.infoworld.com/article/4110558/cursor-owner-anysphere-agrees-to-buy-graphite-code-review-tool.html)
- [Copilot vs startups (40M PRs)](https://dev.to/zak_mandhro/github-copilot-crushed-every-code-review-startup-40m-pr-analysis-2no6) · [Cursor BugBot 2026](https://baeseokjae.github.io/posts/cursor-bugbot-review-2026/)
- [Linear Diffs changelog](https://linear.app/changelog/2026-05-27-linear-diffs) · [Linear Diffs](https://linear.app/diffs)
- [False positives in AI review](https://graphite.com/guides/ai-code-review-false-positives) · [State of AI code review 2025](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/)
- [Entelligence — Tracxn](https://tracxn.com/d/companies/entelligence/__AFETxdthb19y5vXpAqdQnxxFpSHZAbRX3ZhcaCyjInI) · [Korbit — StartupHub](https://www.startuphub.ai/startups/korbit-ai/)
- [AI code tools market size](https://www.thebusinessresearchcompany.com/report/artificial-intelligence-ai-code-tools-global-market-report)
