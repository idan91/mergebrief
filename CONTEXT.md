# Code Review Tool — Context

Comprehension scaffolding for human reviewers of pull requests. Not another reviewer bot. The tool's job is to restore *engagement* and *comprehension* to code review in an AI-authored world, by re-unitizing the diff from "lines" to "categorized chunks with playbooks", and by separating AI assistance from AI authorship.

> This file defines the *meaning* of each term. For the authoritative closed list of valid labeling **tokens** (the current Category / Concern / Role / Risk-Surface values + quick rules), see `docs/mvp/labeling-schema.md` — the controlled vocabulary. A token is not valid unless registered there.

## Language

**Brief**:
The comprehension artifact the tool produces for a PR — summary, multi-tag categorization per chunk, per-category playbooks, risk-surface attributes. Computed on activation, cached by commit SHA.
_Avoid_: report, analysis, AI summary

**Delta Brief**:
The comprehension artifact for re-review — what changed for THIS reviewer's mental model since they last looked: new chunks tagged, flag resolution status, comment-target tracking, playbook delta, net receipt diff.
_Avoid_: incremental brief, diff-of-diff (informal only), update

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

**Dismissal**:
A reviewer's recorded decision not to act on a flag, accompanied by a reason. Dismissals appear on the receipt with reason verbatim.
_Avoid_: ignore, skip, override

**Uncertain**:
The AI's explicit label on categorization or flag output when its confidence is below threshold. Forces human judgment exactly where AI is weakest.
_Avoid_: low confidence (informal only), unknown, maybe

**Receipt**:
The scoped tool-verification content: mechanical claims the tool verified, what it didn't check, and the disposition of flags (addressed vs dismissed with reason). Never an "approval". Delivered via the **Review Summary** linked from the signature line on the GitHub review — not inlined into the review body.
_Avoid_: AI approval, stamp, attestation

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

**Activation**:
The state transition when a human first clicks the deep-link button on a PR's tool-comment. Before activation: no compute fires. After activation: brief computes, and subsequent pushes auto-trigger debounced delta recompute.
_Avoid_: enable, turn on, open

**Comment**:
Reviewer-authored prose that ships to the PR. In this product, comments are never AI-authored — the agent provides structure (seeds) and post-hoc validation, but the reviewer writes the sentence.
_Avoid_: review comment, feedback (informal only)

**Seed**:
A structured, non-prose hint from the agent — `{ category, location, issue-shape }` — that a stuck reviewer can expand into their own comment. Seeds are scaffolding, not drafts.
_Avoid_: suggestion, draft, AI comment

**Approval**:
The reviewer's human judgment ("approve / request changes / comment") submitted to GitHub. Only humans approve. The tool issues a receipt, not an approval.
_Avoid_: AI approval, double approval, sign-off (when referring to the tool)

## Relationships

- A **PR** has at most one **Brief** per commit SHA. The brief is **shared** across reviewers.
- A **Brief** contains many **Chunks**, clustered into **Change-groups**. A chunk is a contiguous run of changed lines sharing one Concern and one Change-group; a git hunk may be split into multiple chunks, and one file's chunks may span multiple Change-groups.
- A **Change-group** has one **Categorization** (one or more **Categories**, exactly one **Dominant**), one **Summary**, and inherits a **Playbook** from its **Dominant Category**. A group spans one carrier chunk plus zero or more supporting chunks.
- A **Chunk** belongs to exactly one **Change-group**, has one **Concern**, one **Role** (carrier/supporting), zero or more **Risk Surface** attributes, and its own **LoC** (+added/−deleted).
- The brief is read through two pivots over the same chunk set: the **Story view** (by Change-group) and the **Concern view** (by Concern). LoC rolls up under both.
- A new push to an **Activated** PR produces a **Delta Brief** (debounced) relative to the previous SHA's brief.
- Each (PR × Reviewer) pairing has one private **Mind-Map Space**.
- A **Comment** belongs to a reviewer and ships to the PR. A **Seed** belongs to a chunk in the brief and never ships.
- A **Flag** can be **addressed** (responded to by a comment that targets it) or **dismissed** (recorded with reason).
- On submit, the review lands **natively on GitHub** (comments + approve/request-changes) authored by the reviewer. A **Signature line** links to the static **Review Summary**, which renders the **Receipt**. The review otherwise reads as a normal human review. Receipt aggregates across all reviewers when multi-reviewer.
- The **Analysis Layer** is reviewer-agnostic. A human reviewer consumes it through the **Engagement Layer** (v1). An AI-agent reviewer consumes it directly via API (v1.5+ headless) — the no-AI-prose rule and Mind-Map Space are human-mode only and do not apply to agent-mode.

## Example dialogue

> **PM:** "When the reviewer dismisses a **Flag**, does the **Author** see the agent's original reasoning?"
> **Eng:** "No — only the **Dismissal** + the reviewer's stated reason show on the **Receipt**. The agent's challenge stays inside the **Mind-Map Space**. The receipt is the public surface, the mind-map is the private one."

> **PM:** "What if the **AI** is wrong about the **Category** for a chunk?"
> **Eng:** "Reviewer reclassifies it in one click. The **Playbook** swaps automatically. The receipt notes 'N chunks reclassified by reviewer' — the tool stays honest about what it got and what the human corrected."

## Flagged ambiguities

- **"Critical area"** was rejected as terminology. It bundled *verdict* into what should be *attributes*. Resolved: split into **Risk Surface** (factual per-chunk attributes) and **Flag** (a specific item needing attention or dismissal).
- **"Approval"** was used ambiguously to mean reviewer judgment AND AI verification. Resolved: only humans **Approve**. The tool issues a **Receipt**, scoped to mechanical claims.
- **"User"** in early scope was ambiguous (author vs reviewer). Resolved: v1 product surface is **Reviewer**-only; the **Author** surface is v2 and explicitly named when referenced.
- **"Critical code areas might mislead reviewer"** — the original concern was anchoring bias. Resolved by Risk Surface + Playbook + no-verdict model. Anchoring is the design's chief enemy at the brief layer.
- **"Pure AI code review comments"** was an informal phrase. Resolved as a strict product rule: the agent never authors prose that ships as a **Comment**. Seeds and validation only.
- **Intent lived on the chunk** in the original model. Resolved: intent (**Category**, **Summary**) lives on the **Change-group**; the chunk carries **Concern**, **Role**, and **LoC**. A test/doc chunk supports a group's intent rather than re-deriving its own. See ADR 0005.
- **`test-only` / `config-only` / `generated-code` as Categories** conflated *artifact* with *intent*. Resolved: these are **Concern** values, not Categories. Category is purely intent (what kind of change); Concern is artifact (what kind of file).
- **"spec" is overloaded** — `.spec.ts` test files vs specification documents. Resolved default: `spec` Concern = specification document; `.spec.ts`/`.test.ts` → `test` Concern.
- **"A file with multiple changes/concerns"** — resolved: the **Chunk** (not the file) is the atomic unit and is sub-file. Separable multiplicity (different intents or concerns in different parts of a file) is handled by splitting into multiple chunks across groups/concerns. *Interleaved* multiplicity within one inseparable contiguous span is the one unhandled case → deferred sub-operation tree (ADR 0005).
- **"production" rejected** as the carrier-concern name — bakes in a deployment assumption. Resolved: `implementation`.
