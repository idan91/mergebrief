# Generation backends (`mergebrief.config.yaml`)

MergeBrief generates Briefs through one of five interchangeable backends
(BRIEF-11 / ADR 0030). Every backend meets the same hard contract: **the
output is valid against the Brief schema or the generation fails loudly** —
native provider enforcement is a bonus layer, never the mechanism. Salvage
and one feedback retry run identically everywhere, and when they fire they
are visible: in logs, and on the artifact itself (the header's amber
`generationWarnings` block).

## Zero-config default

No config file at all: **Anthropic API + `ANTHROPIC_API_KEY` + Claude Opus
4.8**. That is exactly the pre-BRIEF-11 behavior.

The documented cost knob: `model: claude-sonnet-5` on the `anthropic`
provider (~5x cheaper input/output than Opus at very good Brief quality).

## The config file

One optional YAML file selects the backend for the **worker, the web app,
and the categorizer CLIs** alike. A ready-to-copy annotated template ships
at the repo root: [`mergebrief.config.example.yaml`](../../mergebrief.config.example.yaml)
(copy to `mergebrief.config.yaml` — gitignored — same convention as
`.env.example`).

```yaml
# mergebrief.config.yaml — next to your compose file
generator:
  provider: anthropic          # anthropic | claude-code | codex | openai | openrouter
  model: claude-sonnet-5       # optional here; REQUIRED for openai/openrouter
  # effort: medium             # low | medium | high — reasoning effort for every
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
  # providerRouting:           # openrouter only: routing options passthrough —
  #   order: ["anthropic"]     # any key from openrouter.ai/docs/features/provider-routing
  # referer: https://you.example   # openrouter attribution headers
  # title: MergeBrief

# drafts: — the OTHER root block (BRIEF-64): draft-PR generation policy
# (generate: on|off + optional draft regeneration debounceSeconds). Spend
# knobs, read by the web/api process — see self-host/repo-config.md's
# instance-block section for semantics.
# drafts:
#   generate: on
#   debounceSeconds: 900

# spend: — the THIRD root block (BRIEF-20): the daily generation cap, at
# most N generations per repo per UTC day. Both keys optional; omitting the
# block means uncapped. See the "Daily generation cap" section below.
# spend:
#   dailyGenerationCap: 50
#   perRepo:
#     acme/sandbox: 5

# x-*: root keys starting with "x-" are ignored (compose-style extension
# slot); ANY other unknown key — root or inside generator:/drafts:/spend: —
# refuses boot.
x-notes: anything here is yours
```

How processes find it:

| Surface | Mechanism |
|---|---|
| worker + web | `MERGEBRIEF_CONFIG=mergebrief.config.yaml` — relative resolves against the workspace root (see path-form note); absolute also fine (env var unset → zero-config default; set-but-empty or unreadable → refuses boot) |
| categorizer CLIs | explicit `--config <path>` only — they never read `MERGEBRIEF_CONFIG` (`pnpm categorize --config ./mergebrief.config.yaml <pr-url>` also doubles as a fast config validator) |

**Path form** (BRIEF-70): a relative `MERGEBRIEF_CONFIG` is resolved
against the **workspace root** — the nearest ancestor of the process
working directory containing `pnpm-workspace.yaml` — never against bare
cwd (the worker runs from `packages/worker`, the web app from `apps/web`;
cwd-relative would let one env value silently name different files). So
`MERGEBRIEF_CONFIG=mergebrief.config.yaml` in `.env` means the repo-root
file everywhere, local and dockerized alike — the docker image is a full
workspace checkout, so the anchor holds there too. Absolute paths pass
through unchanged. No workspace root above cwd refuses boot and points at
absolute paths. Dockerized live edits: uncomment the config mount in
`docker-compose.yml` (both services) to shadow the baked copy so yaml
changes apply on restart instead of rebuild.

> **Packaged distributions (future)**: workspace-root anchoring assumes the
> process runs inside a repo checkout. If MergeBrief ever ships as an
> installed distribution (global npm package, prebuilt binary) running
> outside a checkout, no anchor exists — relative values refuse boot with
> an explicit message and such deployments must use absolute paths.
> Revisit the resolution rule when that distribution mode becomes real.

Every boot-knowable problem **refuses boot with per-field issues** (values
never echoed): unknown provider, unknown keys, a key env var that is unset,
a CLI that is missing or not logged in. API keys are BYOK-by-env-NAME —
the key value never lives in this file, the DB, or repo config.

## Daily generation cap

The one spend guardrail v1 ships (BRIEF-20): **at most N generations per
repo per UTC calendar day**. It is instance config — the operator pays the
bill, so no `.mergebrief/` repo file can set, raise, or lower it.

```yaml
spend:
  dailyGenerationCap: 50      # applies to every repo without an override
  perRepo:
    acme/payments-api: 200    # owner/name, case-insensitive; beats the default
    acme/sandbox: 5
```

Both keys are optional and both must be positive whole numbers; omitting
the block leaves the instance **uncapped** (the default). A `perRepo` key
naming a repo this instance never sees is ignored — the installation set
changes without you editing this file.

At the cap the worker **skips** the generation before any provider call:

- the PR's brief view shows a distinct "daily generation cap reached" state
  with the reset time in the viewer's local zone — never a fake failure;
- an Entry comment that **already exists** on the PR is updated to say so;
  no comment is created for a capped PR;
- the worker logs `evt: spend.cap.trip` at `warn` with `repo`, `prId`,
  `prId`, `headSha`, `cap`, `dayUtc` (see
  [observability.md](./observability.md));
- nothing is queued for later.

The counter is the generation store itself: **provider attempts** by that
repo on the current UTC day — not distinct pull requests, and not distinct
pushes. A push that is re-queued (another push lands, a review is submitted)
spends again and counts again, so a single busy PR can consume a day's
budget on its own. Runs that were superseded or failed DO count: they spent.
Queued-but-not-yet-drained jobs and capped skips do not — a burst of
webhooks must not trip the cap before a single token is spent.

The count is a guardrail, not an invoice: it errs toward capping slightly
early, and it does not observe the queue's own internal retries of a single
run. Treat it as a ceiling on the order of magnitude you are willing to
spend per repo per day, not as an exact call count. Cost reporting is a
separate, later concern.

The window resets at 00:00 UTC. A push skipped today is not retried
automatically when the cap resets — the PR gets its brief on its next
settled push (or any event that re-queues it).

## The five providers

| provider | class | auth | effort knob | notes |
|---|---|---|---|---|
| `anthropic` | API | `apiKeyEnv` (default `ANTHROPIC_API_KEY`) | yes | the default; `claude-sonnet-5` = cost knob |
| `openai` | API | `apiKeyEnv` (default `OPENAI_API_KEY`) | discovered at run time (a model without `reasoning_effort` records `effort: null`) | `model` required; `baseUrl` escape hatch for self-hosted compatible servers (preflight downgrades to warnings) |
| `openrouter` | API | `apiKeyEnv` (default `OPENROUTER_API_KEY`) | gated by the model's listed `reasoning` support | full slug required; boot requires the model to list `structured_outputs`; `require_parameters` is forced on every request |
| `claude-code` | **local CLI** | your interactive `claude /login` (OAuth/keychain) | none (`effort: null` — honest gap) | lockdown: `--tools ""`, print mode, no `--bare`; served model verified from `modelUsage` post-run |
| `codex` | **local CLI** | your interactive `codex login` | `model_reasoning_effort` | lockdown: `--sandbox read-only --skip-git-repo-check --ephemeral`; **provenance blind spot**: codex's JSONL carries no model id, so a silent server-side reroute is unobservable — the stamp records what you configured |

`effort:` note: the committed eval baselines (`tools/categorizer/eval`)
assume the default (anthropic at `medium`) — running an instance at a
non-default effort is a deliberate divergence from them, same as running a
non-default provider or model.

## Harness CLIs are LOCAL-ONLY in v1 — deliberately

The `claude-code` and `codex` providers run a CLI **on your machine, under
your interactive login**. They are not available to the deployed
docker-compose worker, and this is a boundary, not a gap: the thing that
makes CLI backends attractive — subscription auth — is at best a
documented-but-discouraged path for unattended use (Codex), and at worst
explicitly reserved for "ordinary, individual usage" with active
enforcement (Anthropic). Deployed workers on API keys are legally fine but
erase the cost advantage, so they wait for a real deployed-mode decision.
Full reasoning + the revisit triggers:
[`docs/dev/harness-cli-deployed-feasibility.md`](../dev/harness-cli-deployed-feasibility.md).

What the CLIs *are* for: the local dev loop (`pnpm categorize`, the local
web dogfood) where your existing subscription does the generating.

The boundary is enforced, not just documented: the worker image bakes
`MERGEBRIEF_RUNTIME=compose-worker`, and a harness provider under that
marker refuses boot with a targeted message instead of a confusing
missing-binary error. This matters because ONE config file can feed both
runtimes — a `provider: codex` switch made for your local loop would
otherwise take down the deployed worker. If you want a CLI provider
locally AND a running compose worker, give the worker its own config: a
worker-only `environment:` entry pointing `MERGEBRIEF_CONFIG` at a
separate file (with its own mount) — an empty YAML file is a valid
zero-config choice and gets you the anthropic default. (Note a compose
`environment:` entry can override but never *unset* a var from `.env`,
and set-but-empty is refused by design — a separate file is the
mechanism, or keep `MERGEBRIEF_CONFIG` out of `.env` entirely and set it
only in your local shell.)

Isolation per CLI (what a generation run may touch): claude-code runs with
ALL built-in tools disabled and print mode; codex runs read-only sandboxed
with no session persistence. Both run under hard + inactivity watchdogs
with a process-group kill ladder — a hung CLI (or its grandchildren) is
killed, classified, and dumped, never waited on forever.

### Billing: what "subscription" actually guarantees

Selecting a harness provider bills the CLI's **own login** — that is the
whole point — but a few facts keep the guarantee honest:

- **The harness strips credential env vars before spawning.** Both CLIs
  put env credentials ABOVE the interactive login in their auth
  precedence (no flag disables it), so a leaked `ANTHROPIC_API_KEY` /
  `CODEX_API_KEY` would silently rebill every generation to an API
  account. MergeBrief removes the known credential and billing-redirect
  vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`, `CODEX_API_KEY`,
  `CODEX_ACCESS_TOKEN`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) from the
  spawned CLI's environment — generation and boot probe alike — so the
  configured provider means what it says. `CLAUDE_CODE_OAUTH_TOKEN`
  survives deliberately: it IS the subscription route. Residual hole the
  strip cannot reach: an `apiKeyHelper` configured in the CLI's own
  settings file still outranks OAuth — remove it if you have one.
- **A stray `CLAUDE_CODE_OAUTH_TOKEN` in your shell startup files can
  silently switch billing to metered.** Because the strip-list lets that
  var through on purpose (it is the subscription route), a stale token
  exported from `~/.zshenv`/`~/.zshrc` attaches to every headless run. If
  attribution ever looks wrong, check there first:
  `grep -r CLAUDE_CODE_OAUTH_TOKEN ~/.zshenv ~/.zshrc ~/.profile`.
- **Never override `HOME` to isolate the CLI.** On macOS the OAuth
  credentials live in the keychain, which is tied to your real home —
  overriding `HOME` breaks auth in confusing ways. If you need to isolate
  the CLI's config, `CLAUDE_CONFIG_DIR` is the knob.
- **Subscription billing holds only within plan quota.** Headless runs
  auto-roll into paid "extra usage" credits when that toggle is enabled on
  the account — without any prompt or warning, and with no client-side
  off-switch. Disable extra usage in your account's billing settings if
  you want quota exhaustion to be a loud error instead of a bill.
- **Scale accordingly.** Per-PR generation fits comfortably in a Pro/Max
  window; batch workloads (the eval suite: ~60 generations per full run)
  do not fit a Pro plan.

#### Attribution: verified clean, version-pinned

Older `claude` CLI versions (observed on the 2.1.207 era) misattributed
headless subscription-OAuth runs to the linked Console account's prepaid
API credits. **Verified clean at CLI 2.1.226 (2026-08-08)**: bare `-p`,
the exact harness invocation (stream-json, disabled tools, JSON schema,
system-prompt file), and the `claude setup-token` route all billed the
subscription — the Console prepaid balance did not move across any round,
proved by elimination with extra usage OFF. The fix appears in no
changelog, so treat this as **version-verified, not guaranteed**:
re-verify after CLI upgrades if attribution matters to you.

Re-verify in two minutes:

1. Note your Console prepaid balance and turn extra usage OFF.
2. Run one generation (`pnpm categorize` against any PR).
3. Wait a few minutes for attribution to settle.
4. Confirm the balance did not move and the run shows on your claude.ai
   usage page.

Two caveats on what that verification covered: it ran well below plan
quota (~5% of a session), so near-limit behavior is untested — keeping
extra usage OFF is what guarantees hitting the cap refuses instead of
billing. And it verified attribution, not cost: the envelope's
`total_cost_usd` field is a notional token price and cannot tell you
which account was billed — your balance and usage page are the only real
check.

## When something degrades

Salvage (a dropped invalid enum entry), the one feedback retry, a
served-model mismatch, and a run-time effort-knob discovery (openai) all:
(1) log with `⚠`/`warning:` prefixes, and (2) land on the artifact as
`generationWarnings`, rendered under the Brief header. One exception by
design: OpenRouter learns a model's missing `reasoning` support at BOOT
(from its `/models` preflight), so that gap logs once at construction and
shows as `effort: null` in provenance rather than as a per-artifact
warning. The provenance line also shows the adapter class — `via anthropic
(API)/…` vs `via claude-code (local CLI)/…` — so a CLI-generated Brief is
never mistaken for an API one.

Webhooks answering 200 but no briefs appearing? Check the worker:
`docker compose ps`. A worker shown `Exited (0)` either refused boot on a
config error or was stopped gracefully (e.g. a host reboot) — the last
line of `docker compose logs worker` tells you which: a refusal names the
config problem (a harness provider reaching the compose worker lands
here); `worker: stopped` means a plain stop, bring it back with
`docker compose up -d`. Config errors deliberately stay down instead of
restart-looping; only transient crashes (nonzero exits) restart.

Before releases and after CLI upgrades, run the live smoke:
[`docs/dev/generator-smoke-recipe.md`](../dev/generator-smoke-recipe.md).
