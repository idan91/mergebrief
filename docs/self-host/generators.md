# Generation backends (`mergebrief.config.yaml`)

MergeBrief generates Briefs through one of six interchangeable backends.
Every backend meets the same hard contract: **the
output is valid against the Brief schema or the generation fails loudly**;
native provider enforcement is a bonus layer, never the mechanism. Salvage
and one feedback retry run identically everywhere, and when they fire they
are visible: in logs, and on the artifact itself (the header's amber
`generationWarnings` block).

## Zero-config default

With no `generator` block, or no config file at all: **Anthropic API +
`ANTHROPIC_API_KEY` + Claude Opus 5.5**.

The cheaper option is `model: claude-sonnet-5-5` on the `anthropic` provider.
It costs less per token than Opus 5.5
([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). The
committed eval baselines ran on the default, so read
[what degrades on a weaker model](#length-discipline-and-anchoring-degrade-on-weaker-models)
before you switch.

## The config file

One YAML file selects the backend for the **worker and the
categorizer CLIs** alike; the api reads its `drafts`, `spend`,
`operators` and `allowed` blocks from the same file. The `generator` block
is optional, the file is not. Nobody can sign in until `operators` or
`allowed` names them ([Who may start a brief](#who-may-start-a-brief)). A ready-to-copy annotated template ships
at the repo root: [`mergebrief.config.example.yaml`](../../mergebrief.config.example.yaml)
(copy to `mergebrief.config.yaml`, which is gitignored, the same convention as
`.env.example`).

```yaml
# mergebrief.config.yaml: next to your compose file
generator:
  provider: anthropic          # anthropic | claude-code | codex | cursor | openai | openrouter
  model: claude-sonnet-5-5     # optional here; REQUIRED for openai/openrouter
  # effort: medium             # low | medium | high: reasoning effort for every
  #                            # generation (default medium); see the effort-knob
  #                            # column below for what each provider does with it
  # apiKeyEnv: MY_KEY_VAR      # API providers: NAME of the env var holding the key
  # baseUrl: https://gateway.example   # anthropic: gateway host root, NO /v1 (a path ending in /v1 refuses boot)
  # baseUrl: https://your-server.example/v1   # openai: the /v1 root of a gateway or
  #                            # compatible server (preflight downgrades to warnings)
  # command: /usr/local/bin/claude   # CLI providers: binary path/name
  # timeouts:                  # CLI providers: harness timer tunables (ms)
  #   hardMs: 900000
  #   inactivityMs: 180000
  #   killGraceMs: 5000
  # providerRouting:           # openrouter only: routing options passthrough:
  #   order: ["anthropic"]     # any key from openrouter.ai/docs/features/provider-routing;
  #                            # `order` is one example, `sort: throughput` another
  # referer: https://you.example   # openrouter attribution headers
  # title: MergeBrief

# drafts: the OTHER root block: draft-PR generation policy
# (generate: on|off + optional draft regeneration debounceSeconds). Spend
# knobs, enforced by the api process and validated by the worker too; see
# self-host/repo-config.md's instance-block section for semantics.
# drafts:
#   generate: on
#   debounceSeconds: 900

# spend: the THIRD root block: the daily generation cap, at most N
# generations per UTC calendar day across every repo this instance serves.
# Omitting the block means 300; `unlimited` lifts the cap. See "Daily
# generation cap" below.
# spend:
#   maxGenerationsPerDay: 50

# contextSources: the FOURTH root block: ticket trackers that need a
# deployment credential, by env-var NAME. URLs and GitHub issues are built
# in and need no entry. See self-host/trackers.md.
# contextSources:
#   - type: notion
#     tokenEnv: NOTION_TOKEN
#   - type: jira
#     site: acme.atlassian.net
#     emailEnv: JIRA_EMAIL
#     tokenEnv: JIRA_API_TOKEN

# trackers: the FIFTH root block: the boards every repo on this instance
# reads tickets from, one entry per board. A repo whose own
# .mergebrief/settings.yaml names trackers replaces this list. Same entry
# shape as the repo file, plus the github entry's instance-only
# siblingRepos; see self-host/repo-config.md and self-host/trackers.md.
# trackers:
#   - kind: notion
#     keyPrefix: ACME
#     databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
#   - kind: jira
#     projectKeys: [WEB, OPS]
#   - kind: github

# operators: the SIXTH root block: the GitHub user ids of the people who
# run this instance. See "Operators" below.
# operators:
#   - 583231

# allowed: the SEVENTH root block: who besides Operators may use this instance.
# With neither block nobody can. See "Who may start a brief" below.
# allowed:
#   users:
#     - 9919
#   accounts:
#     - 12345678

# x-*: root keys starting with "x-" are ignored (compose-style extension
# slot); ANY other unknown key, root or inside generator:/drafts:/spend:/
# contextSources:/trackers:, refuses boot.
x-notes: anything here is yours
```

How processes find it:

| Surface | Mechanism |
|---|---|
| worker + api | `MERGEBRIEF_CONFIG=mergebrief.config.yaml`; relative resolves against the workspace root (see path-form note); absolute also fine (env var unset → zero-config default; set-but-empty or unreadable → refuses boot) |
| categorizer CLIs | explicit `--config <path>` only; they never read `MERGEBRIEF_CONFIG` (`pnpm -C tools/categorizer categorize --config ../../mergebrief.config.yaml <pr-url>` also doubles as a fast config validator; the path is relative to `tools/categorizer`) |

**Path form**: a relative `MERGEBRIEF_CONFIG` is resolved
against the **workspace root** (the nearest ancestor of the process
working directory containing `pnpm-workspace.yaml`), never against bare
cwd (the worker runs from `apps/worker`, the api from `apps/api`;
cwd-relative would let one env value silently name different files). So
`MERGEBRIEF_CONFIG=mergebrief.config.yaml` in `.env` means the repo-root
file everywhere, local and dockerized alike: the docker image is a full
workspace checkout, so the anchor holds there too. Absolute paths pass
through unchanged. No workspace root above cwd refuses boot and points at
absolute paths. The image carries no config file, so whenever
`MERGEBRIEF_CONFIG` names one, mount it into `api` and `worker` from
`docker-compose.override.yml`. Leave `docker-compose.yml` alone: an
upgrade replaces it ([compose.md](./compose.md#what-the-host-holds)).

```yaml
# docker-compose.override.yml
services:
  api:
    volumes:
      - ./mergebrief.config.yaml:/app/mergebrief.config.yaml:ro
  worker:
    volumes:
      - ./mergebrief.config.yaml:/app/mergebrief.config.yaml:ro
```

The containers run as UID 1000, so that user must be able to read the file.
Under a restrictive `umask`, or when root created it, run
`chmod 644 mergebrief.config.yaml`. Keep credentials out of the file: it holds
env var names, not keys. Edits to the file then apply when `api` and `worker`
restart.

> **Packaged distributions (future)**: workspace-root anchoring assumes the
> process runs inside a repo checkout. If MergeBrief ever ships as an
> installed distribution (global npm package, prebuilt binary) running
> outside a checkout, no anchor exists: relative values refuse boot with
> an explicit message and such deployments must use absolute paths.
> Revisit the resolution rule when that distribution mode becomes real.

Every boot-knowable problem **refuses boot with per-field issues** (values
never echoed): unknown provider, unknown keys, a key env var that is unset,
a CLI that is missing or not logged in. API keys are BYOK-by-env-NAME:
the key value never lives in this file, the DB, or repo config.

## Daily generation cap

The one spend guardrail v1 ships: **at most N generations per UTC calendar
day, counted across every repo this instance serves**. It is instance
config: the operator pays the bill, so no `.mergebrief/` repo file can
set, raise, or lower it.

```yaml
spend:
  maxGenerationsPerDay: 50
```

The key is optional and takes a positive whole number or `unlimited`.
Omitting it, or the whole block, caps the instance at **300 a day** (the
default); `maxGenerationsPerDay: unlimited` is the only way to run uncapped.
The cap ships on because the webhook route carries no rate limit of its own,
so it is what stands between a burst of webhooks and your provider quota.
There is no per-repo override: the cap is a ceiling, not fair share, so a
busy repo can use the day's budget for the others. If that bites, raise the
number.

At the cap the worker **skips** the generation before any provider call:

- the PR's brief view shows a distinct "daily generation cap reached" state
  with the reset time in the viewer's local zone, never a fake failure;
- an Entry comment that **already exists** on the PR is updated to say so;
  no comment is created for a capped PR;
- the worker logs `evt: spend.cap.trip` at `warn` with `repo`, `prId`,
  `headSha`, `cap`, `dayUtc` (see
  [observability.md](./observability.md));
- nothing is queued for later.

The counter is one record per started run: **runs** started on the current
UTC day, whichever repo made them, not provider calls, not distinct pull
requests, and not distinct pushes. One run can make several model calls: the
brief, a revision narrative against the previous brief, and one delta per
distinct reviewer checkpoint. On a public or internal repository only the
owner, organization members, collaborators and others with write access set a
checkpoint, so outside accounts reviewing it add no calls to a run. On a private
(not internal) repository every reviewer sets one. A push that is re-queued (another push lands, a review is submitted)
spends again and counts again, and so does every automatic retry of a failed
run, so a single busy PR can consume a day's budget on its own. Runs that
were superseded or failed DO count: they spent. A run that finishes without any
model call, such as a push that changed nothing so its brief carries whole,
costs nothing: its record stays, at zero. A run counts on the day it
started, and purging its pull request does not take it back.
Queued-but-not-yet-drained jobs and capped skips do not: a burst of
webhooks must not trip the cap before a single token is spent. A job that
finds a brief already stored for its base and head pair (a review submitted
after the brief, a ready flip that still needs its Entry comment, a retry
whose brief landed before it failed) produces no brief generation and counts
only if it pays: one that still owes a checkpoint delta or a narrative counts
once, at its first provider call, and is refused there if the cap is reached.
While the instance sits at the cap such a job is refused before any work.

A pull request too large for one model call is briefed in parts: one call
plans the groups, then one call per part. That run counts one run when it
starts and one more for each part, claimed together once the plan names the
parts. If the day has fewer runs left than the parts need, the run stops
there, before any part is briefed, and the brief view says how many runs it
needs and how many are left. A retry pays only for the parts it has not
stored yet. Settings, Instance shows how many of the day's runs were briefed
in parts and how many units they took; a pull request pushed or retried the
same day counts once per run.

A pull request whose description holds images or videos makes one more model
call after the brief, to pick its Summary Media. The cap does not count that
call, but the provider bills it. If it fails, the brief ships without Summary
Media and carries a `summary-media-failed` warning.

A brief written in one model call is followed by one more, which writes its
Product diff: how the product behaves before the pull request and after it.
That call reads the diff a second time, so expect it to add roughly the
brief call's input tokens and a small answer. The cap does not count it, but
the provider bills it. If it fails, or none of the changes it wrote can be
kept, the brief ships without a Product diff and carries a
`product-diff-failed` warning. A pull request briefed in parts makes no such
call, and its brief says the Product diff is not available.

The count is exact across slots and worker processes: the start and the
`running` mark share one transaction under one instance-wide advisory lock,
so N slots cannot start past the cap together. It is still a guardrail, not
an invoice. The counter starts empty on the day you upgrade to the release
that introduced it, so runs from before the upgrade that day are not counted.
Treat it as a ceiling on what you are willing to spend per day,
not as a bill. Cost reporting is a separate, later concern.

An Operator (see "Operators" below) reads the day's count against the cap
on the Instance tab of Settings, or with `mergebrief spend`.

The window resets at 00:00 UTC. A push skipped today is not retried
automatically when the cap resets; the PR gets its brief on its next
settled push (or any event that re-queues it).

## Operators

The `operators` block lists the GitHub users who run this instance, by
numeric user id. An Operator can read instance-wide state other users
cannot, such as the day's started runs against the cap. Omitting the block,
or writing an empty list (`operators: []`), means nobody is an Operator. A
bare `operators:` with nothing under it reads as no list at all, and the api
and worker refuse to boot.

```yaml
operators:
  - 583231
```

List ids, not logins. GitHub frees a login when its owner renames, and
whoever registers it next would inherit the role; an id never changes. To
find yours, run `gh api users/<login> --jq .id`, or read the number in your
GitHub avatar URL (`avatars.githubusercontent.com/u/<id>`).

The api reads this block, together with `drafts`, `spend` and `allowed`, from the same
`MERGEBRIEF_CONFIG` file as the worker. A change takes effect when the api
restarts.

## Who may start a brief

An instance starts closed: nobody can sign in or start a brief until this file
names them. A paste, a Regenerate and an API token all answer to the same
rule. On a solo instance, your id under `operators` is all you need.

```yaml
operators:
  - 583231
allowed:
  users:
    - 9919
  accounts:
    - 12345678
```

- `operators` lets those people in. Your personal account's id is your user id,
  so an installation of the App on your own account counts too, and that lets in
  every collaborator on the repositories it holds.
- `accounts` lists the organizations and personal accounts whose people may use
  the instance, once the App is installed there. GitHub decides who that is: it
  lists the installations a person has explicit access to, through ownership, as
  a collaborator or through organization membership. Reading a public repository
  does not count, and neither does a suspended installation. Their repositories'
  webhook deliveries start briefs; every other account's start nothing.
- `users` adds people on top, such as an external reviewer. They need no
  installation.
- A bare `allowed:`, or one that names neither list, refuses boot.

List ids, not logins, for the reason [above](#operators). Find an organization's
with `gh api orgs/<org> --jq .id`. A refused sign-in logs the account's id at
`info`. An installation made at enterprise level never matches, so list each
organization. A change takes effect when the api restarts, and someone you remove
loses access at their next GitHub token rotation
([security-model.md](./security-model.md#who-can-sign-in)).

## Worker slots

Three dials, all env, all optional:

- `WORKER_CONCURRENCY`: generate jobs one worker process drains at once.
  Default 1.
- `WORKER_LARGE_CONCURRENCY`: slots of the large pool, which drains the
  multi-call runs (a pull request past one call's input, see below).
  Default 1.
- `WORKER_COUNT`: worker containers compose starts. Default 1.

Concurrent generations = `WORKER_COUNT` x (`WORKER_CONCURRENCY` +
`WORKER_LARGE_CONCURRENCY`). Prefer one worker and more slots: a slot is
cheaper than a process. A second worker buys restart isolation, not
throughput slots could not give you.

### The large pool

A pull request GitHub reports with more than 120 changed files, or whose
changed lines add up past one call's input (about 11,900 lines at the 67
bytes a changed line measures), is briefed in several model calls: a
grouping call, then detail calls, up to `generator.detailConcurrency` of
them in flight at once (default 8). Such a run would hold a normal slot for
many minutes with several streams open, so the worker routes it to its own
pool before anything is claimed or spent: a normal-pool job that reads those
counts moves itself to the large pool and ends; the large pool's job runs
whatever it was given, so a wrong guess runs where it landed. The large
pool's one default slot serializes the large runs behind each other while
the normal slots keep answering ordinary pushes. A second large slot costs
up to `detailConcurrency` more streams at the provider; lower
`detailConcurrency` before raising the slot count on a provider rate limit.

A large run's spend is counted in units, one per model call, against the
same daily cap as every other run, so `WORKER_LARGE_CONCURRENCY` never lets
the instance past it.

A slot whose run reads a changed lockfile also forks one short-lived child
process for it, its heap capped at 512 MB, so plan that much memory per
slot on top of the provider's cost.

What a slot costs depends on the provider class:

- **API providers** (`anthropic`, `openai`, `openrouter`) hold one
  in-process stream per slot. Memory grows by one response buffer per slot;
  the bounds that matter are the provider's rate limit and the daily cap.
- **CLI providers** (`claude-code`, `codex`, `cursor`; local dev loop only,
  the compose worker refuses them at boot) hold one child process per slot
  for the length of a generation. Size the host so that
  `slots x child RSS + worker baseline` fits. Peak child RSS per provider,
  measured on the host from a real generation (`/usr/bin/time -l` on macOS,
  `/usr/bin/time -v` on Linux, around `pnpm -C tools/categorizer categorize
  --config ../../mergebrief.config.yaml <pr-url>` with that provider configured; a
  one-word prompt measures the idle floor, not the peak):

  | provider | peak child RSS |
  |---|---|
  | `claude-code` | not yet measured |
  | `codex` | not yet measured |
  | `cursor` | not yet measured |

The daily cap is exact whatever the two dials say: every start serializes
under one instance-wide lock, so N slots cannot start past it together.

## The six providers

| provider | class | auth | effort knob | notes |
|---|---|---|---|---|
| `anthropic` | API | `apiKeyEnv` (default `ANTHROPIC_API_KEY`) | yes | the default; `claude-sonnet-5-5` is the cheaper option; `baseUrl` routes through a gateway and is its host root without `/v1` (the SDK appends `/v1/messages`); a `baseUrl` ending in `/v1` refuses boot |
| `openai` | API | `apiKeyEnv` (default `OPENAI_API_KEY`) | discovered at run time (a model without `reasoning_effort` records `effort: null`) | `model` required; `baseUrl` routes through a gateway or a self-hosted compatible server and ends in its `/v1` root (the SDK appends `/chat/completions`; preflight downgrades to warnings) |
| `openrouter` | API | `apiKeyEnv` (default `OPENROUTER_API_KEY`) | gated by the model's listed `reasoning` support | full slug required; boot requires the model to list `structured_outputs`; `require_parameters` is forced on every request |
| `claude-code` | **local CLI** | your interactive `claude /login` (OAuth/keychain) | none (`effort: null`, an honest gap) | lockdown: `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, print mode, no `--bare`; served model verified from `modelUsage` post-run |
| `codex` | **local CLI** | your interactive `codex login` (ChatGPT; a stored API-key login refuses to start) | `model_reasoning_effort` | lockdown: `--skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules`, shell, web search and other built-in tools off, a read-only offline `default_permissions` profile; **origin blind spot**: codex's JSONL carries no model id, so a silent server-side reroute is unobservable, so the stamp records what you configured |
| `cursor` | **local CLI** | your interactive `cursor-agent login` (or `CURSOR_API_KEY`, which bills the same subscription pool) | rides the model-id VARIANT (`gpt-5.2-high` vs `-low`); the `effort:` knob has no wire effect (the stamp parses the id's suffix; a disagreeing `effort:` logs a note) | lockdown: `--mode plan` from an empty temp dir (bare print mode APPLIES file writes); the stream is pipe-silent until exit, so the wall-clock timeout is the only watchdog; **origin blind spot**: the envelope has no model field and `system/init` echoes the request, so the stamp records what you configured |

An API provider's host comes only from this file: `baseUrl` when set, else
the provider's own (`api.anthropic.com`, `api.openai.com/v1`,
`openrouter.ai`). The worker ignores `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`,
`OPENAI_PROJECT_ID` and `OPENAI_ADMIN_KEY`, so no environment variable can
redirect generations to another host. `ANTHROPIC_CUSTOM_HEADERS` and
`OPENAI_CUSTOM_HEADERS` are still honoured: they add or override request
headers, a key or organization header included, on that same host. Whoever
sets the worker's environment owns them.

`effort:` note: the committed eval baselines (`tools/categorizer/eval`)
assume the default (anthropic at `medium`); running an instance at a
non-default effort is a deliberate divergence from them, same as running a
non-default provider or model.

### Model names by provider

Model names are provider-owned lists that change often, so MergeBrief keeps no
list of its own: a checked-in one would go stale and reject valid new models.
Copy the id from the provider's own page, exactly as written there. Each
provider below has that page, an example, and what a wrong id does.

#### `anthropic`

The ids are the "Claude API ID" row of the
[models overview](https://platform.claude.com/docs/en/models/overview). You can
also ask the API with your key: `GET /v1/models`.

The id is not the display name. "Claude Sonnet 5.5" is `claude-sonnet-5-5`:
lowercase, with a hyphen for each space and for the dot. Copy the id from the
table instead of converting the name by hand.

```yaml
generator:
  provider: anthropic
  model: claude-sonnet-5-5   # omit for the default, claude-opus-5-5
```

Nothing checks the id at boot. A wrong one fails the **first generation**
with a config-classified error.

#### `openai`

The ids are on the [OpenAI models page](https://developers.openai.com/api/docs/models).
With `baseUrl` set, they are whatever your server's `/models` serves.

```yaml
generator:
  provider: openai
  model: gpt-6.1-sol   # required
```

A wrong id **refuses boot**: the `/models/{id}` preflight answers 404. With
`baseUrl` set, that refusal is a warning.

#### `openrouter`

Copy the full slug, vendor prefix included, from
[openrouter.ai/models](https://openrouter.ai/models). OpenRouter writes a
version with a dot where the vendor's own id may use a hyphen: Claude Sonnet
5.5 is `anthropic/claude-sonnet-5.5` here and `claude-sonnet-5-5` on the
`anthropic` provider.

```yaml
generator:
  provider: openrouter
  model: anthropic/claude-sonnet-5.5   # required
```

A wrong slug **refuses boot**: the `/models` preflight needs the slug to exist
and to list `structured_outputs`.

#### `claude-code`

Whatever your installed `claude` CLI accepts: an alias such as `opus`,
`sonnet` or `haiku`, or a full id from the Anthropic page above
([model configuration](https://code.claude.com/docs/en/model-config)).

```yaml
generator:
  provider: claude-code
  model: claude-sonnet-5-5   # omit for the default, claude-opus-5-5
```

A wrong id fails the **first generation** (`model_not_found`, a config
error). After a run, the served model is checked against the CLI's own
report, and a mismatch logs a warning.

#### `codex`

The models your installed `codex` CLI offers
([Codex models](https://learn.chatgpt.com/docs/models)). Omit `model:` to run
the CLI's configured default; the provenance stamp then reads `codex-default`.

```yaml
generator:
  provider: codex
  model: gpt-6.1-sol   # omit for the CLI's default
```

This is the **weakest** check of the six: the CLI's output carries no model
id, so the stamp records what you configured, unverified.

#### `cursor`

The list lives in your installed CLI, about 200 ids, and it moves with CLI
updates. Print it with `cursor-agent --list-models`
([CLI parameters](https://cursor.com/docs/cli/reference/parameters)). Copy an
id VERBATIM, effort variant included (`gpt-5.2-high`, `cursor-grok-4.6-low`):
`--model` accepts nothing outside this list, bracket overrides included. Omit
`model:` to run the CLI's default; `cursor-agent about --format json` shows
which, and the stamp then reads `cursor-default`.

```yaml
generator:
  provider: cursor
  model: gpt-5.2-high   # omit for the CLI's default
```

A bracketed id **refuses boot** (config check). A bad id fails the **first
generation** (`Cannot use this model`, a config error). The stamp records
what you configured, unverified.

#### Check a model without spending a webhook

`pnpm -C tools/categorizer categorize --config ../../mergebrief.config.yaml <pr-url>`
boots the same generator the worker would and fails fast on the same checks.

## Harness CLIs are HOST-PROCESS-ONLY in v1, deliberately

The `claude-code`, `codex` and `cursor` providers run a CLI **as a process on
your machine, under your interactive login**. They are not available inside ANY
container, including the docker-compose worker running on your own
laptop. "Local" is not the boundary; **host process vs container** is: a
container never sees your installed CLI or your login, no matter where it
runs. This is a boundary about where a login lives, not about whether
subscription auth is allowed. Deployed workers on API keys are legally
fine but erase the cost advantage, so they wait for a real deployed-mode
decision.

**On the terms of service** (verified 2026-08-26): running the vendor's own
CLI non-interactively against your own subscription, on your own machine, is
documented by both vendors as a supported use, and every enforcement action
on record targeted tools that reimplemented the vendor's client or handled
its OAuth tokens. MergeBrief spawns the unmodified binary and never touches
a credential. Two caveats an operator should own: Anthropic's permission
lives in a documentation page rather than versioned legal terms, so it can
narrow without notice; and "advertised usage limits … assume ordinary,
individual usage", which is undefined and volume-keyed. The safe shape is
one operator, one login, one machine, with no credential shared and no
generation run on anyone else's behalf.

What the CLIs *are* for: host-side processes in the dev loop
(`pnpm -C tools/categorizer categorize`, or the worker run on the host with
`pnpm app:host`, not its docker image) where your existing subscription
does the generating.

The boundary is enforced, not just documented: the image bakes
`MERGEBRIEF_RUNTIME=compose-worker` for every service it starts, and a
harness provider under that marker refuses boot with a targeted message
instead of a confusing missing-binary error. This matters because ONE config file can feed both
runtimes: a `provider: codex` switch made for your local loop would
otherwise take down the deployed worker. If you want a CLI provider
locally AND a running compose worker, give the worker its own config: a
worker-only `environment:` entry in `docker-compose.override.yml` pointing
`MERGEBRIEF_CONFIG` at a separate file (with its own mount); an empty YAML file is a valid
zero-config choice and gets you the anthropic default. (Note a compose
`environment:` entry can override but never *unset* a var from `.env`,
and set-but-empty is refused by design; a separate file is the
mechanism, or keep `MERGEBRIEF_CONFIG` out of `.env` entirely and set it
only in your local shell.)

Isolation per CLI (what a generation run may touch): every harness CLI,
startup checks included, runs from a fresh empty directory under
`~/.cache/mergebrief/harness`, removed after the run, so it never sees the
directory you launched from. The base sits in your home rather than the
shared temp dir because claude reads `CLAUDE.md` from every parent of its
working directory, and on Linux any local user can write to `/tmp`. On top
of that, claude-code runs with ALL built-in tools disabled, print mode and
no session persistence; codex runs with its shell, hosted web search and
its browser, computer-use, image, plugin and sub-agent tools off, under a
permission profile that lets what is left read only codex's minimal set of
system paths, its own install folders and the empty working folder (not
your home, not the `auth.json` in `CODEX_HOME`), with no network, and no
session persistence; cursor runs in
plan mode (read-only: a bare print-mode run would APPLY file writes). Two cursor housekeeping
notes: the CLI keeps its own session state under `~/.cursor` between runs
(the adapter's temp-cwd isolation does not cover the CLI's home-directory
state), and on macOS a `CURSOR_API_KEY` provided by env is written by the
CLI into the keychain (it warns and continues if that fails). Print mode alone does NOT stop a
non-bare `claude -p` run from executing hooks and connecting MCP servers.
The working directory is the empty one, so project-level config never
loads, and claude also runs with `--setting-sources ""`,
`--strict-mcp-config` and `--disable-slash-commands`, so your user-level
settings, hooks, plugins, MCP servers and skills under `~/.claude` stay
out too. codex runs with `--ignore-user-config --ignore-rules` and its
hooks feature off, which keeps the MCP servers, hooks, `notify` command
and rules in `~/.codex` out while auth still reads `CODEX_HOME`. cursor-agent has no equivalent switch, so
its user-level config under `~/.cursor` still applies, MCP servers included.
To hold it in, MergeBrief writes a deny-all `.cursor/cli.json` into the
empty working folder for every run and startup check. In testing it refused
every shell command, file read and web fetch cursor tried. The file also
denies MCP calls, but that part is untested, and your MCP servers still
load, so treat them as reachable. cursor enforces that file itself, not the
operating system. Every harness CLI runs under hard + inactivity watchdogs
with a process-group kill ladder: a hung CLI (or its grandchildren) is
killed, classified, and dumped, never waited on forever.

### What stays open

A harness CLI reads PR text written by people you may not trust, so
someone can write instructions into a PR description, a diff or a comment
and hope the model follows them. MergeBrief fences that text and tells the
model it is data, but no prompt can make that a guarantee. What protects
your machine is what each CLI can reach when the model does follow the
text:

- **claude-code:** nothing it can act with. It runs with every tool off,
  no MCP servers and no settings, and its environment holds only the base
  list (`PATH`, `HOME`, locale, your proxy and CA settings) plus its login
  vars.
- **codex:** its shell, web search and browser, computer-use, image,
  plugin and sub-agent tools are off, and a permission profile lets the
  rest read only codex's minimal system paths, its install folders and the
  empty working folder, with no network. A newer codex can add built-in
  tools MergeBrief has not checked; the worker warns at startup when your
  codex is newer than the tested version.
- **cursor:** the deny-all `.cursor/cli.json` blocked its shell, file
  reads and web fetches in testing, but cursor enforces that file itself.
  Your own MCP servers under `~/.cursor` still load and may be reachable,
  `CURSOR_API_KEY` sits in its environment, and nothing limits its
  network.

With codex or cursor, the worker logs a `generator.tool-access` warning at
startup, and every Brief they write says, under "Generated by", that a CLI
with tool access wrote it. For any CLI, PR text can still steer what a
Brief says, even when it can reach nothing. A Brief carrying a value the
worker holds as secret fails as `output-secret` instead of being stored.

On Windows, run the worker under WSL2: that is the tested path, and every
control above is a flag, an environment setting or a file in the working
folder, all of which work there.

### Billing: what "subscription" actually guarantees

Selecting a harness provider bills the CLI's **own login** (that is the
whole point), but a few facts keep the guarantee honest:

- **A harness CLI starts with an allowlisted environment, never the
  worker's.** The CLI reads PR text written by people you may not trust,
  so it gets only `PATH`, `HOME`, `USER`, `TMPDIR`, `LANG` and `LC_*`, your
  proxy and CA settings (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` and their
  lowercase forms, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`), and its own login
  vars: `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR` for claude,
  `CODEX_HOME` for codex, `CURSOR_API_KEY`, `CURSOR_CONFIG_DIR` and
  `XDG_CONFIG_HOME` for cursor. claude also gets `DISABLE_AUTOUPDATER=1` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Everything else the worker
  holds (`DATABASE_URL`, the GitHub App key, `SESSION_KEY_V1`, other provider
  API keys) stays out, generation and startup check alike. That also keeps the
  billing route honest: env credentials such as `ANTHROPIC_API_KEY` or
  `CODEX_API_KEY` sit ABOVE the interactive login in each CLI's auth
  precedence and would silently rebill every generation to an API account,
  and none of them is on the list. Residual hole the env cannot reach: an
  `apiKeyHelper` configured in the CLI's own settings file still outranks
  OAuth; remove it if you have one.
- **The startup check asserts the billing route.** At startup the worker
  reads `claude auth status` and refuses to start if the active route is
  an API key (including a settings-file `apiKeyHelper`) rather than the
  subscription login; output too old to carry the route fields degrades
  to an "unverifiable" warning rather than a refusal.
- **Each CLI must be at least the version MergeBrief's hardening was
  checked on.** The flags and config keys that keep a CLI away from your
  secrets can be ignored silently by an older release, so the worker
  refuses to start below claude 2.1.307, codex 0.163.0 or cursor-agent
  2026.10.19, naming both versions. A newer release starts with a warning:
  built-in tools it added have not been checked yet. A `--version` output
  with no readable version also starts with a warning.
- **A stray `CLAUDE_CODE_OAUTH_TOKEN` in your shell startup files can
  silently switch billing to metered.** Because the strip-list lets that
  var through on purpose (it is the subscription route), a stale token
  exported from `~/.zshenv`/`~/.zshrc` attaches to every headless run. If
  attribution ever looks wrong, check there first:
  `grep -r CLAUDE_CODE_OAUTH_TOKEN ~/.zshenv ~/.zshrc ~/.profile`.
- **Never override `HOME` to isolate the CLI.** On macOS the OAuth
  credentials live in the keychain, which is tied to your real home, and
  overriding `HOME` breaks auth in confusing ways. If you need to isolate
  the CLI's config, `CLAUDE_CONFIG_DIR` is the knob.
- **Subscription billing holds only within plan quota.** Headless runs
  auto-roll into paid "extra usage" credits when that toggle is enabled on
  the account, without any prompt or warning, and with no client-side
  off-switch. Disable extra usage in your account's billing settings if
  you want quota exhaustion to be a loud error instead of a bill. This is
  the documented real-world failure mode of orchestrated headless runs, and
  it is unbounded: one publicly reported `claude -p` workload spent $313 in
  8.5 hours before anyone noticed.
- **Scale accordingly.** Per-PR generation fits comfortably in a Pro/Max
  window; batch workloads (the eval suite: ~60 generations per full run)
  do not fit a Pro plan.

#### Attribution: verified clean, version-pinned

Older `claude` CLI versions (observed on the 2.1.207 era) misattributed
headless subscription-OAuth runs to the linked Console account's prepaid
API credits. **Verified clean at CLI 2.1.226 (2026-08-08)**: bare `-p`,
the exact harness invocation (stream-json, disabled tools, JSON schema,
system-prompt file), and the `claude setup-token` route all billed the
subscription: the Console prepaid balance did not move across any round,
proved by elimination with extra usage OFF. The fix appears in no
changelog, so treat this as **version-verified, not guaranteed**:
re-verify after CLI upgrades if attribution matters to you. The startup
version floor (2.1.307) sits above this release.

Re-verify in two minutes:

1. Note your Console prepaid balance and turn extra usage OFF.
2. Run one generation (`pnpm -C tools/categorizer categorize` against any PR).
3. Wait a few minutes for attribution to settle.
4. Confirm the balance did not move and the run shows on your claude.ai
   usage page.

Two caveats on what that verification covered: it ran well below plan
quota (~5% of a session), so near-limit behavior is untested; keeping
extra usage OFF is what guarantees hitting the cap refuses instead of
billing. And it verified attribution, not cost: the envelope's
`total_cost_usd` field is a notional token price and cannot tell you
which account was billed; your balance and usage page are the only real
check.

## What the model receives

Before a prompt is built, the worker redacts the credentials it can recognize
with high confidence. That covers the diff and every piece of PR text the prompt
carries: title, description, linked pages, tickets, review comments,
`.mergebrief/instructions.md` and the custom attributes in `policy.yaml`. It recognizes private key blocks, GitHub, GitLab,
Slack, Stripe, npm, Anthropic and OpenAI tokens, AWS access key ids, Google API
keys, JWTs and the password in a URL. Each becomes a marker such as
`[redacted:github-token]` on the same line, so the brief's line references still
match the diff you review, which is never redacted.

This is best effort, not data-loss prevention. A secret with no recognizable
format, such as a `password=` assignment, reaches your model provider as
written. Treat a credential committed to a pull request as leaked and rotate it.

A pull request [briefed in parts](#the-large-pool) shortens lockfiles and marked
files. A pnpm, npm or yarn lockfile reaches the model as its package changes, or
as counts when they cannot be read. Any other known lockfile, such as `Cargo.lock`
or `go.sum`, reaches it as counts only. A file marked `linguist-generated` or `linguist-vendored` reaches it as, at most, its
path, status, line counts and hunk headers, with no code. Those marks come from
the root `.gitattributes` on the default branch. The worker reads neither a
nested `.gitattributes` nor the pull request's own copy, so a pull request cannot
shorten its own code. If that file is over 64 KiB or holds rules this reader
refuses, such as more than 200, marked files are read in full and lockfiles stay
shortened. A brief made in one call shortens nothing. The
pipeline writes each shortened file's chunk and marks it "Read as package changes"
or "Read as counts only", and the receipt counts these files under "Files read
shortened". The `adds-secret` and `changes-package-source` flags still read their
full code.

## Pushes, rebases and force pushes

The revision narrative, the delta and the comparison highlights read the revision
span: the pull request's own diff at two heads, and what differs between them.
One head is the new push. The other is the previous brief's head, or for a delta
the head of the reviewer's last review, so several quick pushes read as one.

A rebase or force push does not retell the commits it rewrote, and merging the
base branch in does not show the base branch's changes. A conflict resolution that
changes the pull request's own diff does show. A file over 1 MB, or past the span's
line-diff budget, skips the line diff, so it can read as changed when only the code
around the pull request's change moved.

### A push that changes nothing

When the span shows no change, the narrative and the delta make no model call and
the page says "No change since the previous brief." The brief makes no model call
either if nothing it read beside the diff moved: the title, branch names, stack
position, description, linked pages, primary ticket and the repository's
`.mergebrief/` instructions and custom attributes. That run costs nothing against the [daily cap](#daily-generation-cap).

Two cases still spend. Edit the description and push a rebase, and the brief calls
the model while the page still says no change. A reviewer whose last review
predates a real change gets a delta against the new head, which is a model call,
and the run counts.

### What carries over

The next brief keeps each group the push left alone and looks again only at the
groups it touched, whatever the push was and whether the run is one call or in
parts. Groups that share a file carry or re-look together. Read marks on kept groups
stay, and a re-looked group starts unread.

A draft comment on a new-side line moves with its code, and is orphaned when those
lines changed. A draft on the old side is orphaned when the pull request's base
moved, which a rebase usually does. A reviewer re-places or deletes an orphaned
draft before the review can post.

Nothing carries when `generator.full-regeneration` asks for a fresh brief: `always`
on every revision, a no-change push included, and `on-model-swap` when the provider
or model changed ([configuration.md](./configuration.md#generator)).

When changes cannot be matched across a push, Brief details says so and the groups
holding them are looked at again. A force push can also leave GitHub unable to serve
the old head. On that failure, or one retries do not clear, the worker logs `warn`
`generate: revision span unavailable; skipping its artifacts` and writes no
narrative, delta or highlights, every group is looked at again, and the page says
the change could not be read.

### The 300-file span limit

A span holds at most 300 changed files, and no setting changes that. A fast-forward
over an unmoved merge base counts the files changed between the two heads. Any other
push counts the files that may have changed once both pull request diffs are
compared, and a possible base rename counts as two. GitHub refusing a diff the span
needs, serving it short, or timing out on every attempt has the same result.

What a push past the limit loses:

- **Its comparison.** It gets no narrative, no delta for a review at the previous
  brief's head, and no changed-line highlights. The page says the change was too
  large to summarize or compare.
- **The carry.** Every group is looked at again, so the brief pays for its model
  calls in full, and Brief details says no group carried over.
- **Reviewer state.** Read marks do not carry and every line draft is orphaned. A
  draft on a whole file stays while that file is in the brief.

The next push compares against this push's brief as usual.

This limit covers the span only. A pull request can change up to 3,000 files and
still get a brief ([troubleshooting.md](./troubleshooting.md#no-brief-appears)). A
smaller span can also go without a narrative or delta when its changed lines reach
`HUGE_SPAN_RATIO` of the pull request's, 0.65 by default, or when it exceeds one
call's limits. That skip keeps the highlights and the carried groups.

### GitHub API calls

A fast-forward over an unmoved merge base reads three merge bases and two diffs.
Any other push reads the same merge bases and both heads' pull request diffs, plus
two file reads per file only a line diff can settle and the probes for possible base
renames. Past the limit it stops before those file reads. The worker makes these calls for the
previous brief's span and for each other review checkpoint. The api makes them on
the reviewer's token when a reviewer opens the changes-only view, and caches the
answer per session. Frequent force pushes on a large pull request spend more of your
GitHub rate limit than the same number of fast-forwards.

## When something degrades

Salvage (a dropped invalid enum entry), the one feedback retry, a
served-model mismatch, and a run-time effort-knob discovery (openai) all:
(1) log with `⚠`/`warning:` prefixes, and (2) land on the artifact as
`generationWarnings`, rendered under the Brief header. One exception by
design: OpenRouter learns a model's missing `reasoning` support at BOOT
(from its `/models` preflight), so that gap logs once at construction and
shows as `effort: null` in the origin line rather than as a per-artifact
warning. The origin line also shows the adapter class (`via anthropic
(API)/…` vs `via claude-code (local CLI)/…`), so a CLI-generated Brief is
never mistaken for an API one.

### When the `claude-code` login stops authenticating

If the `claude-code` provider's `claude -p` call stops authenticating, the
`anthropic` provider with an API key is the fallback. In
`mergebrief.config.yaml`, set `generator.provider: anthropic`, remove
`command:` and `timeouts:`, which that provider refuses at boot, and check
that `model:` is an API model id or absent. Put the key in
`ANTHROPIC_API_KEY`, or in the variable `apiKeyEnv` names, and restart the
worker. Generations then authenticate with that key, never the `claude`
login.

### Length discipline and anchoring degrade on weaker models

Brief text carries length caps in the prompt (group titles/summaries,
revision-narrative overview and hover-callout summaries, risk notes), and
cross-revision stability rides an anchored minimal-edit rule. Both are
prompt-enforced: strong models comply; weaker models over-write
and rewrite. The pipeline never trims or retries: over-cap text is
stamped on the artifact (`lengthViolations`) and surfaces two ways: a
muted line on the Changes view ("Some brief text is longer than the
length guidance…") and `⚠ prose length` entries in `generationWarnings`. The
hover callout clamps visually as a last resort. Anchored-edit drift
(wholesale summary rewrites between revisions) has no mechanical guard at
all; it is a model-quality property. If you see either persistently,
the fix is a stronger `model:`, not configuration.

Webhooks answering 200 but no briefs appearing? Check the worker:
`docker compose ps -a`. A worker shown `Exited (0)` either refused boot on a
config error or was stopped gracefully (e.g. a host reboot); the last
line of `docker compose logs worker` tells you which: a refusal names the
config problem (a harness provider reaching the compose worker lands
here); `worker: stopped` means a plain stop, bring it back with
`docker compose up -d`. Config errors deliberately stay down instead of
restart-looping; only transient crashes (nonzero exits) restart.

Before releases and after CLI upgrades, run the live smoke:
[`docs/dev/generator-smoke-recipe.md`](../dev/generator-smoke-recipe.md).
