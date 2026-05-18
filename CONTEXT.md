# Code Review Tool — Context

Comprehension scaffolding for human reviewers of pull requests. Not another reviewer bot. The tool's job is to restore *engagement* and *comprehension* to code review in an AI-authored world, by re-unitizing the diff from "lines" to "categorized chunks with playbooks", and by separating AI assistance from AI authorship.

## Language

**Brief**:
The comprehension artifact the tool produces for a PR — summary, multi-tag categorization per chunk, per-category playbooks, risk-surface attributes. Computed on activation, cached by commit SHA.
_Avoid_: report, analysis, AI summary

**Delta Brief**:
The comprehension artifact for re-review — what changed for THIS reviewer's mental model since they last looked: new chunks tagged, flag resolution status, comment-target tracking, playbook delta, net receipt diff.
_Avoid_: incremental brief, diff-of-diff (informal only), update

**Category**:
A tag describing the *intent* of a diff chunk, not opinion about it. Examples: `pure-move`, `move-with-edits`, `lib-bump`, `logic-refactor`, `new-feature`, `bugfix`, `schema-change`, `test-only`, `config-only`, `generated-code`, `dependency-update`. A chunk may carry multiple categories.
_Avoid_: type, classification, label, kind

**Dominant Category**:
The primary category surfaced for a chunk that carries multiple tags.
_Avoid_: main tag, primary type

**Playbook**:
A templated, domain-rule checklist of items to verify for a given category. Not AI-generated hypotheses — known engineering checklists per change type. Example for `lib-bump`: "verify breaking changes from changelog, all call sites updated."
_Avoid_: checklist, rules, review template

**Risk Surface**:
Factual attributes attached to a chunk that indicate elevated review attention is warranted: `touches-auth`, `no-tests`, `mutates-state`, `external-io`, `removes-validation`, etc. Attributes only — never verdicts.
_Avoid_: critical area, hot spot, risky code

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
The scoped tool-verification artifact appended to the reviewer's final review. Reports mechanical claims the tool verified, what it didn't check, and the disposition of flags (addressed vs dismissed with reason). Never an "approval".
_Avoid_: AI approval, signature, stamp, attestation

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
- A **Brief** contains many **Chunks**. Each chunk has one or more **Categories** (one of which is **Dominant**), zero or more **Risk Surface** attributes, and inherits a **Playbook** from its dominant category.
- A new push to an **Activated** PR produces a **Delta Brief** (debounced) relative to the previous SHA's brief.
- Each (PR × Reviewer) pairing has one private **Mind-Map Space**.
- A **Comment** belongs to a reviewer and ships to the PR. A **Seed** belongs to a chunk in the brief and never ships.
- A **Flag** can be **addressed** (responded to by a comment that targets it) or **dismissed** (recorded with reason).
- A final **Approval** + **Receipt** ships together to GitHub on review submit. Receipt aggregates across all reviewers when multi-reviewer.

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
