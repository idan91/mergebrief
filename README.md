# Brief / review

An open-source, self-hostable **comprehension layer for code review.** It turns a pull request
from a flat file-list into a **Brief**: changes re-unitized into categorized **Change-groups**,
each with a plain-language summary, a per-category **Playbook** (the known checklist for that
kind of change), and **Risk Surface** attributes — facts worth a closer look, never a verdict.

Built for the reality that a machine wrote a lot of this code. Brief doesn't try to spot bugs;
it routes attention to the places AI-authored diffs characteristically need a closer look, and
gives a reviewer a structured way to see what actually changed and why.

## Why this, and not [CodeRabbit](https://www.coderabbit.ai/) or another AI review bot?

Most AI review tools treat a PR generically: summarize it, maybe flag a few "potential issues."
Brief is built around a different idea — **a stable, cross-PR taxonomy is more valuable than a
one-off summary.** Every Change-group gets a Category from a fixed vocabulary
(`pure-move`, `schema-change`, `lib-bump`, `logic-refactor`, …), so the same kind of change is
recognizable across every PR you ever review, and a Playbook can attach to it reliably.

- **Open and self-hostable.** One core, `docker compose up`, your infrastructure, your data.
- **BYOK, no per-seat cost, no telemetry.** Your model key, your spend. Self-hosted instances
  send nothing back to us, by design.
- **Hackable.** The taxonomy and Playbooks are plain markdown — read them, extend them,
  contribute to them. An ESLint-rules-style commons, not a black box.
- **Facts, never verdicts.** Risk Surface attributes are deterministic and factual
  (`no-tests`, `mutates-state`, `external-io`, …). The tool never scores, approves, or rejects —
  it produces a **Receipt** of what it checked, and the human makes the call.

See [`docs/vision.md`](./docs/vision.md) for the full charter, including what this project
deliberately refuses to be (no hosted SaaS, no moat-building, no AI-authored review comments).

## Quickstart (self-hosted, local loop)

Requires Node 20.6+, [`pnpm`](https://pnpm.io), and an authenticated [`gh`](https://cli.github.com)
CLI (used to fetch PR diffs — no separate GitHub token setup).

```bash
git clone https://github.com/Idan91/code-review.git
cd code-review
pnpm install

# Anthropic API key — get one (and credits) from https://console.anthropic.com
cp apps/web/.env.example apps/web/.env
# edit apps/web/.env and set ANTHROPIC_API_KEY=sk-ant-...

pnpm dev
```

Open the printed local URL, paste a public GitHub PR URL into the picker, and click **Generate**.
The Brief is generated once per head SHA and cached under `tools/categorizer/out/`; reopening the
same PR reuses it at no extra cost.

Prefer the terminal? `tools/categorizer` exposes the same engine as a CLI —
see [`tools/categorizer/README.md`](./tools/categorizer/README.md).

## What you get

| | |
|---|---|
| **Story view** | The Brief grouped by Change-group: what changed, why, and the Playbook for that category |
| **Concern view** | The same diff pivoted by artifact (implementation vs test vs doc vs config) — how much of the PR is real change vs scaffolding |
| **Risk Surface** | Factual, deterministic attributes per chunk (`no-tests`, `touches-auth`, `widely-imported`, …) — never a severity score |
| **Receipt** | What the tool verified and what it didn't, plus the disposition of every flag (addressed / dismissed with reason). Never an approval |

## Project layout

```
apps/web/            the web app (picker, Brief renderer, review session)
tools/categorizer/    the engine: PR diff → categorized Brief (CLI + library)
docs/                 vision, ADRs, domain model (CONTEXT.md), roadmap
```

## Status

This project follows [`docs/oss-roadmap.md`](./docs/oss-roadmap.md) — an early-stage, actively
developed OSS project, not a finished product. The domain model is documented in
[`CONTEXT.md`](./CONTEXT.md); architectural decisions are recorded as ADRs under
[`docs/adr/`](./docs/adr/).

## License

TBD.
