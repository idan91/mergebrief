# MergeBrief

A source-available, self-hostable **comprehension layer for code review.** It turns a pull request
from a flat file-list into a **brief**: changes re-unitized into categorized **Change-groups**,
each with a plain-language summary and **Risk Surface** attributes: facts worth a closer look,
never a verdict.

MergeBrief doesn't try to spot bugs. It organizes the review itself: the author hands over a change
with its story already told, the reviewer follows that story instead of reconstructing it from
the diff, attention lands where it's needed, and it takes fewer review iterations to reach a
confident merge.

## See it work

**Delta view.** Come back to a PR after new pushes and the brief shows what changed since
your last review, with the comments each change addresses.

<!-- recording: delta view -->

**Chunk stepping.** Move through a Change-group one chunk at a time from the keyboard,
marking each one viewed as you go.

<!-- recording: chunk stepping -->

**Risks.** Each chunk lists the Risk Surface attributes that fired on it. You mark each
flag addressed or dismissed with a reason, and the Receipt records it.

<!-- recording: risks -->

**Threads.** The PR's GitHub conversations sit next to the chunks they belong to, and you
reply or resolve them in place.

<!-- recording: threads -->

## After your bot reviewer

Keep the AI review bot you already run. It reads the diff first and posts what it finds; its
threads show up in the brief's Conversation section, grouped per bot. MergeBrief is for what is
left after that: the part of review a person still does, and answers for.

- **What the checks would miss.** Each chunk carries **Risk Surface** attributes, facts such
  as `touches-auth` or `removes-validation` that say where to look closer, and the brief gives
  a **Reading order** across its Change-groups, foundations first.
- **Does it do what it says.** The **Intent check** compares the PR title, its description
  and the linked GitHub issue, Notion ticket or Jira issue, when there is one, with what the
  diff does: what was stated but is missing, what was done but never stated. **Ticket
  alignment** says whether the diff serves the ticket's goal.
- **Re-approving after new commits.** Your **Checkpoint** is the commit you last submitted a
  review on. The **Delta Brief** shows what changed since then, and each risk you addressed or
  dismissed comes back with its **Carry-over status**: settled if its code is untouched,
  reopened if it changed.
- **A person answers for it.** The **Receipt** records what you read and how you handled each
  flag, and the review you post to GitHub ends with one **Signature line** of those counts.
  No approval badge, no score.

## Why this, and not another AI review bot?

Most AI review tools treat a PR generically: summarize it, maybe flag a few "potential issues."
MergeBrief is built around a different idea: **a stable, cross-PR taxonomy is more valuable than a
one-off summary.** Every Change-group gets a Category from a fixed vocabulary
(`pure-move`, `schema-change`, `lib-bump`, `logic-refactor`, …), so the same kind of change is
recognizable across every PR you ever review.

- **Self-hostable and source-available.** One core, `docker compose up`, your infrastructure,
  your data. The source is public under `FSL-1.1-ALv2` (see [License](#license)).
- **BYOK, no per-seat cost, no telemetry.** Your model key, your spend. Self-hosted instances
  send nothing back to us, by design. Beyond the GitHub API and your model provider, the
  outbound requests are the update check, the links a PR cites and any ticket tracker you
  configure. The update check is an hourly fetch of a public release file from GitHub that
  carries nothing about your instance; `updateCheck.enabled: false` in the instance config turns it off. For
  context, the worker reads up to five public links from a PR's description, and a tracker
  such as Notion or Jira when you configure one.
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
mkdir mergebrief && cd mergebrief
curl -fsSLo docker-compose.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.yml
curl -fsSLo .env.example https://github.com/Idan91/mergebrief/releases/download/v0.1.0/env.example
curl -fsSLo mergebrief.config.example.yaml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/mergebrief.config.example.yaml
cp .env.example .env    # GitHub App creds + your Anthropic key
cp mergebrief.config.example.yaml mergebrief.config.yaml    # your GitHub user id under operators
docker compose up -d --wait
```

An instance starts closed: nobody signs in until `mergebrief.config.yaml` lists them under
`operators`, and compose refuses to start `api` and `worker` without that file
([setup](./docs/self-host/compose.md)). That's the whole product running: Postgres, the web app on
http://localhost:3000, and a background worker that briefs **the pushes to
every PR** on the repos your GitHub App is installed on, debounced and under
the instance's daily cap, with no manual step for an author the repository
trusts. Any other author's PR waits for one Generate click from a
collaborator with push access, and its later pushes run as usual. Start with
[`docs/self-host/README.md`](./docs/self-host/README.md): prerequisites, sizing
and a reading order for every self-host page. Setup details (App registration,
first-boot settings, verification, hardening before you expose it):
[`docs/self-host/compose.md`](./docs/self-host/compose.md). Every environment
variable, instance config key and CLI setting, with its default:
[`docs/self-host/configuration.md`](./docs/self-host/configuration.md). Upgrades,
migrations, and backup/restore:
[`docs/self-host/operations.md`](./docs/self-host/operations.md).

## Quickstart (local dev loop)

Requires Node 24 or 26+ (`.nvmrc` pins the version CI uses), [`pnpm`](https://pnpm.io),
and Docker for Postgres. The api, worker and web processes run on your machine; only Postgres
runs in a container.

```bash
git clone https://github.com/Idan91/mergebrief.git
cd mergebrief
pnpm install

cp .env.example .env
# edit .env: the GitHub App and OAuth values, SESSION_KEY_V1, ANTHROPIC_API_KEY,
# and a host DSN for the compose Postgres:
#   DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review

pnpm app:host
```

`pnpm app:host` starts the compose Postgres, then runs the api, the worker and the web app on
the host with `.env` loaded. An instance starts closed, so first copy
`mergebrief.config.example.yaml` to `mergebrief.config.yaml`, put your GitHub user id under
`operators` (`gh api users/<login> --jq .id`) and set `MERGEBRIEF_CONFIG=mergebrief.config.yaml`
in `.env` ([who may start a brief](docs/self-host/generators.md#who-may-start-a-brief)). Open
http://localhost:3000, sign in with GitHub, paste a pull request URL on Home and click
**Generate brief**. The worker generates the brief and stores it
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
API** (the zero-config default; `claude-sonnet-5-5` is the cheaper
option), **OpenAI API**, **OpenRouter** (any slug with structured outputs),
or, for the local dev loop, the **Claude Code**, **Codex** and **Cursor
CLIs**, which generate on the subscription you already pay for. One
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

Install it with `npm i -g mergebrief`, or run `npx mergebrief` anywhere but inside a
checkout of untrusted code. If the shell answers `command not found`,
[Install](docs/self-host/cli.md#install) has the fix.

The same review loop, scriptable: **`mergebrief`** ([apps/cli](apps/cli/README.md))
drives `pr` → `groups` → `diff --group` → `submit` over your deployment's API with an
opaque token created in the web app. `--json` output is a stability-promised contract
(passthrough server shapes, additive-only, an 8-code exit table), which makes it safe to
hand to an AI agent unattended. Install the packaged skill with
`npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>`
([skills/mergebrief](skills/mergebrief/SKILL.md)).
Deploy-side setup: [docs/self-host/cli.md](docs/self-host/cli.md).

## What you get

| | |
|---|---|
| **Story view** | The brief grouped by Change-group: what changed and why, step by step |
| **Concern split** | How the PR's attention divides by artifact (implementation, test, doc, spec, config, generated): how much is real change and how much is scaffolding |
| **Changes only** | On a later push, only what changed between two revisions of the PR |
| **Risk Surface** | Factual attributes per chunk (`no-tests`, `touches-auth`, `comment-contradicts-code`, …), each checkable in seconds, never a severity score |
| **Receipt** | What the tool verified and what it didn't, plus the disposition of every flag (addressed / dismissed with reason). Never an approval |

## Project layout

```
apps/web/                     the web app (Inbox, brief renderer, review session); holds no credentials
apps/api/                     the HTTP API: webhooks, GitHub sign-in, reviewer reads and writes
apps/worker/                  the generation worker: drains the Postgres job queue, writes briefs
apps/cli/                     `mergebrief`, the HTTP client for humans and agents
packages/brief-core/          the engine: brief schema, vocabulary, prompt, delta and anchoring
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
telemetry. Credentials the worker recognizes in a diff or in PR text are redacted
before the prompt reaches your provider (see
[What the model receives](docs/self-host/generators.md#what-the-model-receives)). What it stores is deliberately minimal:

- **Stored:** generated briefs and revision summaries (descriptions *of* your code), review
  positions (which commit each reviewer last reviewed), encrypted login sessions, and what
  reviewers write in MergeBrief: comments they draft, in plain text, which stay stored after
  they post to GitHub, and their reasons and notes on risks
  ([details](docs/self-host/operations.md#retention-what-grows-and-what-does-not-prune-itself)).
- **Not stored:** your code. Diffs are fetched live from GitHub per session and thrown away.
- **Also not stored:** the pull request conversation MergeBrief reads from GitHub, emails, or
  IP addresses.

**Forgetting is built in, and it's your policy, not ours.** GitHub stays the source of truth,
so stored artifacts are safe to expire: set `retention.pullRequestDays` and a daily sweep deletes every
pull request closed longer ago than that, with its artifacts; leave it unset and nothing expires.
Uninstalling the GitHub App erases the installation's data completely. Erasure is enforced by
the database itself (every artifact cascades from its PR, so no table is forgotten), and each
deletion appends one anonymous, numbers-only entry to an audit ledger, so you can prove *that*
something was erased without retaining *what*.

## Status

MergeBrief is pre-1.0 and under active development. Expect rough edges and changes between
releases. A release whose upgrade needs more than the documented steps is flagged breaking
in its notes; [`docs/self-host/operations.md`](./docs/self-host/operations.md) covers
upgrades and rollback. The domain model is in [`CONTEXT.md`](./CONTEXT.md), and how the
pieces fit together is in [`docs/architecture.md`](./docs/architecture.md).

## Contributing

Development happens in a private repository, and each release is exported to this
public repository as a snapshot.

Contributions are still welcome here as ordinary pull requests, and review happens in
public on the PR. An accepted change is applied upstream, credited to you with a
`Co-authored-by:` trailer, and ships in the next release. The PR is then closed with a
link to that release.

The taxonomy is the main contribution surface: Categories and Risk Surface attributes,
kept in plain markdown, so proposing one starts as a docs change. The evidence bars, the
review process and the license terms for contributions are in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Security

Report vulnerabilities privately, never in a public issue.
[`SECURITY.md`](./SECURITY.md) has the reporting channels and what is supported.

## License

You may use, self-host, modify and fork MergeBrief. You may not offer it, or a substitute
built on it, as a competing commercial product or service. Each release becomes Apache-2.0 two
years after it ships. The full text is in [`LICENSE`](./LICENSE) (`FSL-1.1-ALv2`).
