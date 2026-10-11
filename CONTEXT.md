# Code Review Tool — Context

Comprehension scaffolding for human reviewers of pull requests. Not another reviewer bot. The tool's job is to restore *engagement* and *comprehension* to code review in an AI-authored world, by re-unitizing the diff from "lines" to "categorized chunks with playbooks", and by separating AI assistance from AI authorship.

> This file defines the *meaning* of each term. For the authoritative closed list of valid labeling **tokens** (the current Category / Concern / Role / Risk-Surface values + quick rules), see `docs/mvp/labeling-schema.md` — the controlled vocabulary. A token is not valid unless registered there.

> **Reading notes.** This file describes vocabulary, not priority — for the
> current product weighting see `docs/mvp/center-of-gravity.md` (story +
> risk-surface + delta). The project is **OSS-only**: no hosted arm, no moat.
> Entries still carrying hosted/headless/multi-reviewer phrasing (**Trigger**,
> **Delta Brief**, agent-via-API consumption) are design concepts that survive,
> not a go-to-market plan. The **Playbook** layer is parked to v2 — no product
> code consumes it, and entries mentioning playbooks describe the parked
> design, not v1 behavior.

## Language

**Brief**:
The comprehension artifact the tool produces for a PR — summary, multi-tag categorization per chunk, per-category playbooks, risk-surface attributes. Computed eagerly on push (see **Trigger**), cached by commit SHA. Each Brief carries a PR-global **index** (the Nth brief for this PR, retargets included — shared across reviewers, never per-reviewer; the `rev` a brief URL names) and the **commit range** it covers (the whole PR, base→head). A Brief also surfaces the PR's shipped **Comments** (from all reviewers) with their GitHub-native **outdated** status, for display only — *which change resolved which comment* is the **Delta Brief**'s job, not the Brief's.
_Avoid_: report, analysis, AI summary, brief number (for index)

**Delta Brief**:
The comprehension artifact for re-review — what changed for THIS reviewer's mental model since they last looked: new chunks tagged, flag resolution status, comment-target tracking, playbook delta, net receipt diff. Computed as a diff between two states (the reviewer's **Checkpoint** tree and the current head tree), not a replay of commits — so it is well-defined across rebases and force-pushes. Exists only when the reviewer has a Checkpoint (a prior submitted review); a first-time reviewer gets the full **Brief**, no Delta.
_Avoid_: incremental brief, diff-of-diff (informal only), update

**Checkpoint**:
The commit SHA at which a given reviewer last *submitted* a review. The baseline from which that reviewer's **Delta Brief** is computed (Checkpoint → current head). Advances on review submission, never on mere viewing; distinct per reviewer, so two reviewers can hold different Checkpoints on the same PR and therefore receive different Delta Briefs.
_Avoid_: baseline (informal), last-seen, watermark

**Session baseline**:
The SHA a reviewer is *currently viewing* in an in-progress review, before they submit. A follow-up commit that lands mid-review is shown **in-tool** relative to this session baseline ("what changed since you opened") via the same delta machinery — **not** relative to the durable **Checkpoint**, which advances only on submit. It is the **durable key of a Review Session** — the reviewer's unfinished work is stored against the **Brief** at this SHA, so a new Brief starts a new Review Session and the previous one becomes read-only. The **Fast-lane** or full **Delta Brief** of a mid-review follow-up anchors here, and carry-over runs against the reviewer's *draft* comments rather than Settled flags.
_Avoid_: working SHA (informal), draft checkpoint

**Comparison baseline**:
The earlier PR state the current **Brief** is compared against when comparison is enabled: either the shared **Previous Brief** or the reviewer's personal **Checkpoint**.
_Avoid_: baseline (bare), delta baseline

**Comparison overlay**:
The full-**Brief** view that marks and explains lines changed between the selected **Comparison baseline** and the current head; absent when comparison is off.
_Avoid_: delta overlay, blue diff

**Previous Brief**:
The immediately preceding full **Brief** for the same PR, used as the shared **Comparison baseline** for "what changed in the latest briefed revision."
_Avoid_: prior run, last brief (ambiguous with personal last review)

**Revision changes**:
The shared, per-revision **Comparison overlay** on a full **Brief** that highlights which lines changed versus the **Previous Brief** (prevHead→head). Computed mechanically from the two head trees — never the per-reviewer **Delta Brief**, never reviewer-relative: every reviewer of a given head sees the same marking. Answers "what moved in this push" — distinct from the **Delta Brief**'s "what changed since *I* last looked", and absent on the first **Brief** (no previous head).
_Avoid_: delta (reserved for the per-reviewer artifact), delta overlay, blue diff, revision delta

**Revision narrative**:
The shared, generated explanation of what changed between a **Brief** and the immediately previous **Brief** for the same PR (prevHead→head), used to summarize **Revision changes** on a full **Brief** without any reviewer-specific **Checkpoint** or carry-over state.
_Avoid_: Delta Brief, reviewer delta, update summary

**Reading order**:
The reasoned sequence over a **Brief**'s **Change-groups** — a strict permutation (each group appears exactly once, no revisits), each step carrying a one-line *why-this-next* rationale. The rule: **foundation-first** (groups whose changes other groups build on come first: schema/types → core logic → call sites/wiring), falling back to **context-first, churn-last** for independent groups (dominant-intent groups first; mechanically-known low-signal Categories such as `pure-move`, `lib-bump`, `dependency-update` last — keyed on Category, never a free-floating importance judgment). Orders the *existing* groups; it is never a new grouping and never exposes a score or rank label (no-verdict holds). Within-group order stays structural (core → supporting, Concern order). The **Unattributed remainder** is always the final step, placed there mechanically outside the reasoned permutation, with no rationale — it is leftover lines, not a decision about what to read next.
_Avoid_: narrative (reserved for generated text), story, layers/cohorts (Atlas's terms), walkthrough (CodeRabbit's term), importance/priority/severity (verdict language)

**Read-through**:
The experience of following the **Reading order**: stepping through **Change-groups** in sequence (keyboard next/prev, focus on the current group), end to end, once. The theatre sense — a first sequential pass through the whole piece. The Read-through follows the Reading order; it never reorders or filters it.
_Avoid_: walkthrough (CodeRabbit's term), tour (onboarding connotation), guided review

**Carry-over status**:
How a prior **Flag** is classified in a **Delta Brief** relative to this reviewer's **Checkpoint**. One of: **New** (not present at the Checkpoint); **Reopened** (the reviewer had addressed or dismissed it and its region was touched in the span — so the prior decision must be re-made); **Settled** (addressed/dismissed and its region untouched — the prior decision still holds; FE may describe as "still holds"); **Dropped** (the attribute no longer fires at head — the risk condition is gone, independent of any reviewer action). Decision order: Dropped → Reopened → Settled → New. Reopen is purely positional — *any* change to the flagged region reopens; meaningfulness is never inferred. On ambiguity, classify as Reopened, never Settled.
_Avoid_: still-resolved, cleared, gone, stale, resolved (as state names)

**Comment anchoring**:
How a prior comment is placed in a **Delta Brief** once head has moved. A shipped **Comment** (GitHub-native) carries GitHub's own position/outdated tracking — we read it, not recompute it. A **Flag** or an unshipped **Line comment** draft (**Review Session**) is anchored by us via the span's positional line-map: **moved** (relocated to a new line) or **orphaned** (its target line is gone). Ambiguous → orphaned / needs re-look, never silently dropped. A **File comment** has no line: GitHub never marks it outdated; a draft follows the path, not a line-map.
_Avoid_: re-anchor (informal), outdated (GitHub's word, only for shipped comments)

**Chunk**:
A contiguous run of changed lines sharing **one Concern and one Change-group** — the atomic unit of the brief. A chunk is *sub-file*: a single git hunk may be **split into multiple chunks** at concern/group boundaries, and one file's chunks may land in different Change-groups. Each chunk has one Concern, one Role, one Categorization-by-inheritance (from its group), zero or more Risk Surface attributes, and its own LoC. Lines in the **Unattributed remainder** are still chunks: they belong to that group and carry no Concern, no Role, no Risk Surface and no inherited Categorization — only their file, ranges and LoC.
_Avoid_: hunk (a chunk may be finer than a git hunk), file, diff block
_Limitation_: a chunk cannot express multiplicity *interleaved within one inseparable contiguous span* (e.g., move and logic-fix woven line-by-line). That is the deferred sub-operation tree; until then, express it via dominant+secondary Categorization on the group plus a text callout in the Summary.

**Sibling span**:
A contiguous stretch of expanded rows that belongs to another chunk of the same file, framed and labelled with its owner. Never a chunk of its own: its rows keep their add and del colours, a comment placed on them anchors to the owning chunk, and the frame's control jumps to that chunk.
_Avoid_: borrowed lines, foreign hunk

**Change-group**:
A cluster of chunks that together accomplish one coherent piece of work (e.g., "fix the cross-param leak"). The unit of *intent* — it carries the Categorization and the summary. Spans files and Concerns: one or more core chunks (the intent's implementation may span files) plus zero or more supporting test/doc/spec chunks. The Story view pivots the brief by Change-group.
**Boundary rule:** one group = the largest chunk set expressible as ONE Summary + ONE Dominant Category. If a set needs two unrelated summaries, split it. Author commit structure is a *hint* for understanding intent, never the boundary itself. A single-intent PR is one group; a grab-bag PR (fix + lib bump + README typo) is several.
**Exception:** the **Unattributed remainder** is a Change-group with no Summary and no Categorization — leftover lines, not an intent. Never split, never merged into an intent group.
_Avoid_: chapter (Linear's narrative-only term), story, cluster, section

**Unattributed remainder**:
The set of changed lines no attributed **Chunk** claimed. It is a **Change-group** of unattributed chunks — the one exception to the intent boundary: no Summary, no Categorization, never split, never merged into an intent group. Its name and one-line note are fixed system copy, not model output; its chunks carry no Concern, Role or Risk Surface. In the **Concern view** it is one last segment of the Split, beside the Concerns, never a Concern itself.
_Avoid_: coverage gap, orphan lines, residue, unattributed (bare noun)

**Category**:
A taxonomy entry describing the *intent* of a Change-group, not opinion about it. Examples: `pure-move`, `move-with-edits`, `lib-bump`, `logic-refactor`, `new-feature`, `bugfix`, `schema-change`, `dependency-update`. Category answers "what kind of change"; Concern answers "what kind of artifact" — they are independent axes.
_Avoid_: type, classification, label, tag, kind. ("Label" and "tag" are not used in product or UX language — Category is the single word.) Also: `test-only`, `config-only`, `generated-code` are NOT Categories — they were artifact-concerns masquerading as intent; they are now Concern values.

**Categorization**:
The result of categorizing a Change-group: one or more Categories attached to that group, exactly one of which is the Dominant Category. A group has one Categorization; a Categorization contains one or more Categories. A group that is "mostly a bugfix but includes a move" has `{ dominant: bugfix, secondary: [pure-move] }` — this expresses sub-operations without a formal sub-chunk tree.
_Avoid_: tags, labels (plural informal usage), classification

**Dominant Category**:
The single Category surfaced as primary when a Change-group's Categorization contains multiple Categories.
_Avoid_: main tag, primary type, main label

**Concern**:
The artifact a chunk touches: `implementation`, `test`, `doc`, `spec`, `config`, `generated`. Independent of Category. Mostly derivable from file path. The Concern view pivots the brief by Concern to route attention — how much of the PR is real implementation vs supporting scaffolding. Default resolution of the overloaded "spec": `spec` = specification document (distinct from `doc`); `.spec.ts`/`.test.ts` files map to `test`.
_Avoid_: production (env-restrictive), file-type, type, bucket

**Role**:
Whether a chunk holds its Change-group intent (`core`) or serves it (`supporting`). Default: `implementation` concern → core; `test`/`doc`/`spec`/`config` → supporting. Flippable when a supporting artifact is itself the purpose (e.g., a flaky-test fix makes the test chunk the core chunk, and it then takes the group's intent).
_Avoid_: primary/secondary (collides with Dominant/secondary Category), main, lead

**Summary**:
The descriptive sentence(s) of what a Change-group changed. Lives on the group. Descriptive *what*, never narrative *why* — the why belongs in the PR description and the linked issue. Narrative drift collapses the wedge into Linear Diffs' lane.
_Avoid_: description, explanation, story, narrative

**LoC**:
Added/deleted line counts. Shown non-prominently (corner) per Category in the Story view and per Concern bucket in the Concern view. An attention-routing *distribution* — never a headline size verdict. "Where is the real change", not "how big is this". The displayed value is **adjusted LoC**, not raw git: `pure-move` lines show as a `moved N` badge (excluded from +added/−deleted, since net logic change is zero); the `generated` Concern is a separate collapsed bucket excluded from the implementation/test/doc split by default. Adjusted numbers carry a visible badge marking them as adjusted; the raw **git LoC** is revealed on click. The two will not match GitHub's header at a glance — intentional, and the click reconciles it. The name is **adjusted** (not "weighted") deliberately: it excludes only *mechanically detectable* lines — moves and generated — never hand-judged significance, so two labelers and the Phase 2 categorizer reproduce it identically. A future **signal LoC** could additionally exclude blank/punctuation/import lines, but only by a deterministic rule, never by judgment.
_Avoid_: diff size, churn, lines-changed-as-quality-metric, raw LoC (as the default display)

**Playbook**:
A templated, domain-rule checklist of items to verify for a given category. Not AI-generated hypotheses — known engineering checklists per change type. Example for `lib-bump`: "verify breaking changes from changelog, all call sites updated." **Parked to v2:** no v1 surface renders or consumes playbooks; if revived, the identity is a *coverage rubric* — post-hoc measurement of a finished review (check-off frozen into Receipts, or grading an agent's review), never prompt material for reviewers or agents.
_Avoid_: checklist, rules, review template

**Risk Surface**:
The set of factual attributes attached to a chunk. Attributes only — never verdicts. Severity (when needed) emerges from the *combination* of attributes, never from a graded prefix on any single attribute. Three-bucket structure: **about the code** (e.g., `no-tests`, `legacy-area`), **about the change** (e.g., `touches-auth`, `mutates-state`, `removes-validation`), **about the blast radius** (e.g., `external-io`, `widely-imported`, `cross-service`). Full library in `docs/mvp/risk-surface.md`.
_Avoid_: critical area, hot spot, risky code, severity tag

**Flag**:
A single AI-surfaced item from the brief that requires reviewer attention. In v1 this means a risk-surface attribute on a specific hunk; unvisited-playbook-item flags are parked with the playbook layer.
_Avoid_: issue, warning, finding

**Risk note**:
Chunk-specific factual evidence for why a **Risk Surface** attribute fired on that **Chunk**. Carried on the chunk (`riskNotes`) and copied onto the matching **Flag**. Distinct from the attribute's catalog implication, which is the same sentence on every file.
_Avoid_: description (ambiguous with the catalog implication), reason (collides with Dismissal)

**Disposition**:
A reviewer's recorded decision on a **Flag** — either *addressed* (a **Comment** now targets it) or *dismissed* (with a reason). Anchored to the flagged code region (file, attribute, region@SHA), never to a brief-local id, so it survives regeneration and carries forward across re-reviews. The **Receipt** shows it as it stands at **Submit**; nothing freezes it, so the reviewer can still change it afterwards and a later Submit shows the change.
_Avoid_: resolution (informal), flag status, decision (bare)

**Dismissal**:
The *dismissed* value of a **Disposition** — a reviewer's recorded decision **not** to act on a Flag, accompanied by a reason. Dismissals appear on the **Receipt** with the reason verbatim. (The other value is *addressed*.)
_Avoid_: ignore, skip, override

**Uncertain**:
The AI's explicit label on categorization or flag output when its confidence is below threshold. Forces human judgment exactly where AI is weakest.
_Avoid_: low confidence (informal only), unknown, maybe

**Receipt**:
The scoped tool-verification content: mechanical claims the tool verified, what it didn't check, the disposition of flags (addressed vs dismissed with reason), and the **Generation origin** of the analysis. A view of the **Dispositions** as they stand at **Submit**, not a copy kept apart from them. Never an "approval". Delivered via the **Review Summary** linked from the signature line on the GitHub review — not inlined into the review body.
_Avoid_: AI approval, stamp, attestation

**Generation origin**:
Which provider, model, and effort produced a **Brief** or **Delta Brief** — recorded on the artifact and surfaced on the **Receipt** (and as an understated header label), so the reader always knows what generated the analysis and never mistakes it for a verdict. Becomes critical once the provider can vary (BYOK / multiple SDKs).
_Avoid_: model tag, attribution, watermark, AI signature (collides with Signature line)

**Signature line**:
A single line appended to the native GitHub review ("Reviewed with [tool] — summary") linking to the static **Review Summary**. The only tool footprint on the GitHub review itself; the review otherwise reads as a normal human review.
_Avoid_: tool signature (informal), banner, badge

**Review Summary**:
A static, tool-hosted snapshot page produced when a reviewer submits, linked from the **Signature line**. Renders the **Receipt** plus the review's analysis context (which Change-groups, what was verified, dismissals with reasons). Static = frozen at submit time, per-submission permalink. The public face of the private **Review Session**'s output — the audit trail the author and org can open.
_Avoid_: report, dashboard, public review session

**Analysis Layer**:
The reviewer-agnostic core: Change-groups, Categorization, Playbooks, Risk Surface, Concern split, LoC. Consumed by the human **Engagement Layer** (v1); the same analysis could later be consumed by an org's own AI agent through a clean internal API (engineering, not a go-to-market lever). The product core. Defensibility is **not** the game (the project is OSS-only — see `docs/vision.md`): taxonomy + playbooks are deliberately open and reproducible, distributed as a community markdown commons rather than guarded as a moat.
_Avoid_: engine, backend, core (informal)

**Engagement Layer**:
The human-reviewer workflow built on the **Analysis Layer**: no-AI-authored-text rule, Seeds, private Review Session, human-written Comments, Approval + Receipt. Human-only — does not apply to AI-agent reviewers. The v1 product surface.
_Avoid_: UI layer, frontend, workflow (informal)

**Review Session**:
The private (per reviewer × PR) workspace where the reviewer thinks, drafts, asks the agent questions, dismisses flags, and refines comments — without that work being visible on the PR thread. It is one reviewer's work on one PR, pinned to one **Session baseline** and stored on our own server: draft **Comments** and replies, per-**Chunk** read marks, **Change-group** reclassifications, **Dispositions**, and the chosen outcome. A new **Brief** starts a new Review Session and prior work is carried onto it; the previous session becomes read-only.
_Avoid_: Mind-Map Space (retired 2026-08-17), workspace, scratchpad, draft space

**Installation**:
One install of the MergeBrief GitHub App on one GitHub organization or user account. A repository belongs to exactly one Installation. A **Reviewer** can reach several; every request finds its Installation from the repository it names, and no credential holds a current one. As a **Source** value (stored `installation`, key `INSTALLATION`): a pull request reported by the App's webhooks, belonging to an Installation.
_Avoid_: tenant (the API's storage noun), org (GitHub's word; an Installation can sit on a user account), workspace

**Source**:
Which way a pull request entered MergeBrief: **Installation** or **URL**. Column `source`, map `PullRequestSources`.
_Avoid_: world, door, origin (collides with **Generation origin**)

**URL**:
A **Source** value (stored `url`, key `URL`): a pull request one **Reviewer** added by pasting its URL. It belongs to that reviewer and no webhook reports on it. "Box" names a spot on the screen, not a concept; the input on Home gets no term.
_Avoid_: pasted-URL, url-box, twin

**Live read**:
Reading a **URL** pull request's facts from GitHub at request time: at paste, on Inbox load, on Brief open. A row read within the last five minutes is not read again; a merged one never is.
_Avoid_: refresh (means token refresh), sync (GitHub's push action), status check (GitHub's CI term)

**Unreachable**:
A **URL** pull request GitHub no longer shows to this reviewer. The row and its **Brief** stay, its facts stop updating, and Delete stays available.
_Avoid_: stale (means newer commits exist)

**Trigger**:
What causes a **Brief** to compute: eager-on-push, debounced (~60s from the first push, which fixes the start time; later pushes only swap the head), on PR-open (first push) and every subsequent push — including while the PR is a draft. No lazy "compute-on-first-click" gate; spend is bounded by debounce + **Triage** + skipping trivial/instantly-closed PRs, not by withholding compute. **Delta Briefs** are per-reviewer (from each reviewer's **Checkpoint**), not a push-triggered recompute.
_Avoid_: activation (as "what fires compute"), cost gate, click-to-activate

**Entry**:
How a human reaches a computed **Brief**: one branded PR comment carrying a deep-link, delete+reposted per debounced generation, one ping per settled head. The reviewer-facing Entry posts only when the PR is non-draft (ready). The deep-link click is navigation, never a compute **Trigger**.
_Avoid_: activation (as "the click"), deep-link gate

**Draft-first**:
A per-repo opt-in (repo YAML; org default + per-repo override; off by default) that holds the reviewer-facing **Entry** until the author marks `ready_for_review`, turning the draft window into the author's self-review pass. It does **not** change the **Trigger** — the **Brief** still computes on every push during draft; draft-first only gates *when reviewers are notified*. Native-draft only (never a custom lock), so a generation failure leaves a normal GitHub draft the author controls.
_Avoid_: activation (as "turning the tool on"), draft mode, draft gate

**Generation**:
The persisted record of producing a **Brief** for one head of one PR, which the worker projects its progress onto. A Generation is pending, running, or finished (succeeded, failed, superseded, capped). Each paid try at it, graphile retries included, is one attempt, and attempts are what the daily cap counts. A running Generation is held by its **Claim**. Never a queue. A **Job** that runs with a stored Brief is not a Generation: it produces no Brief and adds no attempt.
_Avoid_: job (that is the **Job**), run (a run id names a **Claim**, not the record), generation job

**Claim**:
The hold one attempt has on a **Generation**: a run id plus a 2-minute lease its holder renews while it works. Only the holder advances, finishes or releases the Generation; a lapsed lease frees it for the next attempt. A **Job** that finds the Brief already stored settles an unheld Generation as succeeded without one.
_Avoid_: lock (graphile's lock is on the **Job**), lease (one part of the Claim)

**Job**:
The unit of queued work the worker picks up to drive one **Generation**. A Job is queued until its debounce elapses, then held by one **Slot** while it runs. One Job per PR at a time; a new push coalesces into the existing queued Job.
_Avoid_: task, generation (the record), queued generation

**Slot**:
One concurrent **Job** a worker process admits. The slot count is the operator's throughput knob; one slot serializes every Brief behind whichever Job holds it.
_Avoid_: thread, concurrency (as a noun for the thing), lane

**Queued**:
Said of a **Job** waiting on its debounce or on a free **Slot**, never of a **Generation**. A Generation whose Job has started is running.
_Avoid_: queued generation, pending job

**Wait reason**:
Why a pending **Generation** has not started, read off its **Queued** **Job**: `debouncing` while the Job's start time is still ahead, `waiting-for-slot` once it is due and no **Slot** has claimed it. The server computes it on the PR meta only; an absent reason means the generic pending line, and a Generation that is not pending never carries one.
_Avoid_: queue status, pending reason, delay reason

**Triage**:
The cheap cascade run on every PR (and every follow-up) *before* any expensive generation, deciding both the *experience* and the *spend*: a free deterministic floor (dependency/migration/auth-config paths + size) → a small-model (**Haiku**) pass that judges trivial-vs-escalate and, when trivial, emits the **Fast-lane** view. Escalation produces the full **Brief** / **Delta Brief** (Opus); otherwise the fast-lane is shown with a manual upgrade. **Risk decides escalation, size decides spend**; for follow-ups, touching a reviewer's prior **Flag** or **Comment** (carry-over) is itself an escalation. Never a verdict, never a gate — the human can always upgrade.
_Avoid_: gate, pre-filter (informal), severity score

**Fast-lane**:
The compact, cheap view shown for a triaged-trivial PR or follow-up — a short summary (from the **Triage** model) over the diff, without the full **Brief** / **Delta Brief**, always upgradeable to the full brief on demand. The "daily mode" that keeps tiny low-surface changes from feeling like homework.
_Avoid_: lite brief, mini brief, summary-only (informal)

**Intent check**:
A secondary section of the **Brief** comparing the change's *stated intent* — the PR title, the PR description, and the **Primary ticket** when one is read — against what the diff actually does. When the sources are *precise*, it reports five factual buckets: **accomplished**, **stated-but-missing**, **done-but-unstated**, **deviations**, **claimed-but-unachieved**; the last two carry an alarm register and drop unless grounded on both sides. When the sources are *broad* (an epic/parent) or *absent*, it reports that the check is unavailable rather than guessing. It also carries the **Ticket alignment** read. Deliberately de-emphasized — the **Change-groups** carry the story; the intent check is the AI's fallible read, shown to both author and reviewer, never a verdict or focal point.
_Avoid_: requirements check, spec compliance, intent verdict

**Ticket alignment**:
The **Intent check**'s read of how the diff relates to the **Primary ticket**'s goal: `aligned` (delivers the goal), `partial` (serves it, one slice — an ordinary outcome), or `misaligned` (does not serve it, or reaches it by a way the ticket rules out). Carries the ticket's goal quoted verbatim and one factual sentence about the diff. Absent when there is no primary ticket, the ticket could not be read, or the sources are broad or absent. Never a gate.
_Avoid_: alignment score, ticket verdict, compliance

**Ticket reference**:
A mention of a ticket found in the PR description, PR title, or branch name: a **Ticket key**, a GitHub issue number, or a tracker URL. References are collected; only the **Primary ticket** is fetched.
_Avoid_: linked ticket (ambiguous with the generic linked context), issue link

**Primary ticket**:
The one **Ticket reference** the brief treats as the ticket this PR is about, chosen by precedence: references to the repo's configured tracker first, then a closing-keyword reference in the description, then description, title, branch name in reading order. Only the primary is fetched and shown to the model. An unreadable primary stays primary and is reported as unread.
_Avoid_: main ticket, parent ticket, epic

**Ticket key**:
A tracker's short identifier for a ticket, `PREFIX-N`, recognized only when the prefix matches the repo's configured tracker.
_Avoid_: ticket id, issue key

**Linked context**:
Text the harness fetched from URLs in the PR description and fenced as untrusted reference data for the model. The **Primary ticket** is fenced separately from it.
_Avoid_: external context (that is the wider ADR concept), attachments

**Soft gate**:
A transient, non-blocking nudge shown to the **Author** at the ready-for-review handoff, surfacing unaddressed **Risk Surface** flags (primary, factual) and — only when the **Intent check** source is precise — stated-but-missing intent gaps (secondary). The author may fix or authorize; it never blocks and leaves no persistent author state (the author side has no **Dismissal** or **Receipt** of its own).
_Avoid_: pre-submit gate, block, author approval

**Comment**:
Reviewer-authored text that ships to the PR. Either a **Line comment** or a **File comment** — same object, same **Review Session** lifecycle (draft, edit, publish with the rest of the review); only the anchor shape differs. Never AI-authored — the agent provides structure (seeds) and post-hoc validation, but the reviewer writes the sentence.
_Avoid_: review comment, feedback (informal only), scope (that is Full vs Changes)

**Line comment**:
A **Comment** anchored to a line or a line range on a file. One line and a range are the same shape. GitHub `subject_type: line`.
_Avoid_: inline comment (informal), span comment, scope (that is Full vs Changes)

**File comment**:
A **Comment** anchored to a file with no line range. Same lifecycle as any other Comment. Never outdated: there is no line to go stale against. GitHub `subject_type: file`.
_Avoid_: whole-file comment, file-scoped, scope (that is Full vs Changes)

**Attachment**:
An image a reviewer pastes or drops into a **Comment**, pushed by the App to an orphan `mergebrief/attachments` branch of the pull request's repository, one commit per file, and linked from the comment by its GitHub URL. The comment on GitHub keeps rendering it after this instance is gone; here it is served through the read gate with the viewer's token. A repository admin can delete the branch, which breaks every image it held. Read access to the repository is enough to attach; the push is the App's, so each reviewer is bounded to a set number of files and bytes per window, counted per api replica.
_Avoid_: upload (it is a push), asset (that is GitHub's own `user-attachments` store, which has no API), screenshot (one kind of attachment)

**Seed**:
A structured, non-text hint from the agent — `{ category, location, issue-shape }` — that a stuck reviewer can expand into their own comment. Seeds are scaffolding, not drafts.
_Avoid_: suggestion, draft, AI comment

**Approval**:
The reviewer's human judgment ("approve / request changes / comment") submitted to GitHub. Only humans approve. The tool issues a receipt, not an approval.
_Avoid_: AI approval, double approval, sign-off (when referring to the tool)

**Submit**:
A reviewer finalizing their review on GitHub (the **Approval** plus any **Comments**). The only event that advances the reviewer's **Checkpoint** and produces the static **Review Summary**, whose **Receipt** shows the **Dispositions** as they stand at that moment; mere viewing never does. Each **Comment** it carries reaches GitHub once.
_Avoid_: send, post, finish (informal)

**Repo instructions**:
The `.mergebrief/instructions.md` file — repo-committed text guidance to generation, read from the default branch only, honored strictly within the enumerated instruction classes (grouping boundaries, glossary/terminology, noise paths, reading conventions, summary phrasing). Semi-trusted: text shapes presentation and comprehension; only validated `policy.yaml` creates facts — instructions can never mint a risk attribute, change a vocabulary, or alter the schema.
_Avoid_: repo prompt, custom prompt, system prompt (it is data, never system-level)

**De-emphasis**:
Display-weight tuning from `.mergebrief/policy.yaml`: a non-floor risk attribute renders quiet (hue-shifted, excluded from the jump-rail, labeled "de-emphasized by repo policy") — detection always runs and every attribute still lands in the artifact and Receipt. Never suppression; applied from the generation-time policy snapshot stored with the artifact.
_Avoid_: hide, suppress, mute (nothing is removed)

**Floor**:
The three risk attributes that can never be de-emphasized — `touches-auth`, `removes-validation`, `relaxes-permissions` (declared in `docs/mvp/risk-surface.md`). A de-emphasized attribute co-firing on a chunk with a floor attribute renders un-quieted: the combination is the signal.
_Avoid_: severity tier, critical attributes (the floor is a display guarantee, not a score)

**Jump-rail**:
The attribute-keyed navigation row beside the group TOC: fired attribute names with carrying-group counts; clicking cycles through the carrying groups in story order. Attribute-keyed, never group-ranked — a "high-risk groups" rail would be the banned ordering verdict rebuilt as navigation. Floor attributes pin first; de-emphasized firings are excluded; collapsed unless a floor attribute fired.
_Avoid_: risk ranking, hotspot list

**Wire error code**:
The stable kebab-case identifier a non-2xx API response carries, alongside optional typed params and a composed English error line. A public, additive-only vocabulary: one code per distinct meaning — same code unless a translator would write a different sentence or a user would take a different action — never one per call site or per HTTP status. Distinct from the internal error vocabularies (GitHub, port, and auth codes), which never ride the wire and are translated to wire codes at the response boundary. Consumers render a wire code through the shared string catalog, falling back to the English error line when the code is unknown.
_Avoid_: error kind, error message (for the identifier), status-derived kind

**Failure** (vs **Error**):
A failure is an expected outcome a caller must judge — it rides the failure side of a `Result` and is named `XxxFailure`. An error is thrown — programmer/infra faults and, at the HTTP layer, the `ApiError` classes — and is named `XxxError`. The suffix carries the contract: a `Failure` type in a signature means the caller unwraps and judges; an `Error` type means it propagates to a boundary handler.
_Avoid_: using the two words interchangeably; Error-suffixed types on the Result side (in new code)

**Reviewer GitHub binding** (vs **Installation GitHub binding**):
The two GitHub identities the API acts under. The installation binding is the app's own channel — the App's installation token, bound per request to the Installation the repository resolves into, one rate budget shared across viewers. The reviewer binding is the signed-in reviewer's channel: their OAuth token behind the request's one session credential, bound once per request (by the repo gate, or by a session-only route) and shared by every call in it, the gate's own repo read included. On a token-expired failure the credential refreshes at most once per request and the call re-runs. Behind an operator pass it may retry a denied read on the operator token, never a write. Which identity a call runs under decides whose permissions and whose rate budget apply.
_Avoid_: reviewer GitHub client (the per-request client the binding replaced), viewer token (say reviewer), refresh budget (say refreshed at most once per request)

**Home**:
The page at `/`. Signed in: the one-tier **Header**, a personal line that leads with a fact only this product knows, the URL input and the **Inbox** under the on-screen label "Briefs". Signed out: the pitch, one picture of a brief and Sign in with GitHub, no URL input. "Landing page" now means only the marketing page built later, which is not a screen of the app.
_Avoid_: landing page, picker, front door, dashboard

**Inbox**:
The list on **Home**: every pull request the **Reviewer** reaches, across every **Installation** plus the ones they pasted, each row carrying their review state, folded so the rows that still need them come first, with filters, a sort and numbered pages. Inbox is the term in code and here; the label on screen is "Briefs".
_Avoid_: briefs list, your briefs, queue (collides with the job queue), docket

**Header**:
The sticky top band of a screen. On the Brief page it is two tiers: the identity row (wordmark, PR title and state, meta chips, the terminal action, the PR-scoped overflow menu, and the **Account menu** last) and the comparison row (View and Compare, the revision notices, and stats). Spans the full width above the **Sidebar** column; compacts on scroll but never loses its controls. **Home** carries a one-tier Header of 52px with a hairline under it; on every screen the wordmark is a link to Home.
_Avoid_: top chrome, top bar (the CSS variable's name, not the concept), navbar

**Account menu**:
The person-anchored menu at the end of every **Header**, holding what is about the signed-in user and never about the PR: identity, Settings, Language, Keyboard shortcuts, Sign out. Trigger is the GitHub avatar when signed in, a generic person icon while the viewer is unknown, and signed out the slot holds a Sign in button instead of a menu. No placeholder rows for what is not built. Distinct from the PR-scoped overflow menu (about this PR) and the **Sidebar** (about reading this PR).
_Avoid_: user menu, profile menu, app menu, top-chrome menu (charting-era word)

**Sidebar**:
The Brief page's permanent right-edge column, PR-contextual only, always present on wide screens. Two states: **collapsed** — the group-TOC lines (hover reveals the group name, the current group is marked) plus the expand control and the page's small utilities at its foot — and **expanded**, where it widens to show one **Tab** beside those same lines, narrowing the reading column rather than covering it. Nothing on the sidebar competes with change groups and chunks for attention: no counts on the collapsed sidebar, at most a presence dot. Hidden wherever the group TOC is hidden (**Focus mode**, Changes **Scope**). Below the tablet breakpoint the same two states render differently: collapsed is a bar on the bottom edge (group lines as a position indicator between previous/next arrows, plus the same small utilities), expanded is a sheet rising from it that covers the page while open, so a jump collapses it.
_Avoid_: rail (that is the **Jump-rail**), panel, drawer, shell (charting-era word), tenant (the API's multi-tenancy noun)

**Tab**:
One surface housed in the expanded **Sidebar**, shown one at a time via a tabs row that lists only the tabs that exist. "This PR" — the group list — is the first, then "Revisions", the PR's revisions newest first, which is where a reader moves between them; Activity and Repo chat are candidates, each earning its place through its own ticket. Conversation is not a tab: it stays in the reading flow.
_Avoid_: tenant, inhabitant, view (that is the URL scope param), pane

**Not-ready screen**:
What the Brief page shows in place of a **Brief** while there is none to read: waiting, generating, failed, capped, empty, superseded, or an error. One concept with seven states.
_Avoid_: state card, error card, placeholder

**Focus mode**:
The reading mode that strips the Brief page to one chunk at a time on a wide column. Summary, toolbar, conversation, group TOC and **Sidebar** are all hidden; a pill at the top carries progress and the single exit, and the **Context panel** sits beside the chunk. A mode of the page, not a filter of its content.
_Avoid_: zen mode (code-internal only), distraction-free, reading mode (every mode is for reading)

**Context panel**:
The dismissible panel on the right edge in **Focus mode**: the focused **Change-group** (title, summary, categories, core line total), the group's chunk strip with the reader's place marked, and the current chunk's file facts and risks. Non-modal, so the diff beside it stays readable and usable. It opens on each new group; hiding it holds until the reader leaves that group.
_Avoid_: rail (that is the **Jump-rail**), sidebar (that is the **Sidebar**), drawer, overlay (that is the **Comparison overlay**)

**Change-group card**:
The card beside each **Change-group** in the **Story view** outside **Focus mode**: the group's title, summary and categories, the reader's choice of **Dominant Category**, the group's chunk list with the reader's place marked, and its **Risk Surface**. It describes a group in the same words as the **Context panel**; only the Change-group card lets the reader reclassify a group or triage its flags.
_Avoid_: group header, panel (that is the **Context panel**), rail (that is the **Jump-rail**)

**Scope** (Full vs Changes):
Which slice of the Brief the page shows: **Full** is the whole story flow; **Changes** is the compare view between two revisions: the summary plus the changed lines, reviewable in place. Scope and **Focus mode** are the two reading modes that together decide which page regions render; that decision is made once, never per region.
_Avoid_: view (the URL param's name, not the concept), tab (that is a **Sidebar** surface), filter (the toolbar Filter governs inline threads)

**Scroll to target**:
Putting the reader on a chunk, group, row, rail or section target, once, with the page settled: the card opened, the viewport scrolled, focus placed, the target flashed. One scroll to target at a time; a new **Brief** cancels the one in flight. In code, names built on `Scroll` name the whole mechanism (`useScrollToTarget`, `ParkedScroll`); one viewport move inside it is a scroll action (`ScrollActionKinds`).
_Avoid_: landing (the former name), jump (the gesture that asks for one), deep link (the URL that asks for one)

**Address**:
What the URL's `l` and `focus` params say, as a pure function of reading state: the selected lines, else the **Focus mode** chunk, else nothing. State writes the Address; the Address never writes state.
_Avoid_: link param (one field of it), URL sync, route state

**Span diff**:
The live diff from the active **Comparison baseline** to the selected head, fetched when the reader asks for it in Changes **Scope**. Its right side is head; its left side is the baseline, so a left-side row has no line at head and takes no comment. Every row it shows is a guest row of the full **Brief** chunk that owns the line, resolved the way a **Sibling span** resolves its owner.
_Avoid_: raw diff (the toggle's label, not the concept), whole-PR diff, span patch

**Unified view**:
The default diff rendering: one column of rows, added and removed lines interleaved in file order. Per viewer, remembered in browser storage, overridable for one visit by the `diff` URL param.
_Avoid_: inline view, single view, list view

**Split view**:
The paired diff rendering: each hunk's removed and added lines positioned side by side, one row per pair. Same per-viewer preference and same `diff` param as **Unified view**; needs a viewport wide enough for two halves.
_Avoid_: side-by-side (informal only), two-up, dual pane

### Workspace

**App**:
A workspace member that runs as its own process or ships as its own binary, now or by design: the web app, the API, the worker, the CLI. Lives under `apps/`. Nothing imports an App; Apps talk over HTTP or the job queue.
_Avoid_: service (for the CLI), package (for a deployable)

**Package**:
A workspace member Apps share by importing it. Lives under `packages/`.
_Avoid_: library, module (for a workspace member)

**Tool**:
A repo-local script, never deployed, never imported by app or package source; run by hand or by CI/lint. Lives under `tools/`.
_Avoid_: script (bare), dev package

### Releases and upgrades

**Operator**:
The person who runs an **Instance**: installs it, upgrades it, backs up its database, reads its log. Not a role in the app; no admin exists, every signed-in user sees the **Version notice**, and the upgrade step runs on the host.
_Avoid_: admin (no such role), self-hoster (informal only), maintainer (that is the project's)

**Release**:
One published version of MergeBrief, cut from one git tag: one version number, one image, one npm package, one notes file, one GitHub Release carrying the compose file and `version.json`.
_Avoid_: version (the number, not the thing), build (a dev artifact), deploy

**Instance**:
One running MergeBrief: an API, a web tier and a worker over one database, reporting one `SERVER_VERSION`. What an **Operator** upgrades.
_Avoid_: server (ambiguous with the API process), deployment, installation (that is a GitHub App installation)

**Image**:
The one container artifact a **Release** ships, carrying its version. It runs the API, the web tier, the worker and the migrate step, each started by one word. A build from a checkout is a **Dev build** of it.
_Avoid_: container (the running copy), images (plural; one per Release), docker (the tool)

**Expand step** / **Contract step**:
The two halves of a schema change: the Expand step adds, copies or widens in one **Release**; the Contract step drops, rewrites or tightens in the next Release of any kind, patch included. Release N-1 keeps working beside release N.
_Avoid_: migration (the mechanism, not the promise), phase

**Breaking release**:
A **Release** whose upgrade needs more than the three documented lines: a new required or removed env key, a Postgres major bump, a suspended expand-and-contract rule, a manual data step. Flagged `breaking` in `version.json`.
_Avoid_: major (semver, not the promise), incompatible

**Security release**:
A **Release** that fixes a vulnerability. Flagged `security`; the **Version notice** stays until the **Instance** runs it or newer.
_Avoid_: hotfix, patch (semver)

**Rollback**:
Running the previous **Release** again. One release back needs no **Restore**.
_Avoid_: downgrade, revert

**Restore**:
Loading a dump into an empty database. Part of a **Rollback** only two or more releases back or across a **Breaking release**.
_Avoid_: recovery, rollback (the whole move)

**Skew**:
The installed CLI and the server it talks to run different **Releases**. A difference in what is installed, never in what was released.
_Avoid_: mismatch, drift, version gap (informal only)

**Dev build**:
A server reporting `dev` or a CLI reporting `0.0.0`: never checks for a newer version, never compares, never warns.
_Avoid_: local build, snapshot, unversioned

**Version notice**:
The band directly under the Header on Home and the Brief page saying a newer **Release** exists, with its release-notes link. Dismissible per user per Release, except for a **Security release**.
_Avoid_: banner (the skin, not the concept), update prompt, nag (that is the CLI's line)

## Relationships

- A **PR** has at most one **Brief** per commit SHA. The brief is **shared** across reviewers.
- A **Brief**'s **index** is a PR-global ordinal over the briefs generated for the PR, retargets included (shared, not per-reviewer); a **Delta Brief** spans the gap between two briefed head SHAs.
- A **Brief** contains many **Chunks**, clustered into **Change-groups**. A chunk is a contiguous run of changed lines sharing one Concern and one Change-group; a git hunk may be split into multiple chunks, and one file's chunks may span multiple Change-groups. Changed lines no attributed chunk claimed are the **Unattributed remainder**, one last Change-group of unattributed chunks.
- A **Change-group** has one **Categorization** (one or more **Categories**, exactly one **Dominant**), one **Summary**, and inherits a **Playbook** from its **Dominant Category**. A group spans one core chunk plus zero or more supporting chunks. The **Unattributed remainder** is the exception: no Categorization, no Summary, no Playbook.
- A **Chunk** belongs to exactly one **Change-group**, has one **Concern**, one **Role** (core/supporting), zero or more **Risk Surface** attributes, and its own **LoC** (+added/−deleted).
- The brief is read through two pivots over the same chunk set: the **Story view** (by Change-group) and the **Concern view** (by Concern). LoC rolls up under both; the **Unattributed remainder** is the last group in one and the last Split segment in the other, so both totals cover the whole diff.
- A full **Brief** at a given SHA is shared across all reviewers of that SHA. A **Delta Brief** spans the *reviewer's* last-reviewed SHA → current head, so two reviewers at different checkpoints receive different Delta Briefs over different commit spans. The full Brief is the shared, per-SHA artifact; the Delta Brief is selected per reviewer by their baseline. New pushes (debounced) move the head, after which a fresh full Brief and new Delta Briefs become available.
- A **Comparison overlay** applies one **Comparison baseline** to the current **Brief**; **Previous Brief** uses shared **Revision changes** + **Revision narrative**, while **Checkpoint** uses the reviewer's personal **Delta Brief** and matching changed-line marks.
- **Revision changes** and a **Revision narrative** both span the shared **Previous Brief** → current-head revision; the former marks lines mechanically, while the latter explains those marked changes.
- Each (PR × Reviewer) pairing has one private **Review Session**.
- A **Comment** belongs to a reviewer and ships to the PR. It is a **Line comment** or a **File comment**; a **Chunk** does not own it. A **Seed** belongs to a chunk in the brief and never ships.
- A reviewer records a **Disposition** on a **Flag**: **addressed** (a **Comment** targets it) or **dismissed** (with reason). Dispositions are frozen into the **Receipt** on **Submit**. A Flag may carry a **Risk note**.
- On submit, the review lands **natively on GitHub** (comments + approve/request-changes) authored by the reviewer. A **Signature line** links to the static **Review Summary**, which renders the **Receipt**. The review otherwise reads as a normal human review. Receipt aggregates across all reviewers when multi-reviewer.
- A **Brief**'s **Trigger** (compute) is independent of its **Entry** (human reach): compute fires eagerly on every push; the reviewer **Entry** comment posts only when the PR is ready. **Draft-first** changes only the Entry timing, never the Trigger.
- The **Analysis Layer** is reviewer-agnostic. A human reviewer consumes it through the **Engagement Layer** (v1). An AI-agent reviewer consumes it directly via API (v1.5+ headless) — the no-AI-text rule and Review Session are human-mode only and do not apply to agent-mode.

## Example dialogue

> **PM:** "When the reviewer dismisses a **Flag**, does the **Author** see the agent's original reasoning?"
> **Eng:** "No — only the **Dismissal** + the reviewer's stated reason show on the **Receipt**. The agent's challenge stays inside the **Review Session**. The receipt is the public surface, the Review Session is the private one."

> **PM:** "What if the **AI** is wrong about the **Category** for a chunk?"
> **Eng:** "Reviewer reclassifies it in one click. The **Playbook** swaps automatically. The receipt notes 'N chunks reclassified by reviewer' — the tool stays honest about what it got and what the human corrected."

## Flagged ambiguities

- **"Critical area"** was rejected as terminology. It bundled *verdict* into what should be *attributes*. Resolved: split into **Risk Surface** (factual per-chunk attributes) and **Flag** (a specific item needing attention or dismissal).
- **"Risk category"** was used for a Risk Surface attribute. **Category** is the Change-group's intent (`bugfix`, `lib-bump`). Resolved: say **attribute**. The catalog implication is what the attribute means; a **Risk note** is why it fired on this Chunk.
- **"Approval"** was used ambiguously to mean reviewer judgment AND AI verification. Resolved: only humans **Approve**. The tool issues a **Receipt**, scoped to mechanical claims.
- **"Dismissal" vs "Disposition"** — *Dismissal* was used for the whole flag-decision concept. Resolved: **Disposition** is the umbrella (*addressed* or *dismissed*); **Dismissal** is only the *dismissed* value.
- **"User"** in early scope was ambiguous (author vs reviewer). Resolved: **Reviewer** is the primary v1 surface; the **Author** self-review surface is a *secondary* v1 surface (see `center-of-gravity.md`), consuming the same shared **Brief** plus the **Intent check** and **Soft gate**. Both are named explicitly when referenced.
- **"Critical code areas might mislead reviewer"** — the original concern was anchoring bias. Resolved by Risk Surface + Playbook + no-verdict model. Anchoring is the design's chief enemy at the brief layer.
- **"Pure AI code review comments"** was an informal phrase. Resolved as a strict product rule: the agent never authors text that ships as a **Comment**. Seeds and validation only.
- **Intent lived on the chunk** in the original model. Resolved: intent (**Category**, **Summary**) lives on the **Change-group**; the chunk carries **Concern**, **Role**, and **LoC**. A test/doc chunk supports a group's intent rather than re-deriving its own.
- **`test-only` / `config-only` / `generated-code` as Categories** conflated *artifact* with *intent*. Resolved: these are **Concern** values, not Categories. Category is purely intent (what kind of change); Concern is artifact (what kind of file).
- **"spec" is overloaded** — `.spec.ts` test files vs specification documents. Resolved default: `spec` Concern = specification document; `.spec.ts`/`.test.ts` → `test` Concern.
- **"A file with multiple changes/concerns"**: resolved: the **Chunk** (not the file) is the atomic unit and is sub-file. Separable multiplicity (different intents or concerns in different parts of a file) is handled by splitting into multiple chunks across groups/concerns. *Interleaved* multiplicity within one inseparable contiguous span is the one unhandled case, deferred to a sub-operation tree.
- **"Scope" for line vs file** was proposed for a Comment's extent. Rejected: **Scope** is Full vs Changes on the Brief page. Resolved: a Comment is a **Line comment** or a **File comment** — same object, different anchor shape; a Chunk does not own it.
- **"Leftover lines as a coverage disclosure, not a group"** was the pre-feature shape (`UnattributedBanner` + header stat). Resolved: they are the **Unattributed remainder** — a last **Change-group** of unattributed **Chunks**, same product language as any other group, with the caveat that the model made no intent claim. Concern, Role, and Risk Surface on those chunks are not implied here.
- **"production" rejected** as the core-concern name — bakes in a deployment assumption. Resolved: `implementation`.
- **"Activation"** was one word for three independent things — *what fires compute*, *how a human reaches the brief*, and *turning draft-first on*. The old definition (compute-on-first-click) also contradicted the eager-on-push generation model. Resolved into **Trigger** (eager-on-push compute), **Entry** (the branded deep-link comment, posts on ready), and **Draft-first** (per-repo opt-in that gates Entry until `ready_for_review`, never the Trigger). "Activation" is retired.
- **"AI-authorship signals" as an in-product grouping** was considered for the
  AI-authored-code review lens and rejected: Risk-Surface attributes are
  authorship-agnostic facts (a human can add a needless dependency or write a lying comment
  too), and a visible "AI-ish" grouping is verdict-adjacent — it implicitly asserts
  authorship the tool cannot know. The lens attributes (`new-dependency`, `new-abstraction`,
  `comment-contradicts-code`) ship as ordinary Risk-Surface attributes; the AI-failure-mode
  framing lives in positioning copy only.
- **"Consume an AI context manager (Unblocked) to flag cross-context issues"** was proposed as a brief feature. Rejected: a tool asserting AI-hypothesized "potential issues" is the **bug-bot the product is positioned against** (no-verdict rule; `center-of-gravity.md` "no bug-bot noise"; category-scoped, not general). Resolved into three data-flows: (1) external context may **enrich the Intent check and Risk Surface with *cited* facts only** — cite-or-stay-silent, never a verdict; (2) AI *review* of the code is the **headless dual-consumer lane** — the org hooks its own agent to consume our **Brief**, and that agent owns its verdicts, not us (preserves no-verdict because we are the analysis substrate, not the reviewer); (3) the **comment-to-rule loop** is the inverse arrow (we *produce* repo-local agent context). Only (1) is a consume-side build, and it is deferred.
