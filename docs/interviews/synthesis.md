# Interview Synthesis — PROVISIONAL (external N=3 + 1 self-capture)

> Status: **gate NOT met.** Script requires ≥4 interviews; countable external: **3** (B, C, D). A is a founder self-capture — excluded from the quota and from wedge tallies, kept as self-report context. One more external interview unlocks the gate; it should be the **non-adjacent stranger** (Reddit) — all interviews so far are peer-network or referrals.
>
> **Tenor shift (D, 2026-06-13):** the earlier 2/2/2 unanimity is broken — on the right axis. D is a senior who challenges the **playbook layer** (the moat) directly, and predicts the Phase 1 null result. The picture is now sharper and more honest, not worse. Read this synthesis as "grouping/intent lands broadly; the differentiator layer is contested and may be junior- or large-PR-skewed."

## Data-quality flags

1. ~~Duplicate sheet~~ — **resolved.** `faang-staff` has distinct content (Interview C).
2. ~~Interview A origin~~ — **resolved: self-capture (founder).** Excluded from quota and wedge tallies. Observations kept, always labeled self-report.
3. **C's wedge mention is a paraphrase** ("review briefing") — verify it predated section 7.
4. **Interview C sheet incomplete.** No Linear-reaction / artifact-reaction rows. Backfill or mark "not asked".
5. Artifact reactions are founder-administered — demand characteristics apply. D's *negative* reaction is therefore the most trustworthy artifact data in the set (you don't coach someone into criticizing your own design).
6. **D's wedge-checklist is mis-coded (NEW).** D ticked intent-tagging, per-change checklists, and private-space — but named two of them *to reject them* ("playbook… unnecessary noise"; "what benefit [does the private space] have over a pending review you don't submit?"). The checklist can't distinguish "reaches for it" from "names it to dismiss it"; for a skeptic it inverts the signal. **Recode D:** intent/grouping = positive; playbook = negative; private-space = skeptical/unconvinced. Add a valence column (wants / neutral / rejects) to the checklist going forward; the same generous-coding risk was flagged for A.

## Interviews used

- **A — SELF-CAPTURE (founder; non-countable).** Senior SWE, 6 YoE, ~450-eng org. ~90% AI-heavy. Tools: Claude Code/Cursor, Unblocked.
- **B (Jorge)** — Mid-level SWE, 5 YoE, 5-person squad, ~50-eng startup. ~80–85% AI-heavy. Tools: Cursor, CodeRabbit, Linear (Diffs beta user).
- **C (FAANG staff)** — Staff SWE, infra/platform-adjacent, ~9 immediate / ~40 org. ~35–50% AI-heavy. Tools: CodeRabbit + Claude Code.
- **D (FE tech lead)** — Senior FE tech lead, 10-person squad, ~500-eng org. ~95% AI-heavy. Tools: Cursor, OpenSpec, Unblocked. **Skeptic** — the first interviewee to push back on the wedge. *Origin: record whether D is C's FE-tech-lead referral (adjacent network) — likely, so the non-adjacent stranger is still outstanding.*

Sample now spans mid-level→staff, startup→500-eng org, backend/infra→frontend, AI-share 35–95%. Not a monoculture on persona — but still not a monoculture-break on *network* (all peer/referral).

## Gate questions

### 1. Comprehension-shaped or bug-catch-shaped?

**Comprehension-shaped, 3/3 external** (self-report A consistent). Bug-catch never surfaced as a want — only as a complaint about bug-catchers. But **D splits the wedge into two layers** and validates only the first:

- B: eyes "glazed over" at the third file of generated DTOs; approved 400 lines unread. On Linear Diffs: "it doesn't tell me **which parts of this 800-line PR actually matter** and which parts are just AI boilerplate."
- C: "I stopped reading carefully once the diff became repetitive… **At that point I sampled instead of reviewed.**" Wants a "review briefing — what changed semantically, risky files, behavior deltas… **less interested in another bot leaving line comments.**"
- D (coping, unprompted core/concern behavior): "I first identify the main files with the core pieces of logic and focus on them, ignore nitpicks, then tests, then nits last." → the grouping/concern-split layer **lands**.
- D (the challenge): grouping by story/intent is "nice," but **the playbook is "unnecessary noise… by the time I read the playbook, I can already review the PR. Maybe this is more helpful for more junior engs."**
- Bug-catch as anti-signal: B — CodeRabbit "mostly noise… never catches actual business logic flaws"; C — auto-resolves 30–50% of CodeRabbit; D — never ignores Unblocked but uses it to "confirm or push back," "other devs mostly accept blindly."

**Read:** the **grouping/intent substrate is validated 3/3**; the **playbook/differentiator layer is 2 wants (B, C) vs 1 senior reject (D)**. That 2-vs-1 split *is* the Phase 1 Treatment-vs-B′ question, surfacing in the field before any labeling.

### 2. Re-review pain — vivid and spontaneous?

**Yes, 3/3 external.** Delta brief's v1 must-have status holds; D adds a process-substitute caveat.

- C (sharpest): "**Re-review is where I rubber-stamp the most.** I almost never reconstruct whether the new change invalidates something I already approved."
- B's incident: Cursor applied a requested fix AND silently refactored a shared utility same commit; B reviewed only the delta, missed it, **broke staging**.
- D: vivid "but dependent on team culture — if you are harsh but honest and enforce good practices, you reduce iterations." For small new commits reviews just the new commit; otherwise the whole PR.
- (Self-report A): re-reads the entire PR every iteration; authors "blindly throw AI at the comments, resulting in bad fixes."

D's caveat matters: the delta brief competes with **process discipline**, not only with nothing. On a high-discipline team the pain is smaller.

### 3. Skill atrophy unprompted?

**Now 2/3 external — D dissents (healthy).**

- B: "our juniors aren't learning the domain models anymore… merge it without understanding how the data actually flows."
- C: "juniors are getting good at producing **review-shaped code** without understanding the system. Reviewers… **assume understanding exists**."
- **D (counter-view):** "Pure coding, potentially yes; engineering as a whole, no. AI in the right hands forces you to be an orchestrator and designer… higher-level system thinking while still diving deep." A credible senior who sees AI as net skill-*up*.
- (Self-report A): consistent with B/C.

The dissent is good news: 3/3 was suspiciously clean. **Do not promote skill-atrophy to primary positioning** — it's contested, and D's framing (AI as orchestration skill) is a real competing narrative the pitch must survive.

### 4. PR shapes / change types the gate set doesn't cover

1. **Scaffold/repetitive-heavy PR** — B (DTO/mapper bulk), C ("same pattern across ten files"), self-report A (unnecessary test bulk). Add one where the `generated`/scaffolding Concern dominates LoC and the implementation kernel is small.
2. **Large, multi-group, complex PR (NEW — D).** D: "this example is small with one group… unless the grouping is more substantial with larger and more complex PRs." The wedge's value scales with PR size/complexity; the small single-group medusa PR **undersells it**. Add a deliberately large multi-group PR to the gate set. **Method consequence:** the interview *artifact* (currently medusa) biases skeptics against the wedge — show a large PR in remaining interviews, or show both.
3. **Track 3 follow-up shape** — follow-up push must carry an *adjacent unrequested change* (B's staging incident; C's "nearby logic not tied to comments").
4. **Buried-behavior-change case confirmed** — C's auth-error-swallowing retry "buried in a helper refactor + test bulk" is the `move-with-edits`/bundling hard case the gate set already targets. Also D's "unstable default array prop → constant rerenders, visible in diff, approved anyway" — a frontend buried-bug shape; consider a FE tricky-cases note.

### 5. Linear verdicts → positioning

- B (Diffs beta user): "aesthetically really nice and fast, but… it doesn't solve the core problem. It makes the code easier to read, but it doesn't tell me which parts of this 800-line PR actually matter."
- C: not captured (flag #4).
- D: "Haven't used, we're a Jira company." (self-report A: Jira/none.)

B's quote remains the lone direct Linear data point — supports the "grouping = table stakes, attention-routing = the gap" reframe. **Linear is under-sampled** (1 of 3 external has used it); the remaining interview ideally adds a Linear user.

## Cross-cutting observations

- **Playbook-as-noise (D) — the critical risk.** First direct challenge to the moat, from the target ICP, equivalent to the Phase 1 null hypothesis. Carry it as the thing the gate must beat, not a footnote.
- **ICP tension: senior vs junior (D).** D twice locates the playbook's value in junior engineers. If the wedge is junior-shaped, the **senior-only Phase 1 premise is in question** — either the proof bar is right and hard, or the cohort is wrong. Confront in the next planning pass (touches `phase-1.md` cohort rationale and the Phase 1.5 junior gate).
- **Private space challenged (D):** "what benefit over a pending review you don't submit? historical context? use as data?" Need a crisp mind-map-vs-native-draft-review differentiator. His "use as data / historical context" question accidentally names the **org-learned-playbooks / data-exhaust moat** — the answer exists but is v2 and absent from the demo.
- **"Is this safe?" overconfidence (C):** Claude Code "overconfidently blesses code." Field support for receipt-not-approval / no-verdict.
- **Seniority gradient on AI-review pushback** (C, D, self-report A): only seniors read and challenge the AI reviewer; others "accept blindly." Consistent — but cuts both ways: seniors are also the ones who find the playbook redundant.
- **Org-enforcement / adoption** (self-report A; implicit in D's "hard to justify for a team of mostly experienced engs"): feeds the zero-install / bottoms-up thread.
- **AI-share varies by change type** (C): high for tests/migrations/glue, low for core/perf/security.

## Actions

- [x] ~~Mark Interview A's origin~~ — self-capture; excluded.
- [ ] **Record D's origin** (C's FE-tech-lead referral? → adjacent network).
- [ ] **Make the final interview the non-adjacent stranger** (Reddit). Network-break is now the single biggest outstanding validity gap.
- [ ] **Recode D's wedge-checklist with valence** (intent = wants, playbook = rejects, private-space = skeptical); add a valence column to the capture template.
- [ ] **Add a large multi-group complex PR** to the gate set; use a larger PR (or both) as the interview artifact so it stops underselling to skeptics.
- [ ] Add one scaffold/repetitive-heavy PR; constrain Track 3 to a follow-up-with-adjacent-change shape.
- [ ] **Re-examine the senior-only Phase 1 premise** against D's junior-skew claim (cohort rationale in `phase-1.md`).
- [ ] Sharpen the mind-map-vs-unsubmitted-draft-review answer (positioning); note the data-exhaust moat is the deeper answer to D's "use as data" question.
- [ ] Verify C's "review briefing" predated section 7; backfill C's Linear/artifact rows.
- [ ] Mine Reddit replies for comprehension-vs-bug-catch language as an uncontrolled secondary sample; prefer a Linear user for the final interview.
