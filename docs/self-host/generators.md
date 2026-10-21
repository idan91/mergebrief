# Generation backends (`mergebrief.config.yaml`)

MergeBrief generates Briefs through one of six interchangeable backends.
Every backend meets the same hard contract: **the
output is valid against the Brief schema or the generation fails loudly**;
native provider enforcement is a bonus layer, never the mechanism. Salvage
and one feedback retry run identically everywhere, and when they fire they
are visible: in logs, and on the artifact itself (the header's amber
`generationWarnings` block).

## Zero-config default

No config file at all: **Anthropic API + `ANTHROPIC_API_KEY` + Claude Opus
4.8**.

The documented cost knob: `model: claude-sonnet-5` on the `anthropic`
provider (~5x cheaper input/output than Opus at very good Brief quality).

## The config file

One optional YAML file selects the backend for the **worker and the
categorizer CLIs** alike; the api reads its `drafts`, `spend` and
`operators` blocks from the same file. A ready-to-copy annotated template ships
at the repo root: [`mergebrief.config.example.yaml`](../../mergebrief.config.example.yaml)
(copy to `mergebrief.config.yaml`, which is gitignored, the same convention as
`.env.example`).

```yaml
# mergebrief.config.yaml: next to your compose file
generator:
  provider: anthropic          # anthropic | claude-code | codex | cursor | openai | openrouter
  model: claude-sonnet-5       # optional here; REQUIRED for openai/openrouter
  # effort: medium             # low | medium | high: reasoning effort for every
  #                            # generation (default medium); see the effort-knob
  #                            # column below for what each provider does with it
  # apiKeyEnv: MY_KEY_VAR      # API providers: NAME of the env var holding the key
  # baseUrl: https://your-server.example/v1   # openai only: OpenAI-compatible
  #                            # server escape hatch (preflight downgrades to warnings)
  # command: /usr/local/bin/claude   # CLI providers: binary path/name
  # timeouts:                  # CLI providers: harness timer tunables (ms)
  #   hardMs: 900000
  #   inactivityMs: 180000
  #   killGraceMs: 5000
  # providerRouting:           # openrouter only: routing options passthrough:
  #   order: ["anthropic"]     # any key from openrouter.ai/docs/features/provider-routing
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
# Omitting the block means uncapped. See "Daily generation cap" below.
# spend:
#   maxGenerationsPerDay: 50

# contextSources: the FOURTH root block: ticket trackers that need a
# deployment credential, by env-var NAME. URLs and GitHub issues are built
# in and need no entry. See self-host/trackers.md.
# contextSources:
#   - type: notion
#     tokenEnv: NOTION_TOKEN

# trackers: the FIFTH root block: the boards every repo on this instance
# reads tickets from, one entry per board. A repo whose own
# .mergebrief/settings.yaml names trackers replaces this list. Same entry
# shape as the repo file; see self-host/repo-config.md.
# trackers:
#   - kind: notion
#     keyPrefix: ACME
#     databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
#   - kind: github

# operators: the SIXTH root block: the GitHub user ids of the people who
# run this instance. See "Operators" below.
# operators:
#   - 583231

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

Edits to the file then apply when `api` and `worker` restart.

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

The key is optional and must be a positive whole number; omitting the block
leaves the instance **uncapped** (the default). There is no per-repo
override: the cap is a ceiling, not fair share, so a busy repo can use the
day's budget for the others. If that bites, raise the number.

At the cap the worker **skips** the generation before any provider call:

- the PR's brief view shows a distinct "daily generation cap reached" state
  with the reset time in the viewer's local zone, never a fake failure;
- an Entry comment that **already exists** on the PR is updated to say so;
  no comment is created for a capped PR;
- the worker logs `evt: spend.cap.trip` at `warn` with `repo`, `prId`,
  `headSha`, `cap`, `dayUtc` (see
  [observability.md](./observability.md));
- nothing is queued for later.

The counter is one record per started run: **provider attempts** started on
the current UTC day, whichever repo made them, not distinct pull requests, and
not distinct pushes. A push that is re-queued (another push lands, a review is submitted)
spends again and counts again, and so does every automatic retry of a failed
run, so a single busy PR can consume a day's budget on its own. Runs that
were superseded or failed DO count: they spent. A run counts on the day it
started, and purging its pull request does not take it back.
Queued-but-not-yet-drained jobs and capped skips do not: a burst of
webhooks must not trip the cap before a single token is spent. A job that
finds a brief already stored for its base and head pair (a review submitted
after the brief, a ready flip that still needs its Entry comment, a retry
whose brief landed before it failed) produces no brief generation and counts
only if it pays: one that still owes a checkpoint delta or a narrative counts
once, at its first provider call, and is refused there if the cap is reached.
While the instance sits at the cap such a job is refused before any work.

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

The api reads this block, together with `drafts` and `spend`, from the same
`MERGEBRIEF_CONFIG` file as the worker. A change takes effect when the api
restarts.

## Worker slots

Two dials, both env, both optional:

- `WORKER_CONCURRENCY`: generate jobs one worker process drains at once.
  Default 1.
- `WORKER_COUNT`: worker containers compose starts. Default 1.

Concurrent generations = `WORKER_COUNT` x `WORKER_CONCURRENCY`. Prefer one
worker and more slots: a slot is cheaper than a process. A second worker
buys restart isolation, not throughput slots could not give you.

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
| `anthropic` | API | `apiKeyEnv` (default `ANTHROPIC_API_KEY`) | yes | the default; `claude-sonnet-5` = cost knob |
| `openai` | API | `apiKeyEnv` (default `OPENAI_API_KEY`) | discovered at run time (a model without `reasoning_effort` records `effort: null`) | `model` required; `baseUrl` escape hatch for self-hosted compatible servers (preflight downgrades to warnings) |
| `openrouter` | API | `apiKeyEnv` (default `OPENROUTER_API_KEY`) | gated by the model's listed `reasoning` support | full slug required; boot requires the model to list `structured_outputs`; `require_parameters` is forced on every request |
| `claude-code` | **local CLI** | your interactive `claude /login` (OAuth/keychain) | none (`effort: null`, an honest gap) | lockdown: `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, print mode, no `--bare`; served model verified from `modelUsage` post-run |
| `codex` | **local CLI** | your interactive `codex login` | `model_reasoning_effort` | lockdown: `--sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules -c features.hooks=false`; **origin blind spot**: codex's JSONL carries no model id, so a silent server-side reroute is unobservable, so the stamp records what you configured |
| `cursor` | **local CLI** | your interactive `cursor-agent login` (or `CURSOR_API_KEY`, which bills the same subscription pool) | rides the model-id VARIANT (`gpt-5.2-high` vs `-low`); the `effort:` knob has no wire effect (the stamp parses the id's suffix; a disagreeing `effort:` logs a note) | lockdown: `--mode plan` from an empty temp dir (bare print mode APPLIES file writes); the stream is pipe-silent until exit, so the wall-clock timeout is the only watchdog; **origin blind spot**: the envelope has no model field and `system/init` echoes the request, so the stamp records what you configured |

`effort:` note: the committed eval baselines (`tools/categorizer/eval`)
assume the default (anthropic at `medium`); running an instance at a
non-default effort is a deliberate divergence from them, same as running a
non-default provider or model.

### Picking a `model:` value without typos

Model names are provider-owned lists that change often, so this repo never
hardcodes them (a checked-in list would go stale and start rejecting valid
new models). Instead, copy the exact name from the provider's own list, and
know when a typo gets caught:

| provider | where the valid names live | what a typo does |
|---|---|---|
| `anthropic` | [platform.claude.com/docs: models overview](https://platform.claude.com/docs/en/about-claude/models/overview) (ids like `claude-opus-4-8`, `claude-sonnet-5`), or query `GET /v1/models` with your key | fails the **first generation** with a config-classified error (no boot check) |
| `openai` | [platform.openai.com/docs/models](https://platform.openai.com/docs/models); with `baseUrl`, whatever your server's `/models` serves | **refuses boot**: the `/models/{id}` preflight 404s on a bad id (downgraded to a warning when `baseUrl` is set) |
| `openrouter` | [openrouter.ai/models](https://openrouter.ai/models): copy the full slug, e.g. `anthropic/claude-sonnet-5` | **refuses boot**: the `/models` preflight requires your slug to exist (and list `structured_outputs`) |
| `claude-code` | whatever your installed `claude` CLI accepts: aliases like `opus` / `sonnet` / `haiku` or full ids from the Anthropic models page above ([model config docs](https://code.claude.com/docs)) | fails the **first generation** (`model_not_found` → config error); post-run the served model is verified against the CLI's own report, mismatch = warning |
| `codex` | your installed `codex` CLI's configured models ([platform.openai.com/docs/models](https://platform.openai.com/docs/models)); omit `model:` to use the CLI's default | **weakest**: the CLI's output carries no model id, so the stamp records what you configured, unverified |
| `cursor` | **run `cursor-agent --list-models`**: the list lives in your installed CLI (~200 ids, moves with CLI updates; [CLI reference](https://cursor.com/docs/cli/reference/parameters)); copy the id VERBATIM, effort variant included (`gpt-5.2-high`, `cursor-grok-4.6-low`). `--model` accepts nothing outside this list, bracket overrides included. Omit `model:` to use the CLI's default (`cursor-agent about --format json` shows which; the stamp then reads `cursor-default`) | a bracketed id **refuses boot** (config check); a bad id fails the **first generation** (`Cannot use this model` → config error); the stamp records what you configured, unverified |

Fast pre-check for any provider without spending a webhook:
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
no session persistence; codex runs read-only sandboxed with no session
persistence; cursor runs in
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
out too. codex runs with `--ignore-user-config --ignore-rules -c
features.hooks=false`, which keeps the MCP servers, hooks, `notify`
command and rules in `~/.codex` out while auth still reads `CODEX_HOME`. cursor-agent has no equivalent switch, so
its user-level config under `~/.cursor` still applies. Every harness CLI runs under hard + inactivity watchdogs
with a process-group kill ladder: a hung CLI (or its grandchildren) is
killed, classified, and dumped, never waited on forever.

### Billing: what "subscription" actually guarantees

Selecting a harness provider bills the CLI's **own login** (that is the
whole point), but a few facts keep the guarantee honest:

- **The harness strips credential env vars before spawning.** Both CLIs
  put env credentials ABOVE the interactive login in their auth
  precedence (no flag disables it), so a leaked `ANTHROPIC_API_KEY` /
  `CODEX_API_KEY` would silently rebill every generation to an API
  account. MergeBrief removes the known credential and billing-redirect
  vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`, `CODEX_API_KEY`,
  `CODEX_ACCESS_TOKEN`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `CURSOR_API_ENDPOINT`) from the
  spawned CLI's environment, generation and startup check alike, so the
  configured provider means what it says. `CLAUDE_CODE_OAUTH_TOKEN`
  survives deliberately: it IS the subscription route. Residual hole the
  strip cannot reach: an `apiKeyHelper` configured in the CLI's own
  settings file still outranks OAuth; remove it if you have one.
- **The startup check asserts the billing route.** At startup the worker
  reads `claude auth status` and refuses to start if the active route is
  an API key (including a settings-file `apiKeyHelper`) rather than the
  subscription login; a CLI older than 2.1.226 (see below) draws a
  warning, and output too old to carry the route fields degrades to an
  "unverifiable" warning rather than a refusal.
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
re-verify after CLI upgrades if attribution matters to you.

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

### Length discipline and anchoring degrade on weaker models

Brief text carries length caps in the prompt (group titles/summaries,
revision-narrative overview and hover-callout summaries, risk notes), and
cross-revision stability rides an anchored minimal-edit rule. Both are
prompt-enforced: strong models comply; weaker models over-write
and rewrite. The pipeline never trims or retries: over-cap text is
stamped on the artifact (`lengthViolations`) and surfaces two ways: a
muted line on the Changes view ("Some brief text exceeds length
guidance…") and `⚠ prose length` entries in `generationWarnings`. The
hover callout clamps visually as a last resort. Anchored-edit drift
(wholesale summary rewrites between revisions) has no mechanical guard at
all; it is a model-quality property. If you see either persistently,
the fix is a stronger `model:`, not configuration.

Webhooks answering 200 but no briefs appearing? Check the worker:
`docker compose ps`. A worker shown `Exited (0)` either refused boot on a
config error or was stopped gracefully (e.g. a host reboot); the last
line of `docker compose logs worker` tells you which: a refusal names the
config problem (a harness provider reaching the compose worker lands
here); `worker: stopped` means a plain stop, bring it back with
`docker compose up -d`. Config errors deliberately stay down instead of
restart-looping; only transient crashes (nonzero exits) restart.

Before releases and after CLI upgrades, run the live smoke:
[`docs/dev/generator-smoke-recipe.md`](../dev/generator-smoke-recipe.md).
