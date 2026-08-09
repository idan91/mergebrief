# Initial Scope

> **⚠ Partially superseded by the 2026-06-13 reshape — read [`center-of-gravity.md`](./center-of-gravity.md) first.** The reviewer-side *mechanics* here still hold; what changed is emphasis. Specifically: the **playbook** is demoted (agent-facing + optional junior UI, not a human headline panel — §2, §3); the **private mind-map** shrinks to persistence only, "thinking space" framing cut (§5); **taxonomy/grouping** become engine, not headline; the **author side** is promoted from the v2 placeholder below into a real (secondary) v1 surface; and **draft-first activation** is added as an opt-in alternative to the click-to-activate model in §1. Where this file and `center-of-gravity.md` disagree on emphasis, the latter wins.
>
> v1 focus: **Reviewer side** (+ a thin author-side self-review surface — see reshape). ~~v2: Author side.~~
> Wedge: comprehension scaffolding, not another reviewer bot — delivered as story + risk + delta (velocity-through-quality).

## Foundational Principles

- **AI assists, human authorizes.** Author owns AI-generated code. Reviewer owns AI-assisted review. The tool issues a *receipt* of what it verified, never an "approval".
- **Tool never blocks reviewer on AI.** Categories, flags, and brief contents are all overridable. Soft-fail on AI outage.
- **No AI-authored text ships.** The agent surfaces structure (categories, playbooks, seeds) and post-hoc validation (feedback on what the reviewer wrote). The reviewer writes every comment.
- **Private thinking, public outcome.** Discussion with the agent stays in the tool's mind-map space. Only finalized human comments + scoped receipt land on the PR.
- **Diff-by-intent, not diff-by-line.** The unit of review is the categorized chunk + its playbook, not the raw line diff.

## Surface and Onboarding

- **Web app + GitHub App bridge.**
  - GH App posts one PR comment with a deep-link button: "Review with [Tool] →".
  - GH App also adds a permalink to the PR description (belt + suspenders for teams that hide bot comments).
  - Reviewer clicks → opens web app in full UX with the full PR state. On submit, web app posts the review back to GitHub via API.
- **Install model: GH App org-level install + per-user OAuth.**
  - Admin installs the App once for the org. Default = all repos enabled; opt-out per repo at install time.
  - Each reviewer signs into the web app via GitHub OAuth (one-time).
  - Org owns billing + audit. Individual owns their private mind-map.
- Browser extension explicitly rejected. See ADR 0001.

## Reviewer Flow

### 1. Activation (cost gate)

- PR opens → GH App posts deep-link comment. **No compute fires.**
- First human click on the button → PR enters **ACTIVATED** state. Full brief computes.
- After ACTIVATED: subsequent pushes trigger **debounced** (30–60s) delta-brief recompute. Coalesces commit storms, force-pushes, rebases into a single recompute. Cancels in-flight on newer push.
- Skipped while PR is in draft.
- Pre-activation pushes: ignored.
- No config knob. Reviewer who wants forced refresh uses the in-app "Refresh brief" button (UI affordance, not a setting).

### 2. Pre-Review Brief

Computed on activation. Cached by commit SHA — re-opens are instant.

The brief contains:

- **Human-readable change summary.** What this PR does, in plain English.
- **Multi-tag categorization per chunk.** Each diff chunk is tagged with categories describing *intent*, not opinion:
  - `pure-move`, `move-with-edits`, `lib-bump`, `logic-refactor`, `new-feature`, `bugfix`, `schema-change`, `test-only`, `config-only`, `generated-code`, `dependency-update`.
  - Chunks may carry multiple tags. The **dominant category** is surfaced as primary; others as secondary tags.
- **Per-category templated playbook.** Known engineering checklists per change type. Not AI hypotheses — domain rules. *(DEMOTED 2026-06-13: not a human headline panel — D, a senior, called it noise. It becomes agent-facing guidance + an optional, off-by-default junior UI, and the seed of the comment-to-rule loop. See `center-of-gravity.md`.)*
  - Example — `pure-move`: verify bytes identical, imports updated, no hidden edits.
  - Example — `lib-bump`: verify breaking changes from changelog, all call sites updated.
  - Example — `schema-change`: verify migration reversibility, backfill plan, downstream consumers.
- **Risk-surface attributes** (factual flags, not verdicts). Attached to chunks: `touches-auth`, `no-tests`, `mutates-state`, `external-io`, `removes-validation`, etc.
- **Section highlighting in diff view.** When reviewer scrolls into a tagged chunk, an inline header floats showing category + playbook items + risk-surface tags.
- **"Critical areas" verdict explicitly rejected** — replaced by risk-surface attributes. Reviewer decides what matters. See ADR 0002.
- **Free-form AI verification questions explicitly rejected** for v1. Anchoring risk.

### 3. Reviewer Writing — "No AI-Authored Comments"

- **Primary path (E):** human writes the comment cold. After comment is drafted, agent validates (factual? misunderstood the code? misses adjacent issue?). Reviewer revises or submits.
- **Secondary path (C):** agent offers *structured seeds* for stuck reviewers — `{ category, location, issue-shape }`, not text. Reviewer expands the seed into their own sentence.
- **Hard rule:** no AI-authored text ever ships as a comment.
- **Persistent agent chat panel** is available throughout — reviewer can ask questions about code, intent, sections at any time. Chat history persists per (PR × reviewer).

### 4. Missed-Points Pass — Category-Scoped Only

- **No general bug hunt in v1.** Tool does *not* run a Greptile/CodeRabbit-style line-level bug-finder.
- **Category-scoped checks only.** "Missed points" surfaces structural gaps tied to the brief's categories and risk surface:
  - "Risk-surface flag #3 not addressed by any comment or dismissal."
  - "lib-bump playbook item 4 of 8 not visited."
  - "pure-move chunk regressed — gained edits since last commit."
- **v1.5 add-on (B):** orchestrate competitor bug-catchers (CodeRabbit, Greptile). Ingest their comments, dedupe against reviewer's own, surface gaps.
- See ADR 0003.

### 5. Review Discussion (Private Mind-Map) — DEMOTED (2026-06-13)

> Shrunk to **persistence only** (draft comments, per-chunk read state, comment-target tracking — the State Persistence section below). The "private place to think / discuss with the agent" framing is **cut**: interview D and the founder both questioned its benefit over a GitHub pending review you don't submit. Revisit ADR 0004. Bullets below describe the old fuller version.

- Agent ↔ Reviewer discussion lives **entirely inside the web app**. Never visible on the PR thread.
- Reviewer can challenge agent, dismiss flags, ask clarifying questions, draft and discard ideas — without performing competence for the author.
- Outcomes only ship to PR: the reviewer's final comments + the receipt.
- Selective "promote to PR thread" affordance deferred to v1.5+.

### 6. Warning Before High-Stakes Dismissal

- When a reviewer dismisses a high-confidence flag with an empty or short-generic reason ("fine", "ok"), the tool surfaces a warning before submit.
- Warning does **not** block — reviewer authorizes. Receipt records the dismissal + reason verbatim.
- Reduces dismissal-as-rubber-stamp on items where AI is most confident, without nagging on low-stakes ones.

### 7. Final Review Submission — Native Review + Linked Receipt

- Reviewer's final approval/changes-requested/comment ships to GitHub as a **normal review** (via GH API), under the reviewer's identity. Reads as a hand-written human review.
- The only tool footprint is a **signature line** appended to the review: `Reviewed with [tool] — summary`, linking to a static **Review Summary** (per-submission permalink, tool-hosted, frozen at submit).
- The **Review Summary** renders the scoped verification **receipt** + analysis context:

  ```
  Reviewed by @reviewer (human)
  Tool verification receipt:
     ✓ pure-move integrity: 3/3 chunks bytes-identical
     ✓ lib-bump (axios 1.x→2.x): changelog §3.2 cross-checked, 8/8 call sites visited
     ✓ risk surface: 5/5 flagged hunks addressed (4 commented, 1 dismissed with reason)
     ⚠ not checked: business intent, performance under load, integration with billing service
  ```

- Receipt is **scoped to mechanical claims only** — never "this PR is good". Delivered via the linked Review Summary, not inlined into the review body. See ADR 0002 (incl. 2026-06-07 delivery refinement).

## Multi-Reviewer PRs (Hybrid Model)

- **Shared brief, private thinking, aggregate receipt.**
  - Pre-review brief (categories, playbooks, risk-surface flags) computed once per SHA, shared across all reviewers on the PR.
  - Each reviewer has their own private mind-map space (drafts, chat, read state, intents).
  - Receipt aggregates across reviewers — "3 reviewers, 5/5 flags addressed across them, 2 dismissals with reasons".

## Compute & Caching

- Brief precomputed on activation, cached by commit SHA.
- Subsequent pushes → debounced (30–60s) delta compute.
- Cache invalidated on new SHA, regenerated lazily on next read.
- PRs that pass N days stale → mind-map space archived/purged (cost discipline).

## Delta Brief (v1 Must-Have)

The hardest rubber-stamp pool is re-review after small follow-up commits. Delta brief makes that case explicit.

When reviewer revisits a PR after the author pushed new commits, the delta brief surfaces:

1. **New chunks tagged** since last review (which categories were added).
2. **Flag resolution status** — addressed / not-addressed / regressed for each previously flagged risk surface.
3. **Comment-target tracking** — reviewer's prior comments: still anchored / target moved / orphaned.
4. **Playbook delta** — "lib-bump: was 8/8 call sites visited last time, now 8/11. 3 unverified."
5. **Net receipt diff** — what changed for the receipt if reviewer re-approved as-is.

## AI Failure Modes (Designed-For)

- **Wrong category.** Every chunk's category is reviewer-editable in one click. Tool re-applies the new playbook. Receipt records "N chunks reclassified by reviewer".
- **Low confidence.** AI outputs below confidence threshold are surfaced with an explicit "uncertain" label — reviewer chooses a category or skips. AI never silently hides uncertainty.
- **AI offline / provider outage.** Soft-fail. Tool stays usable as a thinking-space surface. Receipt explicitly says "no AI verification performed — outage". Reviewer's manual review still records and submits.

## State Persistence (per PR × reviewer)

Survives across sessions:
- Draft comments not yet submitted
- Agent chat history
- Per-chunk read state ("I've reviewed 8 of 15")
- Per-flag intent ("planning to dismiss flag #3, draft reason in progress")
- Reviewer-edited category overrides

Boundaries:
- Nothing persists across reviewers — see Multi-Reviewer section.
- Nothing persists across PRs.
- On rebase / force-push: best-effort re-anchor of comment targets by content hash + position. Orphaned items flagged explicitly to the reviewer for re-anchoring.
- Receipt only finalizes on submit.

---

## Out of Scope (v1)

- Pair programming / in-editor AI suggestions
- CI / lint integration
- Production observability / post-incident review
- Infra-as-code reviews, data/SQL review (could come later)
- Security/compliance gatekeeping (adjacent — not the wedge)
- Bug-finding in the general line-level sense (D from grilling — see ADR 0003)
- Browser extension surface (rejected — see ADR 0001)
- Config knobs on trigger behavior (manual mode etc.) — only if customer pull
- Selective promote of agent chat into public PR thread (deferred to v1.5+)

## Open Questions (Not Resolved in Grilling)

- Pricing model and ICP — deferred to a separate session.
- Edge case: two reviewers dismiss the same flag with different reasons — show both, or latest attributed? (UX detail.)
- Specifics of "uncertain" threshold calibration (per-category? per-playbook? global?).
- Onboarding-time POC flow for individuals (bottoms-up adoption before admin install).

---

## Author Side (PROMOTED to v1, secondary — 2026-06-13; still not grilled)

> **Reshape:** the author side moved from a deferred v2 placeholder to a real (secondary) v1 surface — the same brief, one step earlier, so re-review is *prevented* before submit (the draft-first self-review window). Shape in `center-of-gravity.md` ("Author view"). **Still needs its own grilling pass; hold scope loosely** — keep it on the same web app, not a separate IDE/CLI surface. Original bullets below preserved as raw input to that session.

### Pre PR submission
1. Human readable change summary
1. Critical code areas ? (might mislead reviewer)
1. Section highlighting with details above in diff view
1. User pre-review questions
1. Agent presents key questions before submission

### Pre Confirmation
1. "Are you sure you want to submit this PR?" -> present some issue if exist before doing so

### Post review
1. Assist with understanding the comments (in diff view if necessary)
1. Allow asking agent questions and validate comments
1. Trigger fix

### Reply to reviewer
1. No pure AI only code review replies (agent assitance provided)
