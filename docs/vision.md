# Vision & Charter

> The single statement of what this project is, who it's for, and what it refuses to be.
> For the prioritized work that follows from it, see [`oss-roadmap.md`](./oss-roadmap.md).
> For the decision that set this direction, see [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md).

## What it is

An **open-source, self-hostable comprehension layer for code review.** It turns a pull
request from a flat file-list into a **Brief**: changes re-unitized into categorized
**Change-groups**, each with a plain-language summary, a per-category **playbook** (the
known checklist for that kind of change), risk-surface attributes, and — across pushes — a
**delta** of what moved. It restores *engagement and comprehension* to review in a world
where most code is AI-authored, without becoming another bug-bot.

It separates **AI assistance from AI authorship**: the tool provides structure and post-hoc
verification (a **Receipt**, never an approval); the human writes the comment and makes the call.

## Who it's for

The **individual engineer or team that wants to self-host a good review tool** — run it on
their own infrastructure, with their own model key (**BYOK**), with code and keys never
leaving their control. Not a procurement buyer. Not an org being sold a seat. The adopter is
a peer who tries it because it's genuinely useful and open.

## Why it's different from CodeRabbit (and the rest)

CodeRabbit's **Atlas** ("CodeRabbit Review") shipped the same core idea — semantic
**cohorts**, dependency-ordered **layers**, per-range AI summaries, no prescriptive verdict.
It is well-built and funded. We do not win by out-featuring it. We win on the axes a closed,
funded SaaS structurally cannot occupy:

- **Open & self-hostable.** One core, `docker compose up`, your infrastructure, your data.
- **BYOK, no per-seat cost, no telemetry.** Your model key, your spend, nothing phones home.
- **Hackable and forkable.** The taxonomy and playbooks are plain markdown you can read,
  extend, and contribute to — an ESLint-rules-style commons, not a black box.
- **Stable cross-PR taxonomy under the narrative.** Atlas's cohorts are PR-local. Ours sit on
  a **stable category taxonomy** (`pure-move`, `schema-change`, `lib-bump`…) that is
  queryable across PRs and *anchors a playbook* — narrative-on-top-of-taxonomy, the layer
  they don't have.
- **No-verdict, receipt-not-approval values.** A point of view about trust, stated in the open.

The goal is **a quality OSS project with good word-of-mouth** — something good engineers use
in the open, and a credible piece of public work. Mindshare for the thesis, not market share.

## Non-goals (what this project refuses to be)

- **No hosted SaaS / commercial arm.** Decided, not deferred. See [ADR 0023](./adr/0023-oss-only-no-hosted-arm.md).
- **No moat-building.** No data-exhaust capture, no org-learned-playbook lock-in, no
  switching-cost engineering. Defensibility is not the game; usefulness in the open is.
- **No telemetry.** Self-hosted instances produce no analytics back to us, by design.
- **Not chasing the arms race.** No competing with Atlas on semantic/code-graph depth,
  generated diagrams, or LanceDB-scale search. Win on first-run experience, clarity, taste.
- **Not a bug-bot.** No AI-hypothesized "potential issues" presented as verdicts. Facts and
  checklists, never opinions dressed as findings (ADR 0003 / ADR 0014).
- **Not an AI ghost-writer for review comments.** The agent seeds and verifies; the human writes.

## What stays true from before

The domain model (`CONTEXT.md`), the labeling schema, the playbook library, the no-verdict /
receipt design, and the self-host architecture (Postgres-only, ADR 0015; per-instance GitHub
App, ADR 0016) all carry forward unchanged. What's gone is the *commercial scaffolding* built
around them — see [`archive/`](./archive/).
