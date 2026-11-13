# MergeBrief context

Comprehension scaffolding for human reviewers of pull requests, not another reviewer bot: the diff is re-unitized from lines into categorized chunks, and AI assistance is kept apart from AI authorship.

> This file defines the meaning of each term. The closed list of built-in labeling tokens (the Category, Concern, Role and Risk Surface values with their quick rules) is `docs/vocabulary/labeling-schema.md`; a repository's `policy.yaml` may add **Custom attributes** to the Risk Surface set.

> Vocabulary, not priority: product weighting is in `docs/vision.md`. The **Playbook** layer is parked; no product code consumes it, and entries that mention playbooks describe the parked design.

## Language

**Brief**:
The comprehension artifact the tool produces for a PR: summary, multi-tag categorization per chunk, per-category playbooks, risk-surface attributes. Computed eagerly on push (see **Trigger**), cached by commit SHA. Each Brief carries a PR-global **index** (the Nth brief for this PR, retargets included, shared across reviewers, never per-reviewer; the `rev` a brief URL names) and the **commit range** it covers (the whole PR, base→head). A Brief also surfaces the PR's shipped **Comments** (from all reviewers) with their GitHub-native **outdated** status, for display only: *which change resolved which comment* is the **Delta Brief**'s job, not the Brief's.
_Avoid_: report, analysis, AI summary, brief number (for index)

**Delta Brief**:
The comprehension artifact for re-review: what changed between a **Checkpoint** and the current head, read off the **Revision span** between the two rather than a replay of commits, so it holds across rebases and force-pushes. It carries a summary, the changed groups, the changed chunks with the shipped **Comments** each one addresses, and the whole-PR impact. Stored once per PR, Checkpoint SHA and head SHA and shared by every reviewer at that Checkpoint; per-reviewer carry-over state lives on the **Review Session**, never here. A reviewer with no Checkpoint gets the full **Brief**, no Delta.
_Avoid_: incremental brief, diff-of-diff (informal only), update

**Checkpoint**:
The commit SHA at which a given reviewer last *submitted* a review. The baseline from which that reviewer's **Delta Brief** is computed (Checkpoint → current head). Advances on review submission, never on mere viewing, and only for a reviewer on the team: anyone on a private (not internal) repository; on a public or internal one, the owner, organization members, collaborators and others with write access. Any other reviewer has none. Distinct per reviewer, so two reviewers can hold different Checkpoints on the same PR and therefore receive different Delta Briefs. On screen and in code it is the "last review" **Comparison baseline**.
_Avoid_: baseline (informal), last-seen, watermark

**Session baseline**:
The SHA a reviewer is currently viewing in an in-progress review, before they submit. It is the key of a **Review Session**: the reviewer's unfinished work is stored against the **Brief** at this SHA, so a new Brief starts a new Review Session, which takes over at its first write: that write carries the previous session's work over and freezes it. Until then the previous session stays writable. The durable **Checkpoint** advances only on submit.
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
The shared, per-revision **Comparison overlay** on a full **Brief** that highlights which lines changed versus the **Previous Brief** (prevHead→head). Read mechanically off the **Revision span** between the two heads, never the per-reviewer **Delta Brief**, never reviewer-relative: every reviewer of a given head sees the same marking. Answers "what moved in this push", distinct from the **Delta Brief**'s "what changed since *I* last looked", and absent on the first **Brief** (no previous head).
_Avoid_: delta (reserved for the per-reviewer artifact), delta overlay, blue diff, revision delta

**Revision span**:
The PR's own change between two of its heads: the PR diff at one head diffed against the PR diff at the other, so a rebase or a base merge shows only what it moved in the PR's own lines. Read once per run for the pair of heads it covers; **Revision changes**, the **Revision narrative**, the **Delta Brief** and **Anchored generation** all read it.
_Avoid_: incremental diff, between-heads diff, compare diff

**Span refs**:
The base each head's PR diff was read against when a **Revision span** was computed, stored with the span's marks. A span is served again only under the same refs, so a retarget that keeps the head reads a new span.
_Avoid_: bases (bare)

**Fast-forward span**:
A **Revision span** whose two heads share one merge base and whose new head descends from the previous one: the between-heads compare, read as served.
_Avoid_: fast path (informal)

**Revision narrative**:
The shared, generated explanation of what changed between a **Brief** and the immediately previous **Brief** for the same PR (prevHead→head), used to summarize **Revision changes** on a full **Brief** without any reviewer-specific **Checkpoint** or carry-over state.
_Avoid_: Delta Brief, reviewer delta, update summary

**Reading order**:
The reasoned sequence over a **Brief**'s **Change-groups**: a strict permutation (each group appears exactly once, no revisits), each step carrying a one-line *why-this-next* rationale. The rule: **foundation-first** (groups whose changes other groups build on come first: schema/types → core logic → call sites/wiring), falling back to **context-first, churn-last** for independent groups (dominant-intent groups first; mechanically-known low-signal Categories such as `pure-move`, `lib-bump`, `dependency-update` last, keyed on Category, never a free-floating importance judgment). Orders the *existing* groups; it is never a new grouping and never exposes a score or rank label (no-verdict holds). Within-group order stays structural (core → supporting, Concern order). The **Unattributed remainder** is always the final step, placed there mechanically outside the reasoned permutation, with no rationale: it is leftover lines, not a decision about what to read next.
_Avoid_: narrative (reserved for generated text), story, layers/cohorts (Atlas's terms), walkthrough (CodeRabbit's term), importance/priority/severity (verdict language)

**Read-through**:
The experience of following the **Reading order**: stepping through **Change-groups** in sequence (keyboard next/prev, focus on the current group), end to end, once. The theatre sense: a first sequential pass through the whole piece. The Read-through follows the Reading order; it never reorders or filters it.
_Avoid_: walkthrough (CodeRabbit's term), tour (onboarding connotation), guided review

**Carry-over status**:
How a prior **Disposition** lands when a new **Review Session** materializes from the previous one onto a new **Brief**, stamped on the Disposition. One of: **New** (no prior decision); **Reopened** (addressed or dismissed and its region was touched since, so the decision must be re-made); **Settled** (addressed or dismissed and its region untouched, so the decision still holds); **Dropped** (the attribute no longer fires at head, independent of any reviewer action). Decision order: Dropped, Reopened, Settled, New. Reopen is purely positional: any change to the flagged region reopens; meaningfulness is never inferred. On ambiguity, Reopened, never Settled.
_Avoid_: still-resolved, cleared, gone, stale, resolved (as state names)

**Comment anchoring**:
How a prior comment is placed once head has moved. A shipped **Comment** (GitHub-native) carries GitHub's own position/outdated tracking: we read it, not recompute it. A **Flag** or an unshipped **Line comment** draft (**Review Session**) is anchored by us via the span's positional line-map: **moved** (relocated to a new line) or **orphaned** (its target line is gone). Ambiguous → orphaned / needs re-look, never silently dropped. A **File comment** has no line: GitHub never marks it outdated; a draft follows the path, not a line-map.
_Avoid_: re-anchor (informal), outdated (GitHub's word, only for shipped comments)

**Chunk**:
A contiguous run of changed lines sharing **one Concern and one Change-group**, the atomic unit of the brief. A chunk is *sub-file*: a single git hunk may be **split into multiple chunks** at concern/group boundaries, and one file's chunks may land in different Change-groups. Each chunk has one Concern, one Role, one Categorization-by-inheritance (from its group), zero or more Risk Surface attributes, and its own LoC. Lines in the **Unattributed remainder** are still chunks: they belong to that group and carry no Concern, no Role, no inherited Categorization and no Risk Surface the model observes: only their file, ranges and LoC, plus `adds-secret` when an added line holds a credential and `changes-package-source` in a pnpm, npm or yarn lockfile that moves a package's source (a new source or integrity at the same version, a version change to a different source, an npm alias appearing or changing, or a new package from a source the lockfile did not use before) or cannot be read, or in a changed `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `pnpm-workspace.yaml`, which the pipeline sets without reading intent.
_Avoid_: hunk (a chunk may be finer than a git hunk), file, diff block
_Limitation_: a chunk cannot express multiplicity *interleaved within one inseparable contiguous span* (e.g., move and logic-fix woven line-by-line). That is the deferred sub-operation tree; until then, express it via dominant+secondary Categorization on the group plus a text callout in the Summary.

**Sibling span**:
A contiguous stretch of expanded rows that belongs to another chunk of the same file, framed and labelled with its owner. Never a chunk of its own: its rows keep their add and del colours, a comment placed on them anchors to the owning chunk, and the frame's control jumps to that chunk.
_Avoid_: borrowed lines, foreign hunk

**Change-group**:
A cluster of chunks that together accomplish one coherent piece of work (e.g., "fix the cross-param leak"). The unit of *intent*: it carries the Categorization and the summary. Spans files and Concerns: one or more core chunks (the intent's implementation may span files) plus zero or more supporting test/doc/spec chunks. The Story view pivots the brief by Change-group.
**Boundary rule:** one group = the largest chunk set expressible as ONE Summary + ONE Dominant Category. If a set needs two unrelated summaries, split it. Author commit structure is a *hint* for understanding intent, never the boundary itself. A single-intent PR is one group; a grab-bag PR (fix + lib bump + README typo) is several.
**Exception:** the **Unattributed remainder** is a Change-group with no Summary and no Categorization: leftover lines, not an intent. Never split, never merged into an intent group.
_Avoid_: chapter (Linear's narrative-only term), story, cluster, section

**Unattributed remainder**:
The set of changed lines no attributed **Chunk** claimed. Stored on the **Brief** as per-file line ranges; the page shows them as remainder chunks in one last **Change-group**, the one exception to the intent boundary: no Summary, no Categorization, never split, never merged into an intent group. Its name and one-line note are fixed system copy, not model output; its chunks carry no Concern or Role, and no Risk Surface beyond `adds-secret` and `changes-package-source`, which the pipeline sets. A file with no changed line that fires `changes-package-source` joins it as an entry with no lines, so the flag has a card. In the **Split** it is one last segment beside the Concerns, never a Concern itself.
_Avoid_: coverage gap, orphan lines, residue, unattributed (bare noun)

**Category**:
A taxonomy entry describing the *intent* of a Change-group, not opinion about it. Examples: `pure-move`, `move-with-edits`, `lib-bump`, `logic-refactor`, `new-feature`, `bugfix`, `schema-change`, `dependency-update`. Category answers "what kind of change"; Concern answers "what kind of artifact". They are independent axes.
_Avoid_: type, classification, label, tag, kind. ("Label" and "tag" are not used in product or UX language: Category is the single word.) Also: `test-only`, `config-only`, `generated-code` are NOT Categories: they were artifact-concerns masquerading as intent; they are now Concern values.

**Categorization**:
The result of categorizing a Change-group: one or more Categories attached to that group, exactly one of which is the Dominant Category. A group has one Categorization; a Categorization contains one or more Categories. A group that is "mostly a bugfix but includes a move" has `{ dominant: bugfix, secondary: [pure-move] }`. This expresses sub-operations without a formal sub-chunk tree.
_Avoid_: tags, labels (plural informal usage), classification

**Dominant Category**:
The single Category surfaced as primary when a Change-group's Categorization contains multiple Categories.
_Avoid_: main tag, primary type, main label

**Concern**:
The artifact a chunk touches: `implementation`, `test`, `doc`, `spec`, `config`, `generated`. Independent of Category. Mostly derivable from file path. The **Split** shows the brief's share per Concern to route attention: how much of the PR is real implementation versus supporting scaffolding. Default resolution of the overloaded "spec": `spec` = specification document (distinct from `doc`); `.spec.ts`/`.test.ts` files map to `test`.
_Avoid_: production (env-restrictive), file-type, type, bucket

**Split**:
The **Brief** page's share of changed lines per **Concern**, one segmented meter with a legend on the masthead. The **Unattributed remainder** is its last segment, never a Concern.
_Avoid_: Concern view (the former pivot), breakdown, distribution, Split view (the diff rendering)

**Role**:
Whether a chunk holds its Change-group intent (`core`) or serves it (`supporting`). Default: `implementation` concern → core; `test`/`doc`/`spec`/`config` → supporting. Flippable when a supporting artifact is itself the purpose (e.g., a flaky-test fix makes the test chunk the core chunk, and it then takes the group's intent).
_Avoid_: primary/secondary (collides with Dominant/secondary Category), main, lead

**Summary**:
The descriptive sentence(s) of what a Change-group changed. Lives on the group. Descriptive *what*, never narrative *why*: the why belongs in the PR description and the linked issue.
_Avoid_: description, explanation, story, narrative

**Brief summary**:
The lede and optional changelog at the top of a **Brief**. Not a Change-group's **Summary**.
_Avoid_: summary (alone, that is the Change-group's), overview, lede (one part of it)

**LoC**:
Added and deleted line counts, shown non-prominently per **Change-group** and per **Concern** in the **Split**. An attention-routing distribution, never a size verdict: "where is the real change", not "how big is this". Any adjustment excludes only mechanically detectable lines (moves, `generated`), never hand-judged significance, so two labelers and the categorizer reproduce it identically.
_Avoid_: diff size, churn, lines-changed-as-quality-metric, weighted LoC

**Playbook**:
A templated, domain-rule checklist of items to verify for a given category. Not AI-generated hypotheses: known engineering checklists per change type. Example for `lib-bump`: "verify breaking changes from changelog, all call sites updated." **Parked to v2:** no v1 surface renders or consumes playbooks; if revived, the identity is a *coverage rubric*: post-hoc measurement of a finished review (check-off frozen into Receipts, or grading an agent's review), never prompt material for reviewers or agents.
_Avoid_: checklist, rules, review template

**Risk Surface**:
The set of factual attributes attached to a chunk. Attributes only, never verdicts. Severity (when needed) emerges from the *combination* of attributes, never from a graded prefix on any single attribute. Three-bucket structure: **about the code** (e.g., `no-tests`, `legacy-area`), **about the change** (e.g., `touches-auth`, `mutates-state`, `removes-validation`), **about the blast radius** (e.g., `external-io`, `widely-imported`, `cross-service`). Full library in `docs/vocabulary/risk-surface.md`.
_Avoid_: critical area, hot spot, risky code, severity tag

**Flag**:
A single item from the brief that requires reviewer attention: a **Risk Surface** attribute firing on a specific **Chunk**, which the model surfaces or, for `adds-secret` and `changes-package-source`, the pipeline sets. The code, the operations and the **Signature line** call it a risk (`dismiss-risk`, `address-risk`, `reopen-risk`, "risks addressed"); unvisited-playbook-item flags are parked with the playbook layer.
_Avoid_: issue, warning, finding

**Risk note**:
Chunk-specific factual evidence for why a **Risk Surface** attribute fired on that **Chunk**. Carried on the chunk (`riskNotes`) and copied onto the matching **Flag**. Distinct from the attribute's catalog implication, which is the same sentence on every file.
_Avoid_: description (ambiguous with the catalog implication), reason (collides with Dismissal)

**Disposition**:
A reviewer's recorded decision on a **Flag**: *addressed*, backed by **Evidence**, or *dismissed*, with a reason. Anchored to the flagged code region (file, attribute, region@SHA), never to a brief-local id, so it survives regeneration and carries onto the next **Review Session** with a **Carry-over status**. The **Receipt** shows it as it stands at **Submit**; nothing freezes it, so the reviewer can still change it afterwards and a later Submit shows the change.
_Avoid_: resolution (informal), flag status, decision (bare)

**Evidence**:
What an addressed **Disposition** points at: a linked draft **Comment**, a reviewed **Chunk**, or a manual note. When the thing it points at is gone, the Disposition is marked missing-evidence and lands on the **Attention list**.
_Avoid_: proof, justification (a **Dismissal** carries a reason instead)

**Dismissal**:
The *dismissed* value of a **Disposition**: a reviewer's recorded decision **not** to act on a Flag, accompanied by a reason. Dismissals appear on the **Receipt** with the reason verbatim. (The other value is *addressed*.)
_Avoid_: ignore, skip, override

**Uncertain**:
The model's explicit mark on a **Change-group** when its confidence in the **Dominant Category** is below threshold, naming the categories in tension. Chunks and Flags carry no uncertainty mark.
_Avoid_: low confidence (informal only), unknown, maybe

**Receipt**:
The scoped tool-verification content: mechanical claims (chunks read, flags addressed, dismissed and open, comments), the **Dispositions** as they stand at **Submit**, and the **Generation origin** of the analysis. A view of the Dispositions, not a copy kept apart from them. Never an "approval". Shown in the submit flow; its counts ride on the **Signature line**.
_Avoid_: AI approval, stamp, attestation

**Generation origin**:
Which provider, model and effort produced a **Brief** or **Delta Brief**, recorded on the artifact and shown on the **Receipt** and as an understated header label, so the reader knows what generated the analysis and never mistakes it for a verdict.
_Avoid_: model tag, attribution, watermark, AI signature (collides with Signature line)

**Signature line**:
The one line MergeBrief appends to the GitHub review body: "Reviewed with MergeBrief" followed by the **Receipt**'s mechanical counts (chunks read, risks addressed, dismissed, open, inline comments), fenced off from the reviewer's own words by a rule. The only tool footprint on the GitHub review, which otherwise reads as a normal human review; it links nowhere.
_Avoid_: tool signature (informal), banner, badge

**Analysis Layer**:
The reviewer-agnostic core: Change-groups, Categorization, Risk Surface, the Concern **Split**, LoC. Consumed through the **Engagement Layer**.
_Avoid_: engine, backend, core (informal)

**Engagement Layer**:
The human-reviewer workflow built on the **Analysis Layer**: no AI-authored text, the private **Review Session**, human-written **Comments**, **Approval** plus **Receipt**.
_Avoid_: UI layer, frontend, workflow (informal)

**Review Session**:
The private (per reviewer × PR) workspace where the reviewer thinks, drafts, dismisses flags and refines comments, without that work being visible on the PR thread. It is one reviewer's work on one PR, pinned to one **Session baseline** and stored on the **Instance**: draft **Comments** and replies, **Read marks**, **Reclassifications**, **Dispositions** and the chosen outcome. A new **Brief** starts a new Review Session; reads preview the carried work, and the first write to it carries prior work over and freezes the previous session. A new Brief alone freezes nothing.
_Avoid_: Mind-Map Space (retired), workspace, scratchpad, draft space

**Read mark**:
A reviewer's mark that one **Chunk** is read, stored on the **Review Session**; presence is the mark, there is no unread row. Carried onto a new **Brief** only for chunks **Anchored generation** carried unchanged. The **Receipt** counts them as chunks read.
_Avoid_: viewed, seen, visited

**Reclassification**:
A reviewer's override of a **Change-group**'s **Dominant Category**, stored on the **Review Session**. Overrides only: an absent row means as generated. Carried onto a new **Brief** only while every Brief in between descended its group ids.
_Avoid_: recategorize, relabel

**Attention list**:
The **Brief** page's list of carried work that needs a decision: an orphaned draft anchor, a reopened **Disposition**, an addressed Flag whose **Evidence** is missing. Each item names the operations that clear it; once it is empty the carry-over row becomes a one-line receipt.
_Avoid_: todo list, warnings, carry-over list

**Installation**:
One install of the MergeBrief GitHub App on one GitHub organization or user account. A repository belongs to exactly one Installation. A **Reviewer** can reach several; every request finds its Installation from the repository it names, and no credential holds a current one. As a **Source** value (stored `installation`, key `INSTALLATION`): a pull request reported by the App's webhooks, belonging to an Installation.
_Avoid_: tenant (the API's storage noun), org (GitHub's word; an Installation can sit on a user account), workspace

**Source**:
Which way a pull request entered MergeBrief: **Installation** or **URL**. Column `source`, map `PullRequestSources`.
_Avoid_: world, door, origin (collides with **Generation origin**)

**URL**:
A **Source** value (stored `url`, key `URL`): a pull request one **Reviewer** added by pasting its URL. It belongs to that reviewer, no webhook reports on it, and its jobs read GitHub through the reviewer's **Grant**. Ownership is not exclusive: any reviewer GitHub lets read the repository opens its stored **Brief**; only the **Inbox** list is owner-only. "Box" names a spot on the screen, not a concept; the input on Home gets no term.
_Avoid_: pasted-URL, url-box (survives only in identifiers such as `UrlBoxGenerateJobPayload`), twin

**Grant**:
One GitHub user-to-server authorization: the one row holding a reviewer's encrypted GitHub token pair. Sessions and API tokens reference it rather than copy it, and it dies with its last referent. A **URL** pull request's job carries a grant reference, never token material.
_Avoid_: credential (the pair inside it), token (one half of it)

**Live read**:
Reading a pull request's facts from GitHub at request time, on the reader's token: a **URL** one at paste, on Inbox load and on Brief open; an installation one on Inbox load and on Brief open, a backstop for a webhook that never arrived. A row read within the last five minutes is not read again; a merged one never is. A read never queues a generation.
_Avoid_: refresh (means token refresh), sync (GitHub's push action), status check (GitHub's CI term)

**Unreachable**:
A **URL** pull request GitHub no longer shows to this reviewer. The row and its **Brief** stay, its facts stop updating, and Delete stays available.
_Avoid_: stale (means newer commits exist)

**Trigger**:
What causes a **Brief** to compute: every push, PR open included, debounced about 60s from the first push, which fixes the start time; later pushes only swap the head. A draft computes too unless the **Instance config** sets `drafts.generate: off`, in which case its first Brief waits for `ready_for_review`; `drafts.debounceSeconds` lengthens the window for a draft's regenerations once it has one successful Brief. A ready flip and a URL paste take a 10s window. A submitted review also queues a run, which builds the reviewer's **Delta Brief** from their **Checkpoint** when they hold one. No compute-on-first-click gate for a **Trusted author**: spend is bounded by the debounce and the **Daily cap**, not by withholding compute. Any other author's PR waits for a **Trigger approval**.
_Avoid_: activation (as "what fires compute"), cost gate, click-to-activate

**Entry**:
How a human reaches a computed **Brief**: one branded PR comment carrying a deep-link, reposted per generation, one ping per settled head. It posts on drafts too unless the repository's `settings.yaml` sets `entryCommentOnDrafts: false`, which holds it until `ready_for_review` and removes a lingering one; an unreadable `settings.yaml` holds it as well. A **URL** pull request never gets one. The deep-link click is navigation, never a compute **Trigger**. A run that ends `failed`, a terminal post GitHub failed transiently, that lost the comment swap to another writer or that stood down on an unread head, and a close or merge queue the head's Entry sync (`sync-entry`), which re-renders the Entry from the **Generation**'s state when the run's own post never landed or the PR stopped being open.
_Avoid_: activation (as "the click"), deep-link gate, draft-first (the former name for the opt-out, which was described as an opt-in)

**Generation**:
The persisted record of producing a **Brief** for one head of one PR, which the worker projects its progress onto. A Generation is pending, running, or finished (succeeded, failed, superseded, capped, awaiting trigger). Each paid try at it, graphile retries included, is one attempt, and attempts, with the parts a large one claims, are what the **Daily cap** counts. A running Generation is held by its **Claim**. Never a queue. A **Job** that runs with a stored Brief takes no Claim, but when it pays a provider call it still adds one attempt.
_Avoid_: job (that is the **Job**), run (a run id names a **Claim**, not the record), generation job

**Trusted author**:
A PR author whose pushes **Trigger** a **Brief** with no approval: someone on the repository's team, or a bot the repository's `settings.yaml` lists in `trustedBots`. Any other author's PR waits for a **Trigger approval**.
_Avoid_: trusted contributor, allow-listed user

**Awaiting trigger**:
The finished state of a **Generation** whose PR still owes a **Trigger approval**. Nothing ran and no attempt was spent, and it is not a failure.
_Avoid_: blocked, gated (as a status name), pending approval

**Trigger approval**:
A collaborator's one-time go-ahead for a PR whose author is not a **Trusted author**. It records who approved and when, never moves once given, and from then on every push on that PR is a **Trigger** as usual.
_Avoid_: authorization, consent

**Claim**:
The hold one attempt has on a **Generation**: a run id plus a 2-minute lease its holder renews while it works. Only the holder advances, finishes or releases the Generation; a lapsed lease frees it for the next attempt. A **Job** that finds the Brief already stored settles an unheld Generation as succeeded without one.
_Avoid_: lock (graphile's lock is on the **Job**), lease (one part of the Claim)

**Claim limit**:
How many **Claims** one head of a **Generation** may take between triggers: 3. A shutdown release and a **Takeover** that made no provider call count too. A head that has taken them all, holds no live Claim and has not succeeded is exhausted: nothing claims it again until a trigger queues it afresh. Its stored failure stays as it was.
_Avoid_: attempts (the code's name for the counter, `MAX_GENERATION_ATTEMPTS`, and the trigger counter on the wire), retries (graphile's, one way a Claim is taken)

**Failure class**:
What a pusher can do about a failed **Generation**, read off its failure code. Transient: running it again may succeed. Fix-first: the instance's provider credentials or generator config, the provider account's spend limit (raised by the operator or reset by the provider), or the access GitHub grants to the repository's contents (the App's on an installed repository; on a pasted URL, the viewer's grant or the operator's token), must change before a rerun can succeed. Cannot-help: a rerun fails the same way and still spends, as with a diff GitHub will not serve, a model refusal, or output carrying a secret. Only the first two are worth regenerating. The Transient class is not the worker's `TransientJobError`: the generator's own timeout or output that cannot be read as a brief is class Transient, yet its job fails without a graphile retry.
_Avoid_: retryable (graphile's transient-versus-permanent split, which decides retries, not what a pusher can do)

**Takeover**:
The job queued with each **Claim** that wakes once the Claim's lease could have lapsed and, if it did, claims the head for a new attempt. A Takeover's own Claim queues the next one, so a Takeover that dies is taken over too, and one that fails transiently or meets a shutdown hands the head back for that next one to run. Anyone who can read the PR reads its state per head: scheduled with a start time, running, or spent (graphile ran out of attempts and nothing will take the head over).
_Avoid_: recovery (the task id `recover-generation` keeps it; in prose that word belongs to **Restore**), retry job

**Started run**:
One run the Instance started on a UTC day: every paid **Claim**, graphile retries, shutdown releases and no-call **Takeovers** included, plus a **Job** with a stored **Brief** at its first provider call. A pull request briefed in parts counts one more started run for each part, claimed together once its plan names the parts. The **Daily cap** counts started runs across every repository; the **Operator** reads the day's count against it.
_Avoid_: paid run (some started runs made no provider call), generation (the record, not one run of it)

**Daily cap**:
The **Instance config**'s `spend.maxGenerationsPerDay`: the most **Started runs** the **Instance** starts on one UTC day across every repository, each part of a run briefed in parts included; absent means 300, and `unlimited` lifts it. At the cap the worker skips the generation, the PR shows the capped **Not-ready screen** with the reset time, an existing **Entry** is updated to say so, and the head runs on its next push after the reset at 00:00 UTC. A run briefed in parts whose parts the day cannot cover stops before any part is briefed, capped with the runs it needs and the runs left; one that needs at least the whole cap is briefed only once the operator raises it.
_Avoid_: budget, quota, rate limit (GitHub's)

**Job**:
The unit of queued work the worker picks up to drive one **Generation**. A Job is queued until its debounce elapses, then held by one **Slot** while it runs. One Job per PR at a time; a new push coalesces into the existing queued Job.
_Avoid_: task, generation (the record), queued generation

**Slot**:
One concurrent **Job** a worker process admits. The slot count is the operator's throughput knob; one slot serializes every Brief behind whichever Job holds it. A worker holds two pools of slots: the normal pool, and the **Large pool**.
_Avoid_: thread, concurrency (as a noun for the thing), lane

**Large pool**:
The **Slot**s that run the Briefs predicted to take several model calls (a PR past 120 changed files or past one call's input, read off GitHub's counts before anything is claimed). A **Job** in the normal pool that predicts one moves itself there and ends; a Job in the Large pool runs whatever it was given. One slot by default, so large Briefs wait behind each other while ordinary pushes keep their slots.
_Avoid_: large queue, big-PR lane, second worker

**Queued**:
Said of a **Job** waiting on its debounce or on a free **Slot**, never of a **Generation**. A Generation whose Job has started is running.
_Avoid_: queued generation, pending job

**Wait reason**:
Why a pending **Generation** has not started, read off its **Queued** **Job**: `debouncing` while the Job's start time is still ahead, `waiting-for-slot` once it is due and no **Slot** has claimed it. The server computes it on the PR meta only; an absent reason means the generic pending line, and a Generation that is not pending never carries one.
_Avoid_: queue status, pending reason, delay reason

**Anchored generation**:
Generating a new revision's **Brief** against the previous one: groups the push did not touch are carried frozen and only touched groups get a re-look, with group and chunk ids descended through the push. It reads the **Revision span**, whatever the push (fast-forward, rebase, amend or force push): a file the span changed, a file whose hunks could not pair, a file a group shares with another group that re-looks, or an ambiguous range remap re-looks only the groups that own it. With no span every group re-looks. A **Multi-call run** anchors the same way, and the Brief keeps an **Anchor warning** for what it could not carry. The stored anchor state is `anchored`, `fresh-restart` (the generator config's `fullRegeneration` fired on a model swap) or `none` (a first Brief). Distinct from **Comment anchoring**, which places a draft on a moved line.
_Avoid_: incremental generation, partial regeneration, anchoring (bare)

**Anchor warning**:
A note an anchored **Brief** keeps on why it carried less than its push allowed: the **Revision span** could not be read, so every group re-looked, or some file's hunks could not pair across the push, so the groups owning it re-looked.
_Avoid_: anchor error, carry failure

**Stitch**:
The merge step of **Anchored generation**: carry frozen groups verbatim, judge the model's claims about re-look groups, descend ids and re-point the model's references to them. Merge only; validation, rollups and the **Unattributed remainder** come after, over the merged brief.
_Avoid_: merge (bare), splice, assemble

**Multi-call run**:
Generating a **Brief** in more than one model call because the PR is too large for one: a **Grouping call** forms the **Change-groups** and the whole-PR fields, then **Detail calls** write the **Chunks** of those groups, and the pipeline merges the answers into one Brief and validates it once. The reader gets the same Brief shape either way; the **Receipt** says which **Outline** the grouping read and which files were read **Shortened**. Over a previous Brief it is an **Anchored generation** like a single call: only the files outside frozen groups are grouped and detailed. A Brief whose single call ran out of room is retried once as a multi-call run, and a retry of that run resumes it rather than sending the single call again.
_Avoid_: split generation, chunked generation (collides with **Chunk**), batch run, large-PR mode

**Grouping call**:
The first call of a **Multi-call run**: it reads the PR text and the **Outline** of the diff and returns the **Change-groups**, the **Summary**, the **Reading order**, the **Intent check** and the hunk map, which names the group each hunk of the diff belongs to. A hunk it lists twice goes to the earlier group in reading order; a hunk it leaves out joins the **Unattributed remainder**. It writes no Chunk.
_Avoid_: planning call, outline call, first pass

**Detail call**:
One call of a **Multi-call run** after the **Grouping call**: it reads the full code of a batch of whole **Change-groups** in reading order (a group too large for one batch is split by file) together with the groups and summary the grouping call produced, and returns the **Chunks** of that batch alone, each attached to the group the hunk map gave its hunk. A hunk over the batch budget alone shows only the head lines that fit, with a note naming how many lines were left off. It never forms, renames or moves a group. A detail call of two or more hunks whose answer runs out of room is split once into two halves; a cut one-hunk call fails the run.
_Avoid_: chunk call, second pass, batch call (the batch is what it reads, not what it is)

**Outline**:
What a **Grouping call** reads of the diff: the full diff when it fits one call's input, else a compact view: every file with its status and line counts, every hunk with its header and at most a fixed number of its changed lines. The outline takes one of several forms, from the full diff down to a few changed lines per hunk, then hunk headers only, then one line per file; the run takes the fullest form that fits and the **Brief** records which. The two coarsest forms, hunk headers only and one line per file, show the model no code lines, and the **Receipt** says so.
_Avoid_: digest, skeleton, compressed diff, summary (that is the Brief's **Summary**)

**Shortened file**:
A file a **Multi-call run** shows the model by its facts rather than its code: a lockfile as its package changes (added, removed, updated, source changed), a file the repository marks generated or vendored in `.gitattributes` on its default branch as its path, status, counts and hunk headers. Those lines show in the full **Outline** form; every coarser form shows its title line alone. Its **Chunk** is written by the pipeline, not the model, carries the `generated` **Concern** and a *read as* mark, and the **Receipt** lists it; the pipeline still reads the file's full code for `adds-secret` and `changes-package-source`. A single-call Brief shortens nothing.
_Avoid_: skipped file, excluded file, collapsed file, summarized file

**Schema floor**:
The guarantee every generator adapter runs output through: validate against the output schema, salvage droppable enum slips, retry once with feedback, then dump the raw output and throw `schema-floor`, which the worker stores as the `output-invalid` failure. Native provider schema enforcement is a bonus layer, never the mechanism. Distinct from **Floor**, the five risk attributes a repository cannot quiet.
_Avoid_: validation (one step of it), floor (bare; that is the display **Floor**), output guard

**Eval harness**:
The regression net over generation quality in `tools/categorizer/eval/`: labeled real-PR cases and revision pair cases, each run several times against a provider:model-keyed record of which mechanical properties pass; `pnpm -C tools/categorizer eval`. A convention gate for generation-surface changes that a human runs and pays for, never CI. Its recorded property classes are the eval baseline, which is neither a **Comparison baseline** nor a **Checkpoint**.
_Avoid_: benchmark, test suite, baseline (bare; qualify it as the eval baseline)

**Intent check**:
A secondary section of the **Brief** comparing the change's stated intent (the PR title, the PR description, and the **Primary ticket** when one is read) against what the diff actually does. When the sources are *precise*, it reports five factual buckets: **accomplished**, **stated-but-missing**, **done-but-unstated**, **deviations**, **masked fixes** (a claimed fix where the diff only silences the problem's signal), stored camelCase (`statedButMissing`, `doneButUnstated`, `maskedFixes`); the last two carry an alarm register and drop unless grounded on both sides. When the sources are *broad* (an epic or parent) or *none*, it reports that the check is unavailable rather than guessing. It also carries the **Ticket alignment** read. Deliberately de-emphasized: the **Change-groups** carry the story; the intent check is the AI's fallible read, shown to both author and reviewer, never a verdict or focal point.
_Avoid_: requirements check, spec compliance, intent verdict, absent (the specificity value is `none`)

**Ticket alignment**:
The **Intent check**'s read of how the diff relates to the **Primary ticket**'s goal: `aligned` (delivers the goal), `partial` (serves it, one slice, an ordinary outcome), or `misaligned` (does not serve it, or reaches it by a way the ticket rules out). Carries the ticket's goal quoted verbatim and one factual sentence about the diff. Absent when there is no primary ticket, the ticket could not be read, or the sources are broad or none. Never a gate.
_Avoid_: alignment score, ticket verdict, compliance

**Product diff**:
A secondary section of the **Brief** stating how the product behaves before the PR and after it, as at most eight **Product changes**, most significant first, with a note when the PR has more. It reads the whole PR (base to head), never per reviewer and never per push. A call of its own writes it after the **Brief**, from the PR text, the diff and the Brief's **Change-groups**, so the Brief's own request never carries it. It reports "none found" for a PR that changes no outcome, and "not available" when the Brief was written in parts, which is every **Multi-call run**, so no call read the whole diff. A Brief whose Product diff call failed, or wrote no change that could be kept, has no Product diff. Like the **Intent check**, it is the AI's fallible read, never a verdict.
_Avoid_: behaviour delta, product changes (as the section name), before/after summary, changelog

**Product change**:
One entry of the **Product diff**: a condition ("when"), what the product did before, what it does after, the one area it affects, and the **Change-groups** that carry it. Centred on behaviour: the same action or condition with a different outcome, even when no screen, field or setting looks new. Refactors, tests, CI and internal tooling are not product changes unless they change an outcome. Its before states only what the diff's removed or unchanged lines show, that the behaviour did not exist, or what the PR text states; otherwise it is left empty, never guessed. A behaviour that did not exist may leave it empty too, since its source already says so.
_Avoid_: behaviour change, impact, effect

**Ticket reference**:
A mention of a ticket found in the PR description, PR title, or branch name: a **Ticket key**, a GitHub issue number, or a tracker URL. References are collected; only the **Primary ticket** is fetched.
_Avoid_: linked ticket (ambiguous with the generic linked context), issue link

**Primary ticket**:
The one **Ticket reference** the brief treats as the ticket this PR is about, chosen by precedence: references to the repo's configured tracker first, then title, branch name, description, each in reading order. The title and the branch name lead because they name the PR's own ticket, where a description also names tickets in passing. Inside the description a reference after a closing keyword comes first; it never outranks the title or the branch name, since it can mark a side fix. Only the primary is fetched and shown to the model. An unreadable primary stays primary and is reported as unread.
_Avoid_: main ticket, parent ticket, epic

**Ticket key**:
A tracker's short identifier for a ticket, `PREFIX-N`, recognized only when the prefix matches a configured **Ticket tracker**.
_Avoid_: ticket id, issue key

**Ticket tracker**:
Where a repository's tickets live, declared under `trackers` in the **Repo config**'s `settings.yaml` or, for boards every repository shares, in the **Instance config**: `github` (issues, optionally in another repository), `notion` (a database behind a **Ticket key** prefix) or `jira` (the listed projects of the one Jira Cloud site the **Instance config** names, each project key a **Ticket key** prefix). A repository file that names any tracker replaces the instance list whole.
_Avoid_: issue tracker (GitHub's is one kind), board (the Notion side of one)

**Linked context**:
Text the harness fetched from URLs in the PR description and fenced as untrusted reference data for the model. The **Primary ticket** is fenced separately from it.
_Avoid_: external context (that is the wider ADR concept), attachments

**Mark-ready gate**:
The non-blocking modal shown to the **Author** when they mark a draft ready: every **Flag** on the current head's **Brief**, each a jump, plus a reminder of unposted draft **Comments** with a checkbox to post them before the flip. Opens only when there is a flag or an unposted draft. The author may fix or proceed; it never blocks and records nothing, so the author side has no **Dismissal** or **Receipt** of its own.
_Avoid_: soft gate (the former name), pre-submit gate, block, author approval

**Comment**:
Reviewer-authored text that ships to the PR. Either a **Line comment** or a **File comment**: same object, same **Review Session** lifecycle (draft, edit, then reach GitHub by **Submit**, by **Post now**, or with the **Mark-ready gate**); only the anchor shape differs. Never AI-authored: the reviewer writes the sentence.
_Avoid_: review comment, feedback (informal only), scope (that is Full vs Changes)

**Post now**:
Sending one held draft **Comment** to GitHub as a single review comment, outside **Submit**.
_Avoid_: publish (the code's word for both ways to GitHub), send, ship (informal only)

**Line comment**:
A **Comment** anchored to a line or a line range on a file. One line and a range are the same shape. GitHub `subject_type: line`.
_Avoid_: inline comment (informal), span comment, scope (that is Full vs Changes)

**File comment**:
A **Comment** anchored to a file with no line range. Same lifecycle as any other Comment. Never outdated: there is no line to go stale against. GitHub `subject_type: file`.
_Avoid_: whole-file comment, file-scoped, scope (that is Full vs Changes)

**Attachment**:
An image a reviewer pastes or drops into a **Comment**, one kind of **Media**, pushed by the App to an orphan `mergebrief/attachments` branch of the pull request's repository, one commit per file, and linked from the comment by its GitHub URL. The comment on GitHub keeps rendering it after this instance is gone; here it is served through the read gate with the viewer's token. A repository admin can delete the branch, which breaks every image it held. Read access to the repository is enough to attach; the push is the App's, so each reviewer is bounded to a set number of files and bytes per window, counted per api replica.
_Avoid_: upload (it is a push), asset (that is GitHub's own `user-attachments` store, which has no API), screenshot (one kind of attachment)

**Media**:
An image, video or diagram inside text a person wrote on the pull request: its description or a comment. An **Attachment** is one kind. Shown on the viewer's own access: a GitHub-pasted asset and a file committed to the pull request's own repository come through the read gate; an image on any other host loads directly.
_Avoid_: attachment (one kind of Media), asset (GitHub's own pasted store), embed

**Summary Media**:
The **Media** the model picks for the **Brief summary**, by item number and never by address, plus its one optional pointer line to a set further down.
_Avoid_: hero image, cover, featured media

**Mention**:
An `@login` or `@org/team` in text a person wrote about the pull request, on GitHub or here: its description, a comment, reply or review by any **Participant**, or a reviewer's own note here, such as a **Dismissal** reason. On text that reaches GitHub, GitHub resolves it and decides who is notified; MergeBrief never notifies anyone. Shown as a link to the person or team when GitHub shows the viewer that target, and highlighted when it names the viewer; any other `@word` stays plain text.
_Avoid_: tag, ping

**Participant**:
Someone who has written in a pull request's conversation: the **Author**, and anyone who commented, replied or reviewed there.
_Avoid_: commenter, collaborator (that is access to the repository)

**Mention suggestions**:
The people and teams offered while a reviewer types `@` in text that reaches GitHub: matching **Participants** first, then whoever GitHub says can be mentioned in that repository, as that reviewer sees it.
_Avoid_: mention pool, autocomplete (the mechanism), collaborators

**Approval**:
The reviewer's human judgment ("approve / request changes / comment") submitted to GitHub. Only humans approve. The tool issues a receipt, not an approval.
_Avoid_: AI approval, double approval, sign-off (when referring to the tool)

**Submit**:
A reviewer finalizing their review on GitHub (the **Approval** plus any **Comments**). The only event that advances the reviewer's **Checkpoint**; the review body carries the **Signature line** with the **Receipt**'s counts as the **Dispositions** stand at that moment, and mere viewing never does any of this. Each **Comment** it carries reaches GitHub once.
_Avoid_: send, post, finish (informal)

**Instance config**:
`mergebrief.config.yaml`, read from the workspace root or from the path the **Operator** gives in `MERGEBRIEF_CONFIG`: the generator (provider, model, effort, `fullRegeneration`), the `drafts` policy, the `spend` cap, the `operators` list, the `allowed` lists, shared `trackers`, the `attachments` limits, the `retention` windows, the `audit` switch and the `updateCheck` switch. No file means the zero-config defaults: drafts generate with the normal debounce, a cap of 300 a day, no Operators, and so nobody who may sign in or start a brief.
_Avoid_: config (bare), settings (that is the repository's `settings.yaml`), env (the keys are named in the file, never held by it)

**Repo config**:
The `.mergebrief/` directory a repository commits, read from its default branch: `instructions.md` (**Repo instructions**), `settings.yaml` (workflow: `entryCommentOnDrafts`, `trackers`, `trustedBots`) and `policy.yaml` (**Custom attributes** and **De-emphasis**). A file that fails to fetch closes what it governs rather than guessing.
_Avoid_: repo YAML, repo settings (one file of it), project config

**Repo instructions**:
The `.mergebrief/instructions.md` file of the **Repo config**: text guidance to generation, honored strictly within the enumerated instruction classes (grouping boundaries, glossary and terminology, noise paths, reading conventions, summary phrasing). Semi-trusted: text shapes presentation and comprehension; only validated `policy.yaml` creates facts, so instructions can never mint a risk attribute, change a vocabulary or alter the schema.
_Avoid_: repo prompt, custom prompt, system prompt (it is data, never system-level)

**Custom attribute**:
A **Risk Surface** attribute a repository declares under `attributes` in `policy.yaml`: a kebab-case name, model-evaluated criteria, an optional implication, and optional path globs that pre-filter which chunks it is judged on. At most 20; flat facts with no tier, severity or weight; a name that collides with a built-in is ignored and disclosed. Extends the token set per generation.
_Avoid_: custom risk, repo rule, policy attribute

**De-emphasis**:
Display-weight tuning from `policy.yaml`: a `deEmphasize` rule names a non-floor risk attribute and, optionally, the paths it applies to, and a matching firing renders quiet (hue-shifted, excluded from the **Jump-rail**, labeled "de-emphasized by repo policy"). Detection always runs and every attribute still lands in the artifact and **Receipt**. Never suppression; applied from the generation-time policy snapshot stored with the artifact.
_Avoid_: hide, suppress, mute (nothing is removed)

**Floor**:
The five risk attributes that can never be de-emphasized: `touches-auth`, `removes-validation`, `relaxes-permissions`, `adds-secret`, `changes-package-source` (declared in `docs/vocabulary/risk-surface.md`). A `deEmphasize` rule naming one invalidates the whole policy file. A de-emphasized attribute co-firing on a chunk with a floor attribute renders un-quieted: the combination is the signal. A display guarantee, not the **Schema floor** (a generation guarantee) and not a test coverage floor.
_Avoid_: severity tier, critical attributes (the floor is a display guarantee, not a score), floor (bare, where the Schema floor could be meant)

**Jump-rail**:
The attribute-keyed disclosure in the reading toolbar, labeled "Risk attributes" with a count: fired attribute names with carrying-group counts; a chip cycles through the carrying groups in story order. Attribute-keyed, never group-ranked. Floor attributes pin first; de-emphasized firings are excluded; a floor firing dots the trigger without opening it. In code `RiskAttrsDisclosure`, fed by `AttributeRail`.
_Avoid_: risk ranking, hotspot list, Risk attributes as the disclosure's name (its on-screen label; what it lists stay risk attributes)

**Operation table**:
The one list, in the shared wire contract, of every Product Operation the API serves. Each row names one operation: whether it reads or writes, the **Access level** it needs, and its method and full path. Clients build their requests from it and the API checks its own routes against it, so a path exists in one place. Who may call beyond that level (human only, push access) is not in the table: the API holds that, keyed by the operation's id.
_Avoid_: catalog (the code comment's own word; say table), manifest, registry (the API's runtime store), route table

**Access level**:
The cumulative ladder `read` < `private-write` < `external-write`, shared by a Product Operation's row in the **Operation table** and by an API token, whose level is chosen in Settings. A token may call an operation whose level it meets.
_Avoid_: scope (reserved for Full vs Changes; the token column keeps the word), permission (GitHub's)

**Wire error code**:
The stable kebab-case identifier a non-2xx API response carries, alongside optional typed params and a composed English error line. A public, additive-only vocabulary: one code per distinct meaning, never one per call site or per HTTP status. Same code unless a translator would write a different sentence or a user would take a different action. Distinct from the internal error vocabularies (GitHub, port, and auth codes), which never ride the wire and are translated to wire codes at the response boundary. Consumers render a wire code through the shared string catalog, falling back to the English error line when the code is unknown.
_Avoid_: error kind, error message (for the identifier), status-derived kind

**Failure** (vs **Error**):
A failure is an expected outcome a caller must judge: it rides the failure side of a `Result` and is named `XxxFailure`. An error is thrown and is named `XxxError`: programmer/infra faults and, at the HTTP layer, the `ApiError` classes. The suffix carries the contract: a `Failure` type in a signature means the caller unwraps and judges; an `Error` type means it propagates to a boundary handler.
_Avoid_: using the two words interchangeably; Error-suffixed types on the Result side (in new code)

**Reviewer GitHub binding** (vs **Installation GitHub binding**):
The two GitHub identities the API acts under. The installation binding is the app's own channel: the App's installation token, bound per request to the Installation the repository resolves into, one rate budget shared across viewers. The reviewer binding is the signed-in reviewer's channel: their OAuth token behind the request's one session credential, bound once per request (by the repo gate, or by a session-only route) and shared by every call in it, the gate's own repo read included. On a token-expired failure the credential refreshes at most once per request and the call re-runs. Behind an operator pass it may retry a denied read on the operator token, never a write. Which identity a call runs under decides whose permissions and whose rate budget apply.
_Avoid_: reviewer GitHub client (the per-request client the binding replaced), viewer token (say reviewer), refresh budget (say refreshed at most once per request)

**Home**:
The page at `/`. Signed in: the one-tier **Header**, a personal line that leads with a fact only this product knows, the URL input and the **Inbox** under the on-screen label "Briefs". Signed out: the sign-in page, one heading and Sign in with GitHub, with no Header and no URL input; a signed-out brief link and Settings show the same page under their own heading. "Landing page" now means only the marketing page built later, which is not a screen of the app.
_Avoid_: landing page, picker, front door, dashboard

**Inbox**:
The list on **Home**: every pull request the **Reviewer** reaches, across every **Installation** plus the ones they pasted, each row carrying their review state, folded so the rows that still need them come first, with filters, a sort and numbered pages. The review state reads the reviewer's newer signal: the head of the newest **Brief** they submitted a review from after their **Checkpoint**, else the Checkpoint, which also wins a tie: Reviewed when that SHA is the latest Brief's head or the head GitHub reports, Updated when it is any other SHA, In progress with a **Review Session** on the latest Brief, else New. Their own pull requests carry no state. Inbox is the term in code and here; the label on screen is "Briefs".
_Avoid_: briefs list, your briefs, queue (collides with the job queue), docket

**Archive**:
A reviewer putting a pull request out of their own **Inbox**, anchored on the latest **Brief**'s head: a Brief at a new head brings it back, a retarget at the same head does not. Per reviewer, never shared, never a GitHub action.
_Avoid_: hide, dismiss (that is a **Flag**), close (GitHub's)

**PR stack**:
The chain of pull requests a PR belongs to, as GitHub links them: linear (each member has at most one open child, with the PR's 1-based index) or a fork (a parent and children). The **Brief** stores its snapshot from generation time; the **Header** shows the live one as a chip and says when the two differ.
_Avoid_: stacked diffs, train, dependency chain

**Header**:
The sticky top band of a screen. On the Brief page it is two tiers: the identity row (the home mark, PR title and state, meta chips, the terminal action, the PR-scoped overflow menu, and the **Account menu** last) and the comparison row (View and Compare, the **Newer commits** chip, and stats). Spans the full width above the **Sidebar** column; compacts on scroll but never loses its controls on a wide screen. At 880px and below it holds a back link and the home mark, or the PR title once the page's large title scrolls under it; the state badge, the PR number and the meta chips move to that large title, and the comparison row, the terminal action and the **Account menu** move to **Brief controls**. **Focus mode** has no bottom bar on a phone, so there the terminal action stays in the row. **Home** carries a one-tier Header of 52px with a hairline under it; on every screen the Brief header's mark, or the Header's lockup, is a link to Home.
_Avoid_: top chrome, top bar (the CSS variable's name, not the concept), navbar

**Newer commits**:
The Brief page's one **Header** chip for when the **Brief** on screen trails the pull request: newer commits on GitHub, or the same head on a new base. A status segment names what the latest push is doing, an attached action names the next step (Go to new brief, Retry, Generate new brief), and an info button opens a popover with the full explanation. Absent while a **Brief** for the PR's head is stored on any base and GitHub has no newer commits, unless the head's run on the current base failed or awaits its **Trigger approval**.
_Avoid_: stale chip, behind notice, latest-push notice, head-advance banner

**Account menu**:
The person-anchored menu at the end of every **Header** (inside **Brief controls** on a phone's Brief page), holding what is about the signed-in user and never about the PR: identity, Settings, Language, Keyboard shortcuts, Sign out. Trigger is the GitHub avatar when signed in, a generic person icon while the viewer is unknown, and signed out the slot holds a Sign in button instead of a menu. No placeholder rows for what is not built. Distinct from the PR-scoped overflow menu (about this PR) and the **Sidebar** (about reading this PR).
_Avoid_: user menu, profile menu, app menu, top-chrome menu

**Brief controls**:
The phone's sheet holding what the Brief page's **Header** and reading toolbar show on a wide screen: the **Account menu**, View and Compare with the **Newer commits** chip, the stats and Generated by, the thread filter, the **Jump-rail**, Start **Read-through**, Collapse supporting, Previous and Next change while comparing, and the terminal action. Opens from the first button of the phone's bottom bar at 880px and below, so it is out of reach in **Focus mode**, which has no bottom bar; it closes when the viewport stops being a phone or the **Brief** changes under it. Every control is the wide screen's own; a jump, Start **Read-through** and the terminal action close the sheet first.
_Avoid_: settings sheet (Settings is its own page), menu, more menu, mobile menu, toolbar sheet

**Sidebar**:
The Brief page's permanent right-edge column, PR-contextual only, always present on wide screens. Two states: **collapsed**, the group-TOC lines (hover reveals the group name, the current group is marked) plus the expand control and the page's small utilities at its foot, and **expanded**, where it widens to show one **Tab** beside those same lines, narrowing the reading column rather than covering it. Nothing on the sidebar competes with change groups and chunks for attention: no counts on the collapsed sidebar, at most a presence dot. Hidden wherever the group TOC is hidden (**Focus mode**, Changes **Scope**). Below the tablet breakpoint the same two states render differently: collapsed is a bar on the bottom edge (group lines as a position indicator between previous/next arrows, plus the same small utilities), expanded is a sheet rising from it that covers the page while open, so a jump collapses it. At 880px and below that bar gives way to the phone's bottom bar: **Brief controls**, the chunk position, which opens the same sheet, and previous/next chunk. Scroll to top has no place on a phone, and Keyboard shortcuts sits in the **Account menu** inside **Brief controls**.
_Avoid_: rail (that is the **Jump-rail**), panel, drawer, shell, tenant (the API's multi-tenancy noun)

**Tab**:
One surface housed in the expanded **Sidebar**, shown one at a time via a tabs row that lists only the tabs that exist. "This PR", the group list, is the first, then "Revisions", the PR's revisions newest first, which is where a reader moves between them; Activity and Repo chat are candidates, each earning its place through its own ticket. Conversation is not a tab: it stays in the reading flow.
_Avoid_: tenant, inhabitant, view (that is the URL scope param), pane

**Not-ready screen**:
What the Brief page shows in place of a **Brief** while there is none to read: waiting, generating, failed, capped, awaiting its trigger, empty, superseded, or an error. One concept with eight states; in code one card per state under `PrBrief` (`WaitCard`, `FailedCard`, `CappedCard`, `AwaitingTriggerCard`, `EmptyCard`, `SupersededCard`, `PrBriefError`).
_Avoid_: state card, error card, placeholder

**Focus mode**:
The reading mode that strips the Brief page to one chunk at a time on a wide column. Summary, toolbar, conversation, group TOC and **Sidebar** are all hidden; a pill at the top carries progress and the single exit, and the **Context panel** sits beside the chunk. A mode of the page, not a filter of its content.
_Avoid_: zen mode (code-internal only), distraction-free, reading mode (every mode is for reading)

**Context panel**:
The dismissible panel on the right edge in **Focus mode**: the focused **Change-group** (title, summary, categories, core line total), the group's chunk strip with the reader's place marked, and the current chunk's file facts and risks. Non-modal, so the diff beside it stays readable and usable. It opens on each new group; hiding it holds until the reader leaves that group. In code `FocusPanel`.
_Avoid_: rail (that is the **Jump-rail**), sidebar (that is the **Sidebar**), drawer, overlay (that is the **Comparison overlay**)

**Change-group card**:
The card beside each **Change-group** in the **Story view** outside **Focus mode**: the group's title, summary and categories, the reader's choice of **Dominant Category**, the group's chunk list with the reader's place marked, and its **Risk Surface**. It describes a group in the same words as the **Context panel**; only the Change-group card lets the reader record a **Reclassification** or a **Disposition** on its flags. In code `GroupCard`.
_Avoid_: group header, panel (that is the **Context panel**), rail (that is the **Jump-rail**)

**Scope** (Full vs Changes):
Which slice of the Brief the page shows: **Full** is the whole story flow; **Changes** is the compare view between two revisions: the summary plus the changed lines, reviewable in place. Scope and **Focus mode** are the two reading modes that together decide which page regions render; that decision is made once, never per region.
_Avoid_: view (the URL param's name, not the concept), tab (that is a **Sidebar** surface), filter (the toolbar Filter governs inline threads)

**Scroll to target**:
Putting the reader on a chunk, group, row, rail or section target, once, with the page settled: the card opened, the viewport scrolled, focus placed, the target flashed. One scroll to target at a time; a new **Brief** cancels the one in flight. In code, names built on `Scroll` name the whole mechanism (`useScrollToTarget`, `ParkedScroll`); one viewport move inside it is a scroll action (`ScrollActionKinds`).
_Avoid_: landing, jump (the gesture that asks for one), deep link (the URL that asks for one)

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
_Avoid_: side-by-side (informal only), two-up, dual pane, bare split (that is the Concern **Split**)

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
The person who runs an **Instance**: installs it, upgrades it, backs up its database, reads its log. In the app, a GitHub user the Instance's config lists under `operators` by numeric user id; an Operator reads instance-wide state no repository access scopes, such as the day's spend. Every other signed-in user sees the **Version notice** too, and the upgrade step runs on the host. The URL fallback token (`MERGEBRIEF_URL_FALLBACK_TOKEN`) belongs to whoever runs the Instance, but owning it grants nothing here: only the `operators` list makes a user an Operator.
_Avoid_: admin (no such role; repo admin is GitHub's per-repository permission), self-hoster (informal only), maintainer (that is the project's)

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
- A **Multi-call run** is one **Grouping call** then zero or more **Detail calls** (none when no group holds a hunk read in full, as when every file is **Shortened**); its **Brief** is the same artifact a single call produces, plus the **Outline** form it read and a *read as* mark on each **Shortened file**'s **Chunk**.
- A **Chunk** belongs to exactly one **Change-group**, has one **Concern**, one **Role** (core/supporting), zero or more **Risk Surface** attributes, and its own **LoC** (added and deleted).
- The brief is read by **Change-group** in **Reading order**; the **Split** shows the same chunk set by Concern. LoC rolls up under both; the **Unattributed remainder** is the last group in one and the last Split segment in the other, so both totals cover the whole diff.
- A full **Brief** at a given SHA is shared across all reviewers of that SHA. A **Delta Brief** spans a **Checkpoint** SHA to the current head and is shared by every reviewer at that Checkpoint, so two reviewers at different checkpoints read different Delta Briefs over different commit spans. New pushes (debounced) move the head, after which a fresh full Brief and new Delta Briefs become available.
- A **Comparison overlay** applies one **Comparison baseline** to the current **Brief**; **Previous Brief** uses shared **Revision changes** + **Revision narrative**, while **Checkpoint** uses the reviewer's **Delta Brief** and matching changed-line marks.
- **Revision changes** and a **Revision narrative** both span the shared **Previous Brief** → current-head revision; the former marks lines mechanically, while the latter explains those marked changes.
- Each (PR × Reviewer) pairing has one private **Review Session** per **Brief**; the first write to a newer Brief's session materializes it from the last, stamping each **Disposition** with a **Carry-over status** and listing what it could not place on the **Attention list**.
- A **Comment** belongs to a reviewer and ships to the PR. It is a **Line comment** or a **File comment**; a **Chunk** does not own it.
- A reviewer records a **Disposition** on a **Flag**: **addressed** (with **Evidence**) or **dismissed** (with reason). The **Receipt** shows the Dispositions as they stand at **Submit**. A Flag may carry a **Risk note**.
- On submit, the review lands natively on GitHub (comments plus approve, request changes or comment) authored by the reviewer; the **Signature line** carries the **Receipt**'s counts. The review otherwise reads as a normal human review.
- A **Brief**'s **Trigger** (compute) is independent of its **Entry** (human reach): compute fires on every push, drafts included unless the **Instance config** turns drafts off, and on a PR whose author is not a **Trusted author** once it has its **Trigger approval**; the **Entry** comment posts on drafts too unless the **Repo config** opts out, and then waits for ready.
- The **Analysis Layer** is reviewer-agnostic; a human reviewer consumes it through the **Engagement Layer**.

## Example dialogue

> **PM:** "When the reviewer dismisses a **Flag**, does the **Author** see the agent's original reasoning?"
> **Eng:** "No. Only the **Dismissal** and the reviewer's stated reason show on the **Receipt**; the receipt is the public surface and the **Review Session** is the private one."

> **PM:** "What if the **AI** is wrong about the **Category** for a group?"
> **Eng:** "The reviewer records a **Reclassification** in one click on the **Change-group card**. The Brief keeps its generated Category; the override lives on the Review Session."

## Retired terms

- **"Critical area"**: bundled verdict into attributes. Split into **Risk Surface** (factual per-chunk attributes) and **Flag** (one item needing attention or dismissal).
- **"Risk category"**: **Category** is the Change-group's intent. Say **attribute**; the catalog implication is what it means, a **Risk note** is why it fired here.
- **"Approval"** for AI verification: only humans **Approve**; the tool issues a **Receipt**, scoped to mechanical claims.
- **"Dismissal"** for the whole decision: **Disposition** is the umbrella (*addressed* or *dismissed*); **Dismissal** is only the *dismissed* value.
- **"User"**: ambiguous between author and reviewer. Say **Reviewer** or **Author**; the Author surface is the same shared **Brief** plus the **Intent check** and the **Mark-ready gate**.
- **"Pure AI code review comments"**: the agent never authors text that ships as a **Comment**.
- **Intent on the chunk**: intent (**Category**, **Summary**) lives on the **Change-group**; the chunk carries **Concern**, **Role** and **LoC**.
- **`test-only` / `config-only` / `generated-code` as Categories**: artifact, not intent. They are **Concern** values.
- **"spec"**: the `spec` Concern is a specification document; `.spec.ts` and `.test.ts` files are `test`.
- **"A file with multiple changes"**: the **Chunk**, not the file, is the atomic unit and is sub-file. Interleaved multiplicity within one inseparable span is the one unhandled case.
- **"Scope" for a Comment's extent**: **Scope** is Full vs Changes. A Comment is a **Line comment** or a **File comment**.
- **"Coverage disclosure"** for leftover lines: they are the **Unattributed remainder**, a last **Change-group** of unattributed **Chunks**.
- **"production"** as the core Concern: bakes in a deployment assumption. It is `implementation`.
- **"Activation"**: one word for what fires compute and how a human reaches the brief. Split into **Trigger** and **Entry**; the draft opt-out is a `settings.yaml` key, not a third concept.
- **"AI-authorship signals"** as a grouping: Risk Surface attributes are authorship-agnostic facts, and an "AI-ish" grouping asserts authorship the tool cannot know. `new-dependency`, `new-abstraction` and `comment-contradicts-code` ship as ordinary attributes.
- **"Potential issues" from an external context manager**: a tool asserting AI-hypothesized issues is the bug-bot the product is positioned against. External context may enrich the **Intent check** and **Risk Surface** with cited facts only, never a verdict.
