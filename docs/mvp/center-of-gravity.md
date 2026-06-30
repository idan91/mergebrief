# Center of Gravity (2026-06-13 reshape)

> **⚠ Amended 2026-06-30 (OSS-only pivot — [ADR 0023](../adr/0023-oss-only-no-hosted-arm.md)).**
> The *product* reshape below still holds — what is headline (story + risk-surface + delta) vs
> engine (taxonomy) vs demoted (playbook → community commons; mind-map → persistence). What is
> **dead** is the *go-to-market* framing: "velocity-without-the-stability-tax" as a sell, org-
> primary / individual-door positioning, and the comment-to-rule loop as a *moat*. Read this for
> product priority, not strategy. Current strategy: [`../vision.md`](../vision.md) /
> [`../oss-roadmap.md`](../oss-roadmap.md).

> Single source of truth for the product's reshaped direction. Amends the emphasis in `initial-scope.md` (it does not delete it — the reviewer-side mechanics there still hold; what changed is which layers are headline vs engine vs demoted). Driven by the discovery interviews (`docs/interviews/synthesis.md`), most sharply by **D** — a senior who challenged the playbook layer directly.
>
> **Evidence base:** external N=3 (peer-network) + 1 founder self-capture + 1 skeptic (D). Thin for a reshape. Two things make it acceptable: most of the reshape **narrows and simplifies** (cutting on thin evidence is far lower-risk than building on it), and the one piece that *expands* scope — promoting the author side into v1 — is explicitly held loosely and gated on its own grilling pass.

## The shape

```
PROMISE  — what the org buys
  VELOCITY WITHOUT THE STABILITY TAX
           compress PR-creation → merge; fewer re-review loops
           because it was right before submit, not because you
           reviewed less. Velocity is the BYPRODUCT of quality,
           never the metric you sell. (See "the honesty rule".)

MECHANISM — how (what authors & reviewers feel)
  STORY & INTENT     what this change is, what actually matters vs
                     AI scaffolding
  QUALITY / RISK     risk-surface flags route attention to what's
                     risky or wrong — no verdicts, no bug-bot noise
  MINIMAL RE-REVIEW  author-side: catch it before submit (prevention)
                     reviewer-side: delta brief reloads the mental
                     model so the re-review context-switch is cheap

ENGINE — load-bearing, mostly under the hood
  TAXONOMY           stable change-type vocabulary; powers grouping,
                     risk attachment, agent guidance, cross-PR query
  CONCERN GROUPING   impl vs test vs scaffolding split

PLAYBOOK — demoted from headline
  FOR AGENTS         structured guidance an agent reviewer consumes;
                     seed of the comment-to-rule loop (below)
  FOR JUNIORS        optional, opt-in UI panel; off by default for
                     seniors (D: "by the time I read it I've reviewed
                     the PR… maybe more helpful for junior engs")

DROPPED / SHRUNK
  PRIVATE MIND-MAP   → persistence only (drafts, read state,
                     comment-target tracking). The "private thinking
                     space" framing is cut (D: "what benefit over a
                     pending review you don't submit?").
```

## The honesty rule (non-negotiable)

The org buys "fast **and** quality." If the product is pitched as "merge faster / less re-review" and an org measures only velocity, it becomes a **rubber-stamp accelerator** — the exact disease the framing set out to cure (`problem-framing/initial.md`: velocity *and* stability, never traded). So:

- Velocity is always the **byproduct** of higher quality/comprehension, never the goal sold directly.
- "Minimal re-review" means *fewer loops because it was right the first time*, and *cheaper reloads on the loops that remain* — never "skip the re-review".
- The **receipt** is the org's proof that quality happened alongside the speed (see below). It is what keeps the velocity claim honest.

## Lead value story — re-review as a context-switch tax

The cleanest articulation of the value, and the one to lead with:

AI raises delivery volume → more PRs and more follow-up commits per PR → more re-review *events*. Each re-review is a **context-switch**: the reviewer reloads the mental model of a PR they last saw hours or days ago. That reload cost is high and invisible, so people skip it and rubber-stamp (C: *"re-review is where I rubber-stamp the most… I almost never reconstruct whether the new change invalidated what I approved"*).

The **delta brief** does the reload *for* the reviewer — "here's what changed since you last looked, here's what it may have invalidated" — making the context-switch cheap **without making the review shallow.** That is velocity-through-quality in one sentence, and it's the least Linear-overlapping, least-contested, highest-pain thing in the interview set (3/3 vivid).

## Author view — the same brief, one step earlier

The author side is promoted from an ungrilled v2 placeholder to a real (secondary) v1 surface, because "minimal re-review" is mostly *prevented* on the author side. D's rubber-stamp story was an author who hadn't self-reviewed; the fix was a DM ("did you go over your code before submitting?"). If the author had seen the issues before submit, that review round never happens.

```
AUTHOR VIEW — same analysis engine, shown to the person who can
              still fix it cheaply.

PRE-SUBMIT SELF-REVIEW
  STORY & INTENT   your change grouped by intent — confront what you
                   shipped vs the ticket
  QUALITY / RISK   risk-surface flags on your own diff — a mirror,
                   not a gate
  INTENT CHECK     ticket/goal shown beside the change so the gap is
                   visible ("does this even do what was asked" — the
                   exact A and D miss)

SOFT GATE (never blocks)
  "ready for review?"  surfaces unaddressed risk flags before you
                       request review — warns, you authorize

POST-REVIEW (secondary, later)
  understand reviewer comments + agent assist to reply
  (no AI-authored replies — same rule as the reviewer side)

CUT / PARKED
  "critical areas" verdict   → factual risk-surface instead (ADR 0002)
  "trigger fix" / agent edits → adjacent product, parked
  separate IDE / CLI surface  → same web app for now (cheapest)
```

**Adoption hook:** authors want to ship, not do more work. The only thing that makes them run it is the selfish carrot — *this is the brief that gets your PR approved faster.* Velocity accrues to the author too, which is why the velocity framing makes the author side adoptable where "be more thorough" wouldn't.

**Hold loosely:** this is the one scope *expansion* on thin evidence. Keep it thin (same web app, brief shown one step earlier — not an IDE plugin or pre-commit hook) and grill it before committing build.

## Activation — draft-first (opt-in)

Replaces the lazy "click-to-activate" model for orgs that opt in. The draft phase *is* the author's self-review window, and it sequences author-before-reviewer for free:

```
PR opens (draft) → worker generates brief → AUTHOR self-reviews
  → author marks "ready for review"   ← the handoff event
  → reviewers inherit the SAME brief (cached by SHA, already warm)
```

Design commitments:

- **Config lives in a repo YAML** (`.coderabbit.yaml`-style). Per-repo, version-controlled, reviewable in a PR. Declares: draft-first on/off, recompute triggers, PRs to skip, **and the rule-promotion approvers** (see below). Org-level defaults with per-repo override.
- **CLI opens; the GitHub App watches.** A configurable CLI can open PRs as draft (nice dev ergonomics), but coverage and all follow-up-commit recompute come from the **App webhook** watching PR-open and new-commit events — because devs who open PRs in the GitHub UI bypass the CLI. CLI = ergonomics; App = coverage guarantee.
- **Opt-in, never forced default.** Forcing every PR to draft is the most intrusive thing in the design; it changes people's git workflow. It is an admin/org choice, off by default.
- **Fail-open via native draft.** Only ever use GitHub's **native** draft state — never a custom lock. If brief generation fails (provider outage, hang), the PR is just a normal GitHub draft the author fully controls and can mark ready themselves. AI outage must never trap a PR. Reliability is the precondition for being allowed to sit in this position at all.
- **Cost note:** draft-first reverses the original lazy cost gate (compute-on-click → compute-on-every-draft). Acceptable for paying orgs that want it on everything; mitigate by debouncing and skipping trivial / instantly-closed PRs.

## Comment-to-rule loop + governance (v2+)

The compounding-quality flywheel and the project's most defensible moat candidate. Accepted, *valuable* review comments become codified, repo-local agent context so agents stop repeating the same mistakes ("don't bypass eslint unless necessary").

Why it matters:
- **D validated the premise unprompted:** the AI reviewer (Unblocked) is good *"if the repo has a clear lightweight AGENTS.md file."* This feature builds and maintains those files from real review activity.
- **It closes the re-review loop at the source:** the same issue stops recurring, so the codebase's review burden *drops* as the rule base grows.
- **It's the playbook's real destiny:** the playbook isn't a human UI panel — it's the seed of a repo-local, comment-fed rule base that agents consume.

Governance (the load-bearing part — without it the rule base fills with junk and bloats, killing D's "lightweight" requirement):
- **Candidates, not auto-rules.** Accepted/resolved comments become *candidates*, weighted by **recurrence** (same issue across multiple PRs = strong) and **reviewer authority** (the seniority gradient the interviews described).
- **Role-gated promotion.** Only designated approvers — CODEOWNERS for the affected path, or a role list declared in the repo YAML — can promote a candidate to a rule. A less-experienced dev's accepted comment is a candidate, never a self-promoting rule.
- **Rules land as PRs.** Promotion opens a PR adding the rule to the repo context md; the repo's normal review merges it. Nothing enters agent context without a reviewed, merged PR — double audit, and it can be dogfooded through this very tool.
- **Lean first, view later.** The MVP needs no bespoke screen: promotion = a PR governed by existing CODEOWNERS/review. A dedicated approval/triage view is the at-volume version once a candidate queue justifies it.
- **Guardrails:** never auto-commit; keep the rule base lightweight (curation over accumulation); v2+, depends on the review flow working and accumulated accepted comments first.

Moat honesty: because the learnings live in the repo as portable md, **you don't own them** — less lock-in than a hosted rule store. The moat becomes *the engine that produces and maintains good rules*, plus the in-platform exhaust (dismissals, reclassifications, recurrence signal) that competitors can't see — not the data itself. Weaker but more adoptable and trust-friendly. Supersedes the hosted-org-learned-playbooks framing in `next-steps.md` as the concrete mechanism.

## Org vs individual, and OSS

- **Primary: orgs.** "Fast + quality delivery" is an org/EM intention (DORA-shaped), and that's who has budget. Draft-first, author+reviewer, paid.
- **Keep the individual door open.** The org's champion is an individual first — they try it (zero-install: paste a public PR → brief) before they can mandate anything. Land-and-expand; don't close the bottoms-up entry point to chase pure org sales.
- **OSS = distribution, not revenue.** Maintainers reviewing AI drive-by PRs from strangers have an acute, different-shaped version of the pain, but you can't force draft or a CLI on external contributors — OSS is inherently individual, reviewer-side-only, bottoms-up. Free for public repos; the value is credibility and public-PR visibility, not seats. Same zero-install artifact that is also the Phase 1 labeling surface.

## Receipt as org-audit

In an org-velocity framing the **receipt** gains a clear reason to exist: it is the org's evidence that quality work happened *alongside* the speed, not instead of it — the quality-audit trail that keeps the velocity claim honest. Notably the one feature D did **not** question (unlike the mind-map). Amends, not reverses, ADR 0002.

## What this changes (→ next steps & ADRs)

- **Phase 1 must be redefined before any PR labeling.** The Treatment-vs-B′ design isolates the *now-demoted playbook* over grouping. Running it would burn ~8 labeling hours validating a layer you've decided to hide. The new experiment should test the new center of gravity — does **story + risk-surface + delta** move reviewer behavior. See `phase-1.md` / `validation-plan.md` flags. **Gating.**
- **Author side needs its own grilling pass** — promoted to v1 but never walked through the decision tree.
- **Moat re-derivation:** taxonomy is now secondary and the playbook is demoted. The defensible core is **delta/re-review + the comment-to-rule engine + dual-consumer + integrated create-to-merge workflow** — not the taxonomy alone.
- **ADRs to revisit / write:**
  - Revisit **ADR 0004** (private mind-map) — thinking-space framing cut; mind-map shrinks to persistence.
  - Amend **ADR 0002** (receipt-not-approval) — receipt gains the org-quality-audit role.
  - New ADR — **draft-first activation** (opt-in; reverses the lazy cost gate; native-draft fail-open).
  - New ADR — **author side promoted to v1** (dual-consumer brief extended to the author).
  - New ADR — **playbook demoted** to agent-facing / optional-junior-UI / comment-to-rule seed.
