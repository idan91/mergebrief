# MergeBrief

A source-available, self-hostable **comprehension layer for code review.** It turns a pull request
from a flat file-list into a **Brief**: changes re-unitized into categorized **Change-groups**,
each with a plain-language summary and **Risk Surface** attributes: facts worth a closer look,
never a verdict.

MergeBrief doesn't try to spot bugs. It organizes the review itself: the author hands over a change
with its story already told, the reviewer follows that story instead of reconstructing it from
the diff, attention lands where it's needed, and it takes fewer review iterations to reach a
confident merge.

## Why this, and not [CodeRabbit](https://www.coderabbit.ai/) or another AI review bot?

Most AI review tools treat a PR generically: summarize it, maybe flag a few "potential issues."
MergeBrief is built around a different idea: **a stable, cross-PR taxonomy is more valuable than a
one-off summary.** Every Change-group gets a Category from a fixed vocabulary
(`pure-move`, `schema-change`, `lib-bump`, `logic-refactor`, …), so the same kind of change is
recognizable across every PR you ever review.

- **Open and self-hostable.** One core, `docker compose up`, your infrastructure, your data.
- **BYOK, no per-seat cost, no telemetry.** Your model key, your spend. Self-hosted instances
  send nothing back to us, by design. Beyond the GitHub API and your model provider, the
  outbound requests are the update check, the links a PR cites and any ticket tracker you
  configure. The update check is an hourly fetch of a public release file from GitHub that
  carries nothing about your instance; `MERGEBRIEF_UPDATE_CHECK=false` turns it off. For
  context, the worker reads up to five public links from a PR's description, and a tracker
  such as Notion when you configure one.
- **Hackable.** The taxonomy is documented in plain markdown: read it, extend it, propose
  to it. An ESLint-rules-style commons, not a black box.
- **Facts, never verdicts.** Risk Surface attributes are factual observations a reviewer can
  check in seconds (`no-tests`, `mutates-state`, `external-io`, …), mechanically confirmed
  against the diff where that's possible. The tool never scores, approves, or rejects.
  It produces a **Receipt** of what it checked, and the human makes the call.

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
http://localhost:3000, and a background worker that briefs **the pushes to
every PR** on the repos your GitHub App is installed on, debounced and under
the instance's daily cap, with no manual step for an author the repository
trusts. Any other author's PR waits for one Generate click from a
collaborator with push access, and its later pushes run as usual. Setup
details (App registration, env table, verification, hardening before you
expose it):
[`docs/self-host/compose.md`](./docs/self-host/compose.md). Upgrades,
migrations, and backup/restore:
[`docs/self-host/operations.md`](./docs/self-host/operations.md).

## Quickstart (local dev loop)

Requires Node 24 or 26+ (`.nvmrc` pins the version CI uses), [`pnpm`](https://pnpm.io),
and Docker for Postgres. The api, worker and web processes run on your machine; only Postgres
runs in a container.

```bash
git clone https://github.com/Idan91/code-review.git
cd code-review
pnpm install

cp .env.example .env
# edit .env: the GitHub App and OAuth values, SESSION_KEY_V1, ANTHROPIC_API_KEY,
# and a host DSN for the compose Postgres:
#   DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review

pnpm app:host
```

`pnpm app:host` starts the compose Postgres, then runs the api, the worker and the web app on
the host with `.env` loaded. Open http://localhost:3000, sign in with GitHub, paste a pull
request URL on Home and click **Generate brief**. The worker generates the brief and stores it
in Postgres; reopening the PR reads the stored brief at no extra cost. A pasted pull request gets
no webhook, so after a new push its page shows a **Newer commits** chip with a **Generate new
brief** button; a repository with the GitHub App installed briefs a trusted author's pushes, or
an approved pull request's, as above.

`pnpm dev` runs only the api and the web app, with no worker, so nothing generates under it.

Prefer the terminal? `tools/categorizer` runs the same engine (`packages/brief-core`) from dev
CLIs that write artifacts to `tools/categorizer/out/`; see [`tools/categorizer/README.md`](./tools/categorizer/README.md).

## Generation backends (pick your model, or your subscription)

Briefs generate through one of six interchangeable backends, all held to
the same hard floor (schema-valid output or a loud failure): **Anthropic
API** (the zero-config default; `claude-sonnet-5` is the documented cost
knob), **OpenAI API**, **OpenRouter** (any slug with structured outputs),
or, for the local dev loop, the **Claude Code**, **Codex** and **Cursor
CLIs**, which generate on the subscription you already pay for. One optional
`mergebrief.config.yaml` selects the backend for the worker and the
categorizer CLIs alike (the `mergebrief` HTTP client below never
constructs a generator).

**The CLI backends are local-only in v1, deliberately.** A container never
sees your installed CLI or your login, and API-key mode erases the cost
advantage that makes CLI backends attractive, so the deployed worker stays
on API backends. Running the vendor's own CLI against your own subscription
on your own machine is documented by both vendors as supported; the caveats
worth knowing before you rely on it are in the generators doc.
Full config surface, per-provider notes, and the boundary reasoning:
[`docs/self-host/generators.md`](./docs/self-host/generators.md).

**Repos can shape their own briefs** by committing a `.mergebrief/`
directory: custom risk attributes and display tuning (`policy.yaml`),
text guidance to generation (`instructions.md`), and workflow settings
(`settings.yaml`), all read from the default branch with full origin tracking on
every brief: [`docs/self-host/repo-config.md`](./docs/self-host/repo-config.md).

## The CLI (humans + agents)

The same review loop, scriptable: **`mergebrief`** ([apps/cli](apps/cli/README.md))
drives `pr` → `groups` → `diff --group` → `submit` over your deployment's API with an
opaque token minted in the web app. `--json` output is a stability-promised contract
(passthrough server shapes, additive-only, an 8-code exit table), which makes it safe to
hand to an AI agent unattended. Install the packaged skill with
`npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>`
([skills/mergebrief](skills/mergebrief/SKILL.md)).
Deploy-side setup: [docs/self-host/cli.md](docs/self-host/cli.md).

## What you get

| | |
|---|---|
| **Story view** | The Brief grouped by Change-group: what changed and why, step by step |
| **Concern split** | How the PR's attention divides by artifact (implementation, test, doc, spec, config, generated): how much is real change and how much is scaffolding |
| **Changes only** | On a later push, only what changed between two revisions of the PR |
| **Risk Surface** | Factual attributes per chunk (`no-tests`, `touches-auth`, `comment-contradicts-code`, …), each checkable in seconds, never a severity score |
| **Receipt** | What the tool verified and what it didn't, plus the disposition of every flag (addressed / dismissed with reason). Never an approval |

## Project layout

```
apps/web/                     the web app (Inbox, Brief renderer, review session); holds no credentials
apps/api/                     the HTTP API: webhooks, GitHub sign-in, reviewer reads and writes
apps/worker/                  the generation worker: drains the Postgres job queue, writes briefs
apps/cli/                     `mergebrief`, the HTTP client for humans and agents
packages/brief-core/          the engine: Brief schema, vocabulary, prompt, delta and anchoring
packages/generators/          the model backends behind one generator port
packages/contract/            the HTTP contract the API, web app and CLI share
packages/persistence/         the Postgres data layer and job queue
packages/github/              the GitHub App client: auth, webhooks, PR and diff reads
packages/repo-config/         the `.mergebrief/` repo config: schemas and budgets
packages/i18n/                the user-facing copy catalog
packages/logging/             the structured-logging boundary
packages/types/               shared type helpers and closed vocabularies
tools/categorizer/            dev CLIs over the engine, plus the eval harness
tools/release/                the release tool behind the release workflow
tools/baselines/              the lint-baseline gate
tools/oxlint-plugin-house/    the repo's own lint rules
tools/ingest-briefs/          one-shot import of CLI brief artifacts into the database
skills/mergebrief/            the agent skill for the CLI
docs/                         vision, vocabulary, self-host and contributor docs
```

## Your data (what's stored, and how forgetting works)

The self-host backend keeps everything in **your own Postgres, on your own
infrastructure, with your own API key**. Beyond the GitHub API, your model provider and
the outbound reads described above, nothing leaves your network, and there is no
telemetry. What it stores is deliberately minimal:

- **Stored:** generated Briefs and revision summaries (descriptions *of* your code), review
  positions (which commit each reviewer last reviewed), and encrypted login sessions.
- **Not stored:** your code. Diffs are fetched live from GitHub per session and thrown away.
- **Also not stored:** comment text (comments live on GitHub), emails, or IP addresses.

**Forgetting is built in, and it's your policy, not ours.** GitHub stays the source of truth,
so stored artifacts are safe to expire: set `PR_RETENTION_DAYS` and a daily sweep deletes every
pull request closed longer ago than that, with its artifacts; leave it unset and nothing expires.
Uninstalling the GitHub App erases the installation's data completely. Erasure is enforced by
the database itself (every artifact cascades from its PR, so no table is forgotten), and each
deletion appends one anonymous, numbers-only entry to an audit ledger, so you can prove *that*
something was erased without retaining *what*.

## Status

This is an early-stage, actively developed self-hosted project, not a finished product. The
domain model is documented in [`CONTEXT.md`](./CONTEXT.md), and how the pieces fit together
in [`docs/architecture.md`](docs/architecture.md).

## Contributing

The taxonomy is the contribution surface: an ESLint-rules-style commons of review knowledge,
kept in plain markdown. Proposing a Category or a Risk-Surface attribute starts as a docs change. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

You may use, self-host, modify and fork MergeBrief. You may not offer it, or a substitute
built on it, as a competing commercial product or service. Each release becomes Apache-2.0 two
years after it ships. The full text is in [`LICENSE`](./LICENSE) (`FSL-1.1-ALv2`).
