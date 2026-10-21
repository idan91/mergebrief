# Competitive Analysis — AI Code Review

Snapshot: **2026-06-18.** Supersedes the preliminary scan in `docs/internal/next-steps.md` (2026-05-19) and the Linear updates there. Funding/valuation/sentiment move fast — re-verify before any external use.

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
| **Linear Diffs** (May 2026) | Review **inside Linear**, alongside product context; **guided reviews** (separates glue/secondary from core); agents + **MCP server** | Converging on our **grouping substrate** (core/supporting) → that substrate is now **table stakes**, not a differentiator |

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

**Take, round 2 (2026-08-02, UI/copy — decided with the round-1 list):**
5. **Header density** — theirs is concise and packed; ours is messy pre-group-dive.
   Simplify: submit button whose copy is the receipt (receipt semantics unchanged),
   PR state badge (open/draft/closed/merged — `state`+`draft` already stored), clean up
   the metadata strip (SHAs, model, etc. — spacing/multiline). Inspired, not cloned.
6. **State bar with counts** (Approve 0 · Comment 1 · Request changes 0) — folds into
   the reviewer filter bar (take #1).
7. **Succinct generated PR summary/changelog** — 1–3 lines + collapsible original
   description (both they and we collapse). Prompt change ⇒ **eval-harness gate**
   (scoped `--case` runs).
8. **Promote the intent check in the UI** — deviation-from-stated-ticket surface
   (BRIEF-85) is a differentiator nobody in the field has; currently under-sold.
9. **Consider later:** unified activity timeline (theirs is good; ours is split
   revision-timeline + conversation).

**Diff rendering note:** their diff viewer matches **`@pierre/diffs`** (diffs.com, Pierre
Computer's open-source Shiki-based library — stacked/split views, Shadow DOM + CSS Grid,
annotation framework for line comments; SSR). No acquisition — it's OSS, so equally
available to us. Spike: evaluate replacing the hand-rolled `DiffTable` with it (would buy
split view + perf; must carry our inline comments + chunk semantics through its
annotation API).

**Reject / reframe (positioning):**
- **Naked complexity score** — a severity label, non-gap (same reasoning as Unblocked's
  risk score). *Reframe:* a **review-depth recommendation** per group ("deep read /
  standard / skim") plus **factual static signals** (nesting depth, branch/`if-else`
  depth, cyclomatic-style counts) — deterministic AST metrics presented as facts in the
  attributes lane, not a verdict. Allocation-of-attention + signals is a surface they
  don't have (score without recommendation).
- ⌘K palette (our J/K reading flow is deliberate), diagrams tab (cost/taste), deploy
  events in feed (webhook scope creep).

**Watch:** whether Change Stack gets a delta brief / re-review mental-model reload —
that's the last piece of our wedge they haven't copied. Include in quarterly re-scan.

#### Platform deep-dive (2026-08-02, docs + blog pass)

Sources: [Change Stack docs](https://docs.coderabbit.ai/pr-reviews/change-stack),
[Change Stack blog](https://www.coderabbit.ai/blog/introducing-atlas-the-first-ai-native-code-review-interface),
[Overview blog](https://www.coderabbit.ai/blog/introducing-overview),
[Semantic Diff](https://www.coderabbit.ai/blog/introducing-semantic-diff),
[context engine](https://www.coderabbit.ai/blog/explainable-reviews-coderabbit-review-context-engine),
[intent blog](https://www.coderabbit.ai/blog/bottleneck-in-code-review-is-understanding-intent),
[review overview guide](https://docs.coderabbit.ai/guides/code-review-overview).

**Structure facts.** Cohorts = independent change units; layers = ordered *reading
order* within a cohort ("foundational changes (data structures, contracts) precede
dependent code (consumers, tests)"), range-anchored, per-layer AI summaries; diagrams
(sequence/state/ERD) only "when a visual earns its place". Three-panel layout; J/K/Z
shortcuts (convergent with ours). **Snapshots per commit** with a cross-push compare
dropdown, and commenting is *disabled while a new snapshot generates* — stale-feedback
protection. **Semantic diff** mode (move detection, token-level edits) beside
unified/split. **Code Peek** (definition/usage lookup via host code search). Path
filters/ignore rules mean Change Stack "reflects CodeRabbit's review scope, not
necessarily the full pull request file list" — they chose excludes-from-artifact.
Overview page: deterministic blocker/CI/decision aggregation + a plain-language
mergeability verdict + a ranked four-tier **"Needs Your Attention"** list
(author-lens; empty tiers hidden). Hosts: GitHub/GitLab/Bitbucket/Azure. **Pricing:
free during early access, then Pro+ plan** — their comprehension UI is headed behind
a paywall.

**Do (adjustments to our board, not new lanes):**
- **Stale-comment protection** — adopt the invariant: when the head advances past the
  brief's span, gate comment submission against the stale view (we show
  HeadAdvancedBanner; they *block* the footgun). Small addition to the brief screen.
- **Reading-order rationale inside groups** — "foundations before consumers" is a
  prompt-level ordering heuristic for our story view; evaluate in the grouping prompt
  (eval-gated).
- **Author-lens triage tiers** — fold the ranked needs-your-attention idea into the
  filed mergeability/blocker ticket: reviewer-lens (blockers vs warrant-attention) AND
  author-lens (what do I fix first) are different orderings of the same facts.
- **Excludes grill now has a comparator** — CodeRabbit excludes filtered files from
  the artifact entirely; our "never removes anything" stance is now a live
  differentiator or a live cost liability. The grill should decide with this on the
  table.

**Don't (confirmed anti-thesis or out-of-lane):** severity-ranked findings
(critical/major/minor — the verdict lane), review-UI chat agent (engagement surface,
v2 at best), bundled linter/SAST breadth, Code Peek-style host-search navigation
(platform-coupled, heavy; revisit only on user pull), diagrams (unchanged).

**Our edge, sharpened by this pass:**
1. **Delta is still uncopied.** Snapshots compare *pushes*; nothing compares against
   *your last review checkpoint* — no re-review reload, no delta brief. Their roadmap
   language ("show why it changed", "follow the story of the software as it evolves")
   says they're heading here — treat the quarterly watch as a fast clock.
2. **Intent: they claim it, we ship it.** The intent blog runs our thesis verbatim
   ("Code is no longer the bottleneck. Understanding is.") and gestures at "did the
   system build what we intended?" — but no ticket-vs-diff mechanism exists in the
   product. BRIEF-54 is concrete; the promote-intent-check ticket just got more
   urgent, and external copy should stake this ground before their marketing does.
3. **No-verdict stays structural.** Their surface is severity labels + verdicts +
   auto-generated review text — everything the noise complaint (§3) is about. Our
   anti-noise stance can't be bolted onto their architecture.
4. **Open vs paywall.** Their best comprehension UI is going Pro+; ours is OSS +
   self-host + BYOK. "The good review UI is free and yours" is now a direct,
   checkable contrast — use it in positioning.
5. **Receipt vs claims.** Their explainability is trust-us assertions (sandbox, evals,
   verification agents); our receipt is an inspectable artifact. Enterprise framing
   writes itself.

### Addendum (2026-08-02) — tuicr and the terminal-review lane

Analyzed a 16-min review (DevOps Toolbox) of **tuicr** (pronounced "tweaker"; Rust,
~1k stars, solo dev, sponsored) and, in passing, **Hunk** (`modem-dev/hunk`, hunk.dev,
5.6k stars, MIT — "review-first terminal diff viewer for agentic coders"). Neither is a
competitor — no AI generation, pure review mechanics in the terminal — but tuicr's
human↔agent loop matters to us. What tuicr does: vim-motion TUI over git/jj/hg; reviews
local working-tree changes, commit ranges, or fetched GitHub/GitLab PRs; **typed inline
comments** (note / suggestion / issue / **praise**, color-coded, vocabulary restrictable
in config); multi-line visual-block anchors; mark-reviewed folds the hunk; persisted
**review sessions as JSON**; submits real reviews via `gh`/`glab`; "yank review" copies
the whole review as agent-ready markdown ("I've reviewed your code, please address...");
and ships an **agent skill** (`pi-tuicr`) so an agent discovers active sessions, reads
the human's comments, and adds its own inline — review session as a shared
human/agent artifact.

**Read:** strong validation of our dual-consumer lane (ADR 0014) — the reviewer's
terminal-native workflow now *expects* review artifacts agents can consume and extend.
Our CLI already covers most of it (`--json`, `groups`/`conversation`/`delta`, the
`mergebrief` agent skill, ADR 0029 contract).

**Take:**
1. **Ship a packaged agent skill** (the `pi-tuicr` move): a skill that teaches any
   agent to pull the brief + conversation via our CLI and leave inline comments —
   distribution into the agent-skills ecosystem, near-zero product surface.
2. **Export the receipt via CLI** — today the receipt exists only client-side
   (`receipt.ts`); `submit` returns bare ids. The receipt IS the artifact; agents and
   scripts should be able to read it.
3. **"Copy review for agent"** — one-click yank of comments+receipt as
   agent-addressed markdown. Cheap, and matches how AI-authored-PR teams actually work.
4. **Typed human comments** (note/suggestion/issue/praise) — metadata on
   human-authored comments (authorship stays human, on-thesis); feeds the future
   comment-to-rule surface (BRIEF-48); vocabulary restrictable via repo config.
5. **Mark-reviewed folds the chunk** — small UI pattern on our existing
   reviewed-chunk state.

**Grill question, not a take:** generation-time file excludes (their `.tuicrignore`).
Our deliberate stance is "de-emphasis quiets display; it never removes anything from
the artifact" — but an exclude also cuts tokens (intersects the config-toggles ticket).
Completeness-vs-cost belongs to a grill.

**Already-parked, unchanged:** local/working-tree briefs (their strongest feature)
— our ContextSource local/git provider is parked to v2 (ADR 0033); tuicr validates
demand but doesn't change the sequencing.

### Addendum (2026-08-13) — Codiff: local-first walkthroughs, BYO-agent

**Codiff** (codiff.dev, `nkzw-tech/codiff`, MIT, ~1.3k stars; Christoph Nakazawa /
cpojer of Jest fame; Electron, brew cask; launched Show HN, first commit 2026-05-15).
"Effective code reviews locally and on the web." A fast local diff viewer for reviewing
Git changes and committing them — plus an **LLM narrative walkthrough** layer, which
puts it in our comprehension lane, not the bug-catching lane. The closest OSS
neighbor to our artifact so far. What it does:

- **BYO-agent generation**: walkthroughs are generated by the *user's own agent CLI*
  (Codex, Claude Code, Pi, or OpenCode — configurable `agentBackend`), invoked
  locally. No hosted LLM, no keys of their own — the user's existing agent
  subscription pays for generation. A step past our BYOK posture: BYO-*agent*.
- **Agent-skill distribution**: ships packaged skills per agent (`$codiff` from
  inside a session generates a walkthrough of the session's changes and opens the
  app). Distribution into the agent-skills ecosystem — exactly the `pi-tuicr` move
  we listed as Take #1 in the tuicr addendum, now done by a comprehension tool.
- **`$codiff plan`**: opens an *implementation plan* in the app for review/editing
  **before the agent executes it**. A pre-code review surface upstream of the PR —
  nobody else in the field has this.
- **`$codiff share`**: uploads an **immutable shared walkthrough** to codiff.dev
  (Cloudflare-backed) with **multiplayer comments** — `$codiff share pr 131` shares a
  walkthrough of a PR. Zero-install artifact sharing via URL.
- **Human↔agent comment loop**: inline comments on GitHub PRs / GitLab MRs, "copy
  review comments as Markdown" to paste back into the agent, and an ask-the-agent
  action from inside a comment editor (tuicr's shared-artifact pattern again).
- Configurable `walkthroughPrompt` — user-tunable walkthrough generation.

**Read:** second independent confirmation (after tuicr/Hunk) that the local, agent-
native review loop is where individual-dev energy is going — and the first one that
generates a *narrative walkthrough* rather than raw diff mechanics. Solo/OSS, no
funding, walkthrough quality bounded by the user's agent and a single prompt — no
taxonomy, no risk-surface attributes, no delta/re-review state, no receipt. The
positioning threat is not Codiff itself but what it normalizes: "walkthrough of my
changes, generated by my own agent, for free" as the baseline expectation.

**Take:**
1. **Agent-skill packaging is now proven in-lane** — raises the priority of our
   packaged-skill ticket (tuicr Take #1): a skill that pulls the brief + conversation
   via our CLI.
2. **Share-by-URL immutable artifact** — a brief you can hand someone with zero
   install; intersects the hosted-arm question (M1 self-host unchanged).
3. **Plan review as a surface** — pre-execution artifact review upstream of the PR;
   candidate future surface for the author-side soft-gate lane (ADR 0009).
4. **BYO-agent generation as a cost story** — our BYOK pitch can note the same
   economics; worth a grill on whether an agent-CLI backend belongs in our adapter
   set.

**Already-parked, unchanged:** local/working-tree walkthroughs are Codiff's core —
third validation of the parked ContextSource local provider (ADR 0033); sequencing
unchanged.

**Watch:** include Codiff in the quarterly re-scan.

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
4. **Guided reviews / glue-vs-core separation** (Linear) — = our core/supporting + concern split; now table stakes, ensure we match cleanly.
5. **MCP / agent-native integration** (Linear, Copilot) — our headless dual-consumer lane (ADR 0014): an MCP server exposing the Analysis Layer.
6. **Benchmark-driven marketing** (Greptile) — publish our own *comprehension/re-review* benchmark (the Phase-1 B′ test) rather than a bug-catch number.
7. **IDE / pre-PR presence** (Sourcery, Cursor) — aligns with the author-side soft-gate (ADR 0009): comprehension *before* request-for-review.
8. **Governance / receipt-as-audit-trail** (Qodo) — enterprise/hosted framing for the Receipt later.
9. **GitHub Marketplace distribution** (CodeRabbit) — discovery channel for the eventual hosted arm (M1 is self-host).

**Deliberately do NOT take (these are what we're positioned against):**
- Auto-verdicts / "approve-reject" gates, AI-authored review text, severity-graded bug assertions, "catch the most bugs" as the headline metric. Taking these collapses us into the noisy bug-bot lane we can't win and don't want.

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
- [Codiff](https://codiff.dev/) · [nkzw-tech/codiff](https://github.com/nkzw-tech/codiff) · [Show HN](https://news.ycombinator.com/item?id=48166275)
