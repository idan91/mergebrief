# Brief / review

An open-source, self-hostable **comprehension layer for code review.** It turns a pull request
from a flat file-list into a **Brief**: changes re-unitized into categorized **Change-groups**,
each with a plain-language summary, a per-category **Playbook** (the known checklist for that
kind of change), and **Risk Surface** attributes — facts worth a closer look, never a verdict.

Brief doesn't try to spot bugs. It organizes the review itself: the author hands over a change
with its story already told, the reviewer follows that story instead of reconstructing it from
the diff, attention lands where it's needed, and it takes fewer review iterations to reach a
confident merge.

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
- **Facts, never verdicts.** Risk Surface attributes are factual observations a reviewer can
  check in seconds (`no-tests`, `mutates-state`, `external-io`, …), mechanically confirmed
  against the diff where that's possible. The tool never scores, approves, or rejects —
  it produces a **Receipt** of what it checked, and the human makes the call.

See [`docs/vision.md`](./docs/vision.md) for the full charter, including what this project
deliberately refuses to be (no hosted SaaS, no moat-building, no AI-authored review comments).

## Self-host (one command)

With Docker installed:

```bash
git clone https://github.com/Idan91/code-review.git
cd code-review
cp .env.example .env    # GitHub App creds + your Anthropic key
docker compose up -d
```

That's the whole product running: Postgres, the web app on
http://localhost:3000, and a background worker that generates a Brief for
**every push to every PR** on the repos your GitHub App is installed on —
no manual step. Setup details (App registration, env table, verification):
[`docs/self-host/compose.md`](./docs/self-host/compose.md).

## Quickstart (local dev loop, no Docker)

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
| **Risk Surface** | Factual attributes per chunk (`no-tests`, `touches-auth`, `comment-contradicts-code`, …), each checkable in seconds — never a severity score |
| **Receipt** | What the tool verified and what it didn't, plus the disposition of every flag (addressed / dismissed with reason). Never an approval |

## Project layout

```
apps/web/             the web app (picker, Brief renderer, review session)
tools/categorizer/    the engine: PR diff → categorized Brief (CLI + library)
packages/persistence/ the self-host backend's data layer (Postgres, in progress)
docs/                 vision, ADRs, domain model (CONTEXT.md), roadmap
```

## Your data (what's stored, and how forgetting works)

The self-host backend (in progress) keeps everything in **your own Postgres, on your own
infrastructure, with your own API key** — nothing leaves your network, and there is no
telemetry. What it stores is deliberately minimal:

- **Stored:** generated Briefs and revision summaries (descriptions *of* your code), review
  positions (which commit each reviewer last reviewed), and encrypted login sessions.
- **Not stored:** your code. Diffs are fetched live from GitHub per session and thrown away —
  with one documented, configurable exception (a baseline diff snapshot that keeps
  re-review comparisons working after a force-push; `PERSIST_BASELINE_SNAPSHOT`, on by
  default for self-host, off if you want strictly nothing code-shaped at rest).
- **Also not stored:** comment text (comments live on GitHub), emails, or IP addresses.

**Forgetting is built in, and it's your policy, not ours.** GitHub stays the source of truth,
so stored artifacts are safe to expire: a per-repo retention setting sweeps a PR's artifacts
after it closes (or keeps them forever — retention "never" is a first-class setting).
Uninstalling the GitHub App erases the installation's data completely. Erasure is enforced by
the database itself (every artifact cascades from its PR — no forgotten table), and each
deletion appends one anonymous, numbers-only entry to an audit ledger, so you can prove *that*
something was erased without retaining *what*.

## Status

This project follows [`docs/oss-roadmap.md`](./docs/oss-roadmap.md) — an early-stage, actively
developed OSS project, not a finished product. The domain model is documented in
[`CONTEXT.md`](./CONTEXT.md); architectural decisions are recorded as ADRs under
[`docs/adr/`](./docs/adr/).

## Contributing

The taxonomy and Playbooks are the contribution surface — an ESLint-rules-style commons of
review knowledge, kept in plain markdown. Adding a failure mode to a Playbook or proposing a
Risk-Surface attribute needs no code at all. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

TBD.
