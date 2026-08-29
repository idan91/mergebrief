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
no manual step. Setup details (App registration, env table, verification,
hardening before you expose it):
[`docs/self-host/compose.md`](./docs/self-host/compose.md). Upgrades,
migrations, and backup/restore:
[`docs/self-host/operations.md`](./docs/self-host/operations.md).

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

## Generation backends (pick your model — or your subscription)

Briefs generate through one of six interchangeable backends, all held to
the same hard floor (schema-valid output or a loud failure): **Anthropic
API** (the zero-config default; `claude-sonnet-5` is the documented cost
knob), **OpenAI API**, **OpenRouter** (any slug with structured outputs),
or — for the local dev loop — the **Claude Code**, **Codex** and **Cursor
CLIs**, which generate on the subscription you already pay for. One optional
`mergebrief.config.yaml` selects the backend for the worker, the web app,
and the categorizer CLIs alike (the `mergebrief` HTTP client below never
constructs a generator).

**The CLI backends are local-only in v1, deliberately.** A container never
sees your installed CLI or your login, and API-key mode erases the cost
advantage that makes CLI backends attractive — so the deployed worker stays
on API backends. Running the vendor's own CLI against your own subscription
on your own machine is documented by both vendors as supported; the caveats
worth knowing before you rely on it are in the generators doc.
Full config surface, per-provider notes, and the boundary reasoning:
[`docs/self-host/generators.md`](./docs/self-host/generators.md).

**Repos can shape their own briefs** by committing a `.mergebrief/`
directory — custom risk attributes and display tuning (`policy.yaml`),
text guidance to generation (`instructions.md`), and workflow settings
(`settings.yaml`), all read from the default branch with full origin tracking on
every brief: [`docs/self-host/repo-config.md`](./docs/self-host/repo-config.md).

## The CLI (humans + agents)

The same review loop, scriptable: **`mergebrief`** ([packages/cli](packages/cli/README.md))
drives `pr` → `groups` → `diff --group` → `submit` over your deployment's API with an
opaque token minted in the web app. `--json` output is a stability-promised contract
(passthrough server shapes, additive-only, a 6-code exit table), which makes it safe to
hand to an AI agent unattended — install the packaged skill with
`npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>`
([skills/mergebrief](skills/mergebrief/SKILL.md)).
Deploy-side setup: [docs/self-host/cli.md](docs/self-host/cli.md).

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
