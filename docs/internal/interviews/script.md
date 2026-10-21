# Discovery Interview Script

> Runnable script for the PMF-track discovery interviews (`next-steps.md` #1). ~30 min per interview. Target: ≥4 before the first Phase 1 reviewer session.
>
> **Pool rule:** interviewees are excluded from the Phase 1 reviewer pool — the interview exposes the framing and anchors review behavior. Phase 1 reviewers get the discovery questions in their debrief tail instead (`phase-1.md`).

## Ground Rules (Mom Test)

- **Past behavior only. Never hypotheticals.** "Walk me through the last time…" — never "would you use…", "do you think a tool that… would help?"
- **Pitch nothing until section 7.** The interview is about their life, not the product. If they ask "so what are you building?" — "I'll show you at the end; first I want your unfiltered version."
- **Silence is a tool.** After a question, stop talking. Awkward pauses produce the real answers.
- **Specifics over generalities.** When they say "PRs are too big these days" → "tell me about the last one." Every generality gets converted to an incident.
- **Capture verbatim quotes**, especially anything that sounds like the wedge. Paraphrase loses the signal.

### Leading-question blacklist (do not ask)

- "Do you feel like you rubber-stamp reviews?" (plants the frame)
- "Would categorizing changes by intent help you?" (pitches the taxonomy)
- "Do you trust AI-generated code?" (survey data already answers this; invites posturing)
- Anything containing "comprehension", "playbook", "intent", "risk surface" before section 7.

## Structure (~30 min)

### 0. Intro — 2 min

> "I'm researching how code review is actually going for engineers now that a lot of code is AI-assisted. Not selling anything today — I want war stories, not opinions. Everything stays anonymous. OK to record?"

Collect context (fast): role, seniority, team size, rough % of PRs they'd guess are AI-heavy, which review tools the team runs.

### 1. Recency anchor — 8 min (the core)

> **"Think of the last AI-heavy PR you reviewed. Walk me through it — open the memory like a screen recording. What did you look at first?"**

Probes:
- "Where did you stop reading carefully?" — get the *moment*, not the rationalization.
- "How long did the whole review take? How long would the PR have deserved?"
- "What did you write as comments vs what you noticed but let slide?"
- "When you hit a part you didn't fully understand — what did you do?" (read harder / asked author / asked AI / approved anyway)
- "How did you decide it was safe to approve?"

### 2. Failure story — 5 min

> **"Tell me about a bug that got through review — yours or someone's. What happened?"**

Probes:
- "Looking back, was it *visible* in the diff? What would it have taken to catch it?"
- "What changed afterwards — process, behavior, nothing?"
- Listen (don't prompt) for the **skill-atrophy** dimension: "we're getting worse at catching these" / "juniors never learn the codebase". Mark if spontaneous.

### 3. Coping under pressure — 3 min

> **"A 600-line PR lands and you have 20 minutes — what do you actually do?"**

Probes:
- "Which files do you open first? Why those?"
- "What do you skip entirely? Tests? Generated code? Config?"

### 4. Re-review — 4 min

> **"You reviewed a PR, left comments, the author pushed follow-up commits. What do you look at when you come back?"**

Probes:
- "Just the new commits, or do you re-check the rest?"
- "Ever had a follow-up push quietly change something you'd already approved? How did you find out?"
- This probes the delta-brief hypothesis (`initial-scope.md`: re-review = hardest rubber-stamp pool). Mark whether the pain is spontaneous and vivid, or shrugged off.

### 5. Tools tried — 4 min

> **"What review tooling does your team run — CodeRabbit, Copilot review, anything? What's your honest relationship with its output?"**

Probes:
- "When it comments, what do you do — read, skim, auto-resolve?"
- "What did it catch that mattered? What does it miss?"
- "Anything you tried and dropped? Why?"

### 6. Linear probe — 2 min (verbatim capture required — `next-steps.md`)

> **"Are you on Linear? Seen their Diffs feature? Does it solve anything you've described, or no?"**

Capture reaction word-for-word — key signal for positioning and wedge survival.

### 7. Artifact reaction — last 5 min ONLY

> "OK, now the thing I'm building. Instead of explaining it — here's a real PR and the brief the tool would produce for it." *(Show the medusa-15605 brief, hand them control.)*

- **Say nothing for the first minute.** Watch: do they grab it and start navigating (clicking around groups, scanning playbook items), or read politely top-to-bottom?
- Then: "What would you use here, if anything? What's noise?"
- Do NOT walk them through features they didn't touch. Untouched = signal.

### Close — 1 min

- "Who else should I talk to that reviews a lot of AI-heavy code?" (referral = also an enthusiasm signal)
- "Can I follow up when there's something to try?"

## Capture Sheet (fill within 1 hour of the interview, per interviewee)

### Template

| Field | Entry |
|---|---|
| Role / seniority / team size | |
| % AI-heavy PRs (their guess) | |
| Rubber-stamp moment (verbatim) | |
| Failure story — visible in diff? | |
| Skill-atrophy mentioned spontaneously? | yes / no + quote |
| Re-review pain: vivid / mild / none | |
| Tools used + honest relationship | |
| Linear reaction (verbatim) | |
| Artifact reaction: grabbed / polite | what they touched first |
| Spontaneous wedge mentions (see below) | |
| Referrals given | |

**Spontaneous wedge mentions checklist** (`next-steps.md` validation requirement — count ONLY if unprompted, before section 7):
- [ ] intent-tagging / change-type structure
- [ ] per-change-type checklists or review structure
- [ ] a private place to think through a review
- [ ] a record/receipt of what was actually verified
- [ ] "better bug catching" instead ← if this dominates, investigate: wedge wrong, or right-but-described-differently?

## Synthesis Gate (after ≥4 interviews, before labeling the remaining gate PRs)

Write `docs/internal/interviews/synthesis.md` answering:
1. Is the pain **comprehension-shaped** or **bug-catch-shaped** in their own words?
2. Did re-review pain show up vivid and spontaneous? (If not — delta brief's v1 must-have status gets re-examined.)
3. Did skill-atrophy surface unprompted? (Tests the post-framing addendum at N>peer-network.)
4. Any PR shapes / change types named that the gate set doesn't cover → adjust PR selection.
5. Linear verdicts → positioning language update if needed.
