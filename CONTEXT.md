# Code Review Tool — Context

Comprehension scaffolding for human reviewers of pull requests. Not another reviewer bot. The tool's job is to restore *engagement* and *comprehension* to code review in an AI-authored world, by re-unitizing the diff from "lines" to "categorized chunks with playbooks", and by separating AI assistance from AI authorship.

> This file defines the *meaning* of each term. For the authoritative closed list of valid labeling **tokens** (the current Category / Concern / Role / Risk-Surface values + quick rules), see `docs/mvp/labeling-schema.md` — the controlled vocabulary. A token is not valid unless registered there.

> **Emphasis note (2026-06-13 reshape):** the *terms* below are still valid, but their product weight changed — see `docs/mvp/center-of-gravity.md` for the current center of gravity (story + risk-surface + delta; velocity-through-quality). In short: **Playbook** is demoted (agent-facing + optional junior UI, not a human headline); **Mind-Map Space** shrinks to persistence only (the "thinking space" framing is cut); the **Analysis Layer** is the engine, not the moat. This file describes vocabulary, not priority.

## Language

**Brief**:
The comprehension artifact the tool produces for a PR — summary, multi-tag categorization per chunk, per-category playbooks, risk-surface attributes. Computed eagerly on push (see **Trigger**), cached by commit SHA. Each Brief carries a PR-global **index** (the Nth distinct head SHA briefed for this PR — shared across reviewers, never per-reviewer) and the **commit range** it covers (the whole PR, base→head). A Brief also surfaces the PR's shipped **Comments** (from all reviewers) with their GitHub-native **outdated** status, for display only — *which change resolved which comment* is the **Delta Brief**'s job, not the Brief's.
_Avoid_: report, analysis, AI summary, brief number (for index)

**Delta Brief**:
The comprehension artifact for re-review — what changed for THIS reviewer's mental model since they last looked: new chunks tagged, flag resolution status, comment-target tracking, playbook delta, net receipt diff. Computed as a diff between two states (the reviewer's **Checkpoint** tree and the current head tree), not a replay of commits — so it is well-defined across rebases and force-pushes. Exists only when the reviewer has a Checkpoint (a prior submitted review); a first-time reviewer gets the full **Brief**, no Delta.
_Avoid_: incremental brief, diff-of-diff (informal only), update

**Checkpoint**:
The commit SHA at which a given reviewer last *submitted* a review. The baseline from which that reviewer's **Delta Brief** is computed (Checkpoint → current head). Advances on review submission, never on mere viewing; distinct per reviewer, so two reviewers can hold different Checkpoints on the same PR and therefore receive different Delta Briefs.
_Avoid_: baseline (informal), last-seen, watermark

**Session baseline**:
The SHA a reviewer is *currently viewing* in an in-progress review, before they submit. A follow-up commit that lands mid-review is shown **in-tool** relative to this session baseline ("what changed since you opened") via the same delta machinery — **not** relative to the durable **Checkpoint**, which advances only on submit. Transient and per-session; the **Fast-lane** or full **Delta Brief** of a mid-review follow-up anchors here, and carry-over runs against the reviewer's *draft* comments rather than Settled flags.
_Avoid_: working SHA (informal), draft checkpoint

**Revision changes**:
The shared, per-revision marking on a full **Brief** that highlights which lines are new in *this* revision versus the immediately previous briefed head (prevHead→head). Computed mechanically from the two head trees — never the per-reviewer **Delta Brief**, never reviewer-relative: every reviewer of a given head sees the same marking. Surfaced as an on-by-default toggle on the **Story view**; hovering/focusing a marked run *may* surface the matching **Change-group** summary when a shared delta narrative for that span already exists, but the marking itself needs no generation. Answers "what moved in this push" — distinct from the **Delta Brief**'s "what changed since *I* last looked", and absent on the first **Brief** (no previous head).
_Avoid_: delta (reserved for the per-reviewer artifact), delta overlay, blue diff, revision delta

**Carry-over status**:
How a prior **Flag** is classified in a **Delta Brief** relative to this reviewer's **Checkpoint**. One of: **New** (not present at the Checkpoint); **Reopened** (the reviewer had addressed or dismissed it and its region was touched in the span — so the prior decision must be re-made); **Settled** (addressed/dismissed and its region untouched — the prior decision still holds; FE may gloss as "still holds"); **Dropped** (the attribute no longer fires at head — the risk condition is gone, independent of any reviewer action). Decision order: Dropped → Reopened → Settled → New. Reopen is purely positional — *any* change to the flagged region reopens; meaningfulness is never inferred. On ambiguity, classify as Reopened, never Settled.
_Avoid_: still-resolved, cleared, gone, stale, resolved (as state names)

**Comment anchoring**:
How a prior comment is placed in a **Delta Brief** once head has moved. A shipped **Comment** (GitHub-native) carries GitHub's own position/outdated tracking — we read it, not recompute it. A **Flag** or an unshipped draft (**Mind-Map Space**) is anchored by us via the span's positional line-map: **moved** (relocated to a new line) or **orphaned** (its target line is gone). Ambiguous → orphaned / needs re-look, never silently dropped.
_Avoid_: re-anchor (informal), outdated (GitHub's word, only for shipped comments)

**Chunk**:
A contiguous run of changed lines sharing **one Concern and one Change-group** — the atomic unit of the brief. A chunk is *sub-file*: a single git hunk may be **split into multiple chunks** at concern/group boundaries, and one file's chunks may land in different Change-groups. Each chunk has one Concern, one Role, one Categorization-by-inheritance (from its group), zero or more Risk Surface attributes, and its own LoC.
_Avoid_: hunk (a chunk may be finer than a git hunk), file, diff block
_Limitation_: a chunk cannot express multiplicity *interleaved within one inseparable contiguous span* (e.g., move and logic-fix woven line-by-line). That is the deferred sub-operation tree (ADR 0005); until then, express it via dominant+secondary Categorization on the group plus a prose callout in the Summary.

**Change-group**:
A cluster of chunks that together accomplish one coherent piece of work (e.g., "fix the cross-param leak"). The unit of *intent* — it carries the Categorization and the summary. Spans files and Concerns: one or more carrier chunks (the intent's implementation may span files) plus zero or more supporting test/doc/spec chunks. The Story view pivots the brief by Change-group.
**Boundary rule:** one group = the largest chunk set expressible as ONE Summary + ONE Dominant Category. If a set needs two unrelated summaries, split it. Author commit structure is a *hint* for understanding intent, never the boundary itself. A single-intent PR is one group; a grab-bag PR (fix + lib bump + README typo) is several.
_Avoid_: chapter (Linear's narrative-only term), story, cluster, section

**Category**:
A taxonomy entry describing the *intent* of a Change-group, not opinion about it. Examples: `pure-move`, `move-with-edits`, `lib-bump`, `logic-refactor`, `new-feature`, `bugfix`, `schema-change`, `dependency-update`. Category answers "what kind of change"; Concern answers "what kind of artifact" — they are orthogonal axes.
_Avoid_: type, classification, label, tag, kind. ("Label" and "tag" are not used in product or UX language — Category is the single word.) Also: `test-only`, `config-only`, `generated-code` are NOT Categories — they were artifact-concerns masquerading as intent; they are now Concern values.

**Categorization**:
The result of categorizing a Change-group: one or more Categories attached to that group, exactly one of which is the Dominant Category. A group has one Categorization; a Categorization contains one or more Categories. A group that is "mostly a bugfix but includes a move" has `{ dominant: bugfix, secondary: [pure-move] }` — this expresses sub-operations without a formal sub-chunk tree.
_Avoid_: tags, labels (plural informal usage), classification

**Dominant Category**:
The single Category surfaced as primary when a Change-group's Categorization contains multiple Categories.
_Avoid_: main tag, primary type, main label

**Concern**:
The artifact a chunk touches: `implementation`, `test`, `doc`, `spec`, `config`, `generated`. Orthogonal to Category. Mostly derivable from file path. The Concern view pivots the brief by Concern to route attention — how much of the PR is real implementation vs supporting scaffolding. Default resolution of the overloaded "spec": `spec` = specification document (distinct from `doc`); `.spec.ts`/`.test.ts` files map to `test`.
_Avoid_: production (env-restrictive), file-type, type, bucket

**Role**:
Whether a chunk is the `carrier` of its Change-group's intent or `supporting`. Default: `implementation` concern → carrier; `test`/`doc`/`spec`/`config` → supporting. Flippable when a supporting artifact is itself the purpose (e.g., a flaky-test fix makes the test chunk the carrier, and it then takes the group's intent).
_Avoid_: primary/secondary (collides with Dominant/secondary Category), main, lead

**Summary**:
The descriptive sentence(s) of what a Change-group changed. Lives on the group. Descriptive *what*, never narrative *why* — the why belongs in the PR description and the linked issue. Narrative drift collapses the wedge into Linear Diffs' lane.
_Avoid_: description, explanation, story, narrative

**LoC**:
Added/deleted line counts. Shown non-prominently (corner) per Category in the Story view and per Concern bucket in the Concern view. An attention-routing *distribution* — never a headline size verdict. "Where is the real change", not "how big is this". The displayed value is **adjusted LoC**, not raw git: `pure-move` lines show as a `moved N` badge (excluded from +added/−deleted, since net logic change is zero); the `generated` Concern is a separate collapsed bucket excluded from the implementation/test/doc split by default. Adjusted numbers carry a visible badge marking them as adjusted; the raw **git LoC** is revealed on click. The two will not match GitHub's header at a glance — intentional, and the click reconciles it. The name is **adjusted** (not "weighted") deliberately: it excludes only *mechanically detectable* lines — moves and generated — never hand-judged significance, so two labelers and the Phase 2 categorizer reproduce it identically. A future **signal LoC** could additionally exclude blank/punctuation/import lines, but only by a deterministic rule, never by judgment.
_Avoid_: diff size, churn, lines-changed-as-quality-metric, raw LoC (as the default display)

**Playbook**:
A templated, domain-rule checklist of items to verify for a given category. Not AI-generated hypotheses — known engineering checklists per change type. Example for `lib-bump`: "verify breaking changes from changelog, all call sites updated."
_Avoid_: checklist, rules, review template

**Risk Surface**:
The set of factual attributes attached to a chunk. Attributes only — never verdicts. Severity (when needed) emerges from the *combination* of attributes, never from a graded prefix on any single attribute. Three-bucket structure: **about the code** (e.g., `no-tests`, `legacy-area`), **about the change** (e.g., `touches-auth`, `mutates-state`, `removes-validation`), **about the blast radius** (e.g., `external-io`, `widely-imported`, `cross-service`). Full library in `docs/mvp/risk-surface.md`.
_Avoid_: critical area, hot spot, risky code, severity tag

**Flag**:
A single AI-surfaced item from the brief that requires reviewer attention — either a risk-surface attribute on a specific hunk, or a playbook item that hasn't been visited.
_Avoid_: issue, warning, finding

**Disposition**:
A reviewer's recorded decision on a **Flag** — either *addressed* (a **Comment** now targets it) or *dismissed* (with a reason). Anchored to the flagged code region (file, attribute, region@SHA), never to a brief-local id, so it survives regeneration and carries forward across re-reviews (ADR 0007/0008). Frozen into the **Receipt** on **Submit**.
_Avoid_: resolution (informal), flag status, decision (bare)

**Dismissal**:
The *dismissed* value of a **Disposition** — a reviewer's recorded decision **not** to act on a Flag, accompanied by a reason. Dismissals appear on the **Receipt** with the reason verbatim. (The other value is *addressed*.)
_Avoid_: ignore, skip, override

**Uncertain**:
The AI's explicit label on categorization or flag output when its confidence is below threshold. Forces human judgment exactly where AI is weakest.
_Avoid_: low confidence (informal only), unknown, maybe

**Receipt**:
The scoped tool-verification content: mechanical claims the tool verified, what it didn't check, the disposition of flags (addressed vs dismissed with reason), and the **Generation provenance** of the analysis. Never an "approval". Delivered via the **Review Summary** linked from the signature line on the GitHub review — not inlined into the review body.
_Avoid_: AI approval, stamp, attestation

**Generation provenance**:
Which provider, model, and effort produced a **Brief** or **Delta Brief** — recorded on the artifact and surfaced on the **Receipt** (and as an understated header label), so the reader always knows what generated the analysis and never mistakes it for a verdict. Becomes load-bearing once the provider can vary (BYOK / multiple SDKs).
_Avoid_: model tag, attribution, watermark, AI signature (collides with Signature line)

**Signature line**:
A single line appended to the native GitHub review ("Reviewed with [tool] — summary") linking to the static **Review Summary**. The only tool footprint on the GitHub review itself; the review otherwise reads as a normal human review.
_Avoid_: tool signature (informal), banner, badge

**Review Summary**:
A static, tool-hosted snapshot page produced when a reviewer submits, linked from the **Signature line**. Renders the **Receipt** plus the review's analysis context (which Change-groups, what was verified, dismissals with reasons). Static = frozen at submit time, per-submission permalink. The public face of the private **Mind-Map Space**'s output — the audit trail the author and org can open.
_Avoid_: report, dashboard, public mind-map

**Analysis Layer**:
The reviewer-agnostic core: Change-groups, Categorization, Playbooks, Risk Surface, Concern split, LoC. Consumed by the human **Engagement Layer** (v1) and, later, by AI-agent reviewers via API (v1.5+ headless lead-in). The product core and wedge — not yet a moat: taxonomy + playbooks are reproducible by incumbents once proven; durable defensibility must be earned later (see "Moat Honesty" in `docs/next-steps.md`).
_Avoid_: engine, backend, core (informal)

**Engagement Layer**:
The human-reviewer workflow built on the **Analysis Layer**: no-AI-authored-prose rule, Seeds, private Mind-Map Space, human-written Comments, Approval + Receipt. Human-only — does not apply to AI-agent reviewers. The v1 product surface.
_Avoid_: UI layer, frontend, workflow (informal)

**Mind-Map Space**:
The private (per reviewer × PR) workspace inside the web app where the reviewer thinks, drafts, asks the agent questions, dismisses flags, and refines comments — without that work being visible on the PR thread.
_Avoid_: workspace, scratchpad, draft space

**Trigger**:
What causes a **Brief** to compute: eager-on-push, debounced (~60s trailing), on PR-open (first push) and every subsequent push — including while the PR is a draft. No lazy "compute-on-first-click" gate; spend is bounded by debounce + **Triage** + skipping trivial/instantly-closed PRs, not by withholding compute. **Delta Briefs** are per-reviewer (from each reviewer's **Checkpoint**), not a push-triggered recompute. See ADR 0020.
_Avoid_: activation (as "what fires compute"), cost gate, click-to-activate

**Entry**:
How a human reaches a computed **Brief**: one branded PR comment carrying a deep-link (ADR 0016), delete+reposted per debounced generation, one ping per settled head. The reviewer-facing Entry posts only when the PR is non-draft (ready). The deep-link click is navigation, never a compute **Trigger**.
_Avoid_: activation (as "the click"), deep-link gate

**Draft-first**:
A per-repo opt-in (repo YAML; org default + per-repo override; off by default) that holds the reviewer-facing **Entry** until the author marks `ready_for_review`, turning the draft window into the author's self-review pass. It does **not** change the **Trigger** — the **Brief** still computes on every push during draft; draft-first only gates *when reviewers are notified*. Native-draft only (never a custom lock), so a generation failure leaves a normal GitHub draft the author controls. See ADR 0020.
_Avoid_: activation (as "turning the tool on"), draft mode, draft gate

**Triage**:
The cheap cascade run on every PR (and every follow-up) *before* any expensive generation, deciding both the *experience* and the *spend*: a free deterministic floor (dependency/migration/auth-config paths + size) → a small-model (**Haiku**) pass that judges trivial-vs-escalate and, when trivial, emits the **Fast-lane** view. Escalation produces the full **Brief** / **Delta Brief** (Opus); otherwise the fast-lane is shown with a manual upgrade. **Risk decides escalation, size decides spend**; for follow-ups, touching a reviewer's prior **Flag** or **Comment** (carry-over) is itself an escalation. Never a verdict, never a gate — the human can always upgrade.
_Avoid_: gate, pre-filter (informal), severity score

**Fast-lane**:
The compact, cheap view shown for a triaged-trivial PR or follow-up — a short summary (from the **Triage** model) over the diff, without the full **Brief** / **Delta Brief**, always upgradeable to the full brief on demand. The "daily mode" that keeps tiny low-surface changes from feeling like homework.
_Avoid_: lite brief, mini brief, summary-only (informal)

**Intent check**:
A secondary section of the **Brief** comparing the change's *stated intent* — a linked ticket (fetched from the PR description) or, failing that, the PR description itself — against what the diff actually does. When the intent source is *precise*, it reports three factual buckets: **accomplished**, **stated-but-missing**, **done-but-unstated**. When the source is *broad* (an epic/parent) or *absent*, it reports that the check is unavailable rather than guessing. Deliberately de-emphasized — the **Change-groups** carry the story; the intent check is the AI's fallible read, shown to both author and reviewer, never a verdict or focal point.
_Avoid_: requirements check, spec compliance, intent verdict

**Soft gate**:
A transient, non-blocking nudge shown to the **Author** at the ready-for-review handoff, surfacing unaddressed **Risk Surface** flags (primary, factual) and — only when the **Intent check** source is precise — stated-but-missing intent gaps (secondary). The author may fix or authorize; it never blocks and leaves no persistent author state (the author side has no **Dismissal** or **Receipt** of its own).
_Avoid_: pre-submit gate, block, author approval

**Comment**:
Reviewer-authored prose that ships to the PR. In this product, comments are never AI-authored — the agent provides structure (seeds) and post-hoc validation, but the reviewer writes the sentence.
_Avoid_: review comment, feedback (informal only)

**Seed**:
A structured, non-prose hint from the agent — `{ category, location, issue-shape }` — that a stuck reviewer can expand into their own comment. Seeds are scaffolding, not drafts.
_Avoid_: suggestion, draft, AI comment

**Approval**:
The reviewer's human judgment ("approve / request changes / comment") submitted to GitHub. Only humans approve. The tool issues a receipt, not an approval.
_Avoid_: AI approval, double approval, sign-off (when referring to the tool)

**Submit**:
A reviewer finalizing their review on GitHub (the **Approval** plus any **Comments**). The only event that advances the reviewer's **Checkpoint**, freezes their **Dispositions** into the **Receipt**, and produces the static **Review Summary** — mere viewing never does.
_Avoid_: send, post, finish (informal)

## Relationships

- A **PR** has at most one **Brief** per commit SHA. The brief is **shared** across reviewers.
- A **Brief**'s **index** is a PR-global ordinal over the *distinct head SHAs* briefed (shared, not per-reviewer); a **Delta Brief** spans the gap between two such SHAs.
- A **Brief** contains many **Chunks**, clustered into **Change-groups**. A chunk is a contiguous run of changed lines sharing one Concern and one Change-group; a git hunk may be split into multiple chunks, and one file's chunks may span multiple Change-groups.
- A **Change-group** has one **Categorization** (one or more **Categories**, exactly one **Dominant**), one **Summary**, and inherits a **Playbook** from its **Dominant Category**. A group spans one carrier chunk plus zero or more supporting chunks.
- A **Chunk** belongs to exactly one **Change-group**, has one **Concern**, one **Role** (carrier/supporting), zero or more **Risk Surface** attributes, and its own **LoC** (+added/−deleted).
- The brief is read through two pivots over the same chunk set: the **Story view** (by Change-group) and the **Concern view** (by Concern). LoC rolls up under both.
- A full **Brief** at a given SHA is shared across all reviewers of that SHA. A **Delta Brief** spans the *reviewer's* last-reviewed SHA → current head, so two reviewers at different checkpoints receive different Delta Briefs over different commit spans. The full Brief is the shared, per-SHA artifact; the Delta Brief is selected per reviewer by their baseline. New pushes (debounced) move the head, after which a fresh full Brief and new Delta Briefs become available.
- Each (PR × Reviewer) pairing has one private **Mind-Map Space**.
- A **Comment** belongs to a reviewer and ships to the PR. A **Seed** belongs to a chunk in the brief and never ships.
- A reviewer records a **Disposition** on a **Flag**: **addressed** (a **Comment** targets it) or **dismissed** (with reason). Dispositions are frozen into the **Receipt** on **Submit**.
- On submit, the review lands **natively on GitHub** (comments + approve/request-changes) authored by the reviewer. A **Signature line** links to the static **Review Summary**, which renders the **Receipt**. The review otherwise reads as a normal human review. Receipt aggregates across all reviewers when multi-reviewer.
- A **Brief**'s **Trigger** (compute) is independent of its **Entry** (human reach): compute fires eagerly on every push; the reviewer **Entry** comment posts only when the PR is ready. **Draft-first** changes only the Entry timing, never the Trigger.
- The **Analysis Layer** is reviewer-agnostic. A human reviewer consumes it through the **Engagement Layer** (v1). An AI-agent reviewer consumes it directly via API (v1.5+ headless) — the no-AI-prose rule and Mind-Map Space are human-mode only and do not apply to agent-mode.

## Example dialogue

> **PM:** "When the reviewer dismisses a **Flag**, does the **Author** see the agent's original reasoning?"
> **Eng:** "No — only the **Dismissal** + the reviewer's stated reason show on the **Receipt**. The agent's challenge stays inside the **Mind-Map Space**. The receipt is the public surface, the mind-map is the private one."

> **PM:** "What if the **AI** is wrong about the **Category** for a chunk?"
> **Eng:** "Reviewer reclassifies it in one click. The **Playbook** swaps automatically. The receipt notes 'N chunks reclassified by reviewer' — the tool stays honest about what it got and what the human corrected."

## Flagged ambiguities

- **"Critical area"** was rejected as terminology. It bundled *verdict* into what should be *attributes*. Resolved: split into **Risk Surface** (factual per-chunk attributes) and **Flag** (a specific item needing attention or dismissal).
- **"Approval"** was used ambiguously to mean reviewer judgment AND AI verification. Resolved: only humans **Approve**. The tool issues a **Receipt**, scoped to mechanical claims.
- **"Dismissal" vs "Disposition"** — *Dismissal* was used for the whole flag-decision concept. Resolved: **Disposition** is the umbrella (*addressed* or *dismissed*); **Dismissal** is only the *dismissed* value.
- **"User"** in early scope was ambiguous (author vs reviewer). Resolved: **Reviewer** is the primary v1 surface; the **Author** self-review surface is a *secondary* v1 surface (promoted 2026-06 — see ADR 0009 / `center-of-gravity.md`), consuming the same shared **Brief** plus the **Intent check** and **Soft gate**. Both are named explicitly when referenced.
- **"Critical code areas might mislead reviewer"** — the original concern was anchoring bias. Resolved by Risk Surface + Playbook + no-verdict model. Anchoring is the design's chief enemy at the brief layer.
- **"Pure AI code review comments"** was an informal phrase. Resolved as a strict product rule: the agent never authors prose that ships as a **Comment**. Seeds and validation only.
- **Intent lived on the chunk** in the original model. Resolved: intent (**Category**, **Summary**) lives on the **Change-group**; the chunk carries **Concern**, **Role**, and **LoC**. A test/doc chunk supports a group's intent rather than re-deriving its own. See ADR 0005.
- **`test-only` / `config-only` / `generated-code` as Categories** conflated *artifact* with *intent*. Resolved: these are **Concern** values, not Categories. Category is purely intent (what kind of change); Concern is artifact (what kind of file).
- **"spec" is overloaded** — `.spec.ts` test files vs specification documents. Resolved default: `spec` Concern = specification document; `.spec.ts`/`.test.ts` → `test` Concern.
- **"A file with multiple changes/concerns"** — resolved: the **Chunk** (not the file) is the atomic unit and is sub-file. Separable multiplicity (different intents or concerns in different parts of a file) is handled by splitting into multiple chunks across groups/concerns. *Interleaved* multiplicity within one inseparable contiguous span is the one unhandled case → deferred sub-operation tree (ADR 0005).
- **"production" rejected** as the carrier-concern name — bakes in a deployment assumption. Resolved: `implementation`.
- **"Activation"** was one word for three independent things — *what fires compute*, *how a human reaches the brief*, and *turning draft-first on*. The old definition (compute-on-first-click) also contradicted ADR 0006's eager-on-push generation. Resolved into **Trigger** (eager-on-push compute), **Entry** (the branded deep-link comment, posts on ready), and **Draft-first** (per-repo opt-in that gates Entry until `ready_for_review`, never the Trigger). "Activation" is retired. See ADR 0020.
- **"Consume an AI context manager (Unblocked) to flag cross-context issues"** was proposed as a brief feature. Rejected: a tool asserting AI-hypothesized "potential issues" is the **bug-bot the product is positioned against** (no-verdict rule; `center-of-gravity.md` "no bug-bot noise"; ADR 0003 category-scoped, not general). Resolved into three data-flows: (1) external context may **enrich the Intent check and Risk Surface with *cited* facts only** — cite-or-stay-silent, never a verdict; (2) AI *review* of the code is the **headless dual-consumer lane** — the org hooks its own agent to consume our **Brief**, and that agent owns its verdicts, not us (preserves no-verdict because we are the analysis substrate, not the reviewer); (3) the **comment-to-rule loop** is the inverse arrow (we *produce* repo-local agent context). Only (1) is a consume-side build, and it is deferred. See ADR 0014.
