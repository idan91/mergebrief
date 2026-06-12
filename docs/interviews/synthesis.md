# Interview Synthesis — PROVISIONAL (external N=2 + 1 self-capture)

> Status: **gate NOT met.** Script requires ≥4 interviews; countable external interviews: **2** (B, C). A is a founder self-capture — excluded from the quota and from wedge tallies, retained as self-report context. Two more external interviews unlock the gate. Signal so far is consistent and favorable — but both external voices are peer-network; treat as directional until at least one non-adjacent voice is in.

## Data-quality flags

1. ~~Duplicate sheet~~ — **resolved.** `faang-staff` now has distinct content (Interview C).
2. ~~Interview A provenance~~ — **resolved: self-capture (founder).** Excluded from quota and from spontaneous-wedge-mention tallies (a founder reaching for his own design is not signal). Its observations are kept below, always labeled self-report. Sheet annotated.
3. **C's wedge mention is a paraphrase** ("review briefing") rather than verbatim — acceptable but verify it predated section 7.
4. **Interview C sheet incomplete.** No Linear-reaction row and no artifact-reaction row. Backfill from memory/recording or mark "not asked".
5. Artifact reactions are founder-administered — "grabbed" is encouraging but demand-characteristics apply. Weak positive, not evidence.

## Interviews used

- **A — SELF-CAPTURE (founder; non-countable).** Senior SWE, 6 YoE, 10-person squad in ~450-eng org. ~90% AI-heavy PRs. Tools: Claude Code/Cursor dev, Unblocked review.
- **B (Jorge)** — Mid-level SWE, 5 YoE, 5-person squad in ~50-eng startup. ~80–85% AI-heavy. Tools: Cursor, CodeRabbit review, Linear (Diffs beta user).
- **C (FAANG staff)** — Staff SWE, infra/platform-adjacent product team, ~9 immediate / ~40 org. ~35–50% AI-heavy (higher for tests/migrations/CRUD glue, lower for core architecture/perf/security). Tools: CodeRabbit + Claude Code, both heavy.

External sample: mid-level startup + staff FAANG, AI-share 35–85% — small but not monoculture.

## Gate questions

### 1. Comprehension-shaped or bug-catch-shaped?

**Comprehension-shaped, 2/2 external, in their own words** (founder self-report consistent). The pain language is attention-routing and understanding, not detection:

- B: eyes "glazed over" at the third file of generated DTOs; approved 400 lines unread after 3 minutes on the handler. On Linear Diffs: "it doesn't tell me **which parts of this 800-line PR actually matter** and which parts are just AI boilerplate."
- C: "I stopped reading carefully once the diff became repetitive: same pattern across ten files, tests looked plausible, CodeRabbit only had nits, and CI was green. **At that point I sampled instead of reviewed.**" And explicitly: wants a "review briefing — what changed semantically, risky files, behavior deltas, hidden coupling, what to re-check after follow-up commits… **less interested in another bot leaving line comments.**"
- (Self-report, A): 30-minute review that "deserved less" because the **author** didn't understand the task; 4 iterations to reach "passable"; heavy unnecessary tests too costly to read.
- Bug-catching appeared only as complaints *about* bug-catchers: B — CodeRabbit is "mostly noise… never catches actual business logic flaws"; C — skims most CodeRabbit comments, "trusts almost none blindly," auto-resolves 30–50%.

C's "review briefing" paraphrase is the closest thing yet to a spontaneous description of the product (brief + risk-surface + delta). Strongest single wedge signal in the set — pending the section-7-timing check (flag #3).

### 2. Re-review pain — vivid and spontaneous?

**Yes, 2/2 external with incident detail** (founder self-report consistent). **Delta brief's v1 must-have status strongly holds.** Three different coping strategies, one underlying gap:

- C (verbatim, the sharpest): "**Re-review is where I rubber-stamp the most.** I look at the pushed commits… but I almost never reconstruct whether the new change invalidates something I already approved." Also saw follow-up commits touching nearby logic unrelated to comments — caught by rereading the commit list or CI, "not tooling."
- B's incident: Cursor applied a requested fix AND silently refactored a shared utility in the same commit; B reviewed only the delta, missed it, **broke staging**.
- (Self-report, A): re-reads the entire PR every iteration (can't trust the delta): authors "blindly throw AI at the comments, resulting in bad fixes."

A pays full-re-read cost; B and C pay the miss. The delta brief's exact pitch ("what does this push invalidate in my prior review") was articulated unprompted by C.

### 3. Skill atrophy unprompted?

**Yes, 2/2 external spontaneous** (founder self-report consistent):

- B: "our juniors aren't learning the domain models anymore… prompt 'fix the types' and merge it without understanding how the data actually flows."
- C (new mechanism, ties to the root-cause analysis): "juniors are getting good at producing **review-shaped code** without understanding the system. Reviewers then see nice structure and tests and **assume understanding exists**."
- (Self-report, A): "engineers are losing their touch and off-loading their brains to AI… juniors are not reviewing code and using it to learn. PRs are some of the best tools for learning."

C's "review-shaped code" is the problem-framing root cause ("AI code looks confident and tidy — signals humans evolved to trust") stated independently from the field. Post-framing addendum well supported within this sample; still peer-network, so hold it as secondary positioning until strangers echo it.

### 4. PR shapes / change types the gate set doesn't cover

Adjustments indicated:

1. **Scaffold/repetitive-heavy PR.** Both external interviews named generated/repetitive bulk as the engagement killer (B: DTO/mapper files; C: "same pattern across ten files"; self-report A adds heavy unnecessary tests). The gate set has no PR where repetitive scaffolding dominates LoC and the implementation kernel is small. Add one (gate set if a slot fits, else stress set) — it directly tests the Concern view / adjusted-LoC "where is the real change" claim, which is what B reached for in the artifact ("a button that hides the AI scaffolding and shows me the human decisions").
2. **Track 3 follow-up shape.** Pick the re-review PR so the follow-up push contains an *adjacent unrequested change* alongside the requested fix (B's staging incident; C's "nearby logic not tied to comments"). A follow-up that only addresses comments tests nothing.
3. **Buried-behavior-change case confirmed, no change needed.** C's failure story — retry logic swallowing an auth error, "visible in diff but buried in a helper refactor + large test additions" — is exactly the `move-with-edits`/bundling hard case the gate set already targets as critical. Field confirmation that the slot is well spent; write tricky-cases notes to that shape.

### 5. Linear verdicts → positioning

- B (Diffs beta user, verbatim): "aesthetically really nice and fast, but honestly, it doesn't solve the core problem. It makes the code easier to read, but it doesn't tell me which parts of this 800-line PR actually matter."
- C: not captured (flag #4) — backfill.
- (Self-report, A: hasn't used Linear.)

B's quote is direct field support for the 2026-06-07 reframe: grouping/readability substrate = table stakes; the felt gap is attention-routing on top. Usable nearly verbatim in positioning. One beta user — don't over-index.

## Cross-cutting observations (unprompted, worth carrying)

- **"Is this safe?" overconfidence (C):** Claude Code "overconfidently blesses code" when asked for a safety verdict. Field support for the receipt-not-approval / no-verdict design — the product's refusal to bless is a feature users have been burned into wanting.
- **Org-enforcement question (self-report, A):** how to make devs use this instead of defaulting to the GitHub interface. The adoption/distribution risk the framing already names. Feeds the zero-install / bottoms-up thread.
- **Seniority gradient on AI-review pushback** (C: staff-level skim-and-distrust discipline; self-report A: only seniors challenge Unblocked). Consistent with the senior-only Phase 1 cohort choice.
- **Author-side incomprehension is upstream of reviewer pain** (self-report, A: 4 iterations because the author never understood the task). Supports the v2 author-side direction; no v1 action.
- **AI-share varies by change type** (C: high for tests/migrations/glue, low for core/perf/security) — supports the Concern/Category split mapping onto where AI authorship actually concentrates.

## Actions

- [x] ~~Mark Interview A's provenance~~ — self-capture confirmed; sheet annotated, excluded from quota and wedge tallies
- [ ] Verify C's "review briefing" mention predated section 7
- [ ] Backfill C's Linear-reaction and artifact-reaction rows (or mark "not asked")
- [ ] Run ≥2 more external interviews to meet the ≥4 gate — candidate pool: C.M. (A's referral), Sarah (B's referral), C's two referrals (FE tech lead, incident-prone-services backend senior). All four are referrals = adjacent network; make at least one of the remaining interviews a non-adjacent voice (Reddit thread respondents are a source)
- [ ] Add one scaffold/repetitive-heavy PR to the PR set; constrain Track 3 PR choice to follow-up-with-adjacent-change shape
- [ ] Write move-with-edits tricky-cases notes to C's failure shape (behavior change buried in refactor + test bulk)
- [ ] Mine Reddit thread replies for comprehension-vs-bug-catch language as an uncontrolled secondary sample
