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
  # apiKeyEnv: MY_KEY_VAR      # API providers: NAME of the env var holding the key
  # baseUrl: https://your-server.example/v1   # openai only: OpenAI-compatible
  #                            # server escape hatch (preflight downgrades to warnings)
  # command: /usr/local/bin/claude   # CLI providers: binary path/name
  # timeouts:                  # CLI providers: harness timer tunables (ms)
  #   hardMs: 900000
  #   inactivityMs: 180000
  #   killGraceMs: 5000
  # providerRouting:           # openrouter only: routing options passthrough
  #   order: ["anthropic"]
  # referer: https://you.example   # openrouter attribution headers
  # title: MergeBrief

# drafts: — the OTHER root block (BRIEF-64): draft-PR generation policy
# (generate: on|off + optional draft regeneration debounceSeconds). Spend
# knobs, read by the web/api process — see self-host/repo-config.md's
# instance-block section for semantics.
# drafts:
#   generate: on
#   debounceSeconds: 900

# x-*: root keys starting with "x-" are ignored (compose-style extension
# slot); ANY other unknown key — root or inside generator:/drafts: —
# refuses boot.
x-notes: anything here is yours
```

How processes find it:

| Surface | Mechanism |
|---|---|
| worker + web | `MERGEBRIEF_CONFIG=/path/to/mergebrief.config.yaml` (env var unset → zero-config default; set-but-empty or unreadable → refuses boot) |
| categorizer CLIs | explicit `--config <path>` only — they never read `MERGEBRIEF_CONFIG` (`pnpm categorize --config ./mergebrief.config.yaml <pr-url>` also doubles as a fast config validator) |

**Path form**: give `MERGEBRIEF_CONFIG` an absolute path. A relative value
currently resolves against the process working directory, which differs per
process (the worker runs from `packages/worker`, the web app from
`apps/web`) — the same value can silently point at different files.
BRIEF-70 changes this to workspace-root anchoring (walk up to the nearest
`pnpm-workspace.yaml`), making `MERGEBRIEF_CONFIG=mergebrief.config.yaml`
mean the repo-root file everywhere, local and dockerized alike — the
docker image is a full workspace checkout, so the anchor holds there too.

> **Packaged distributions (future)**: workspace-root anchoring assumes the
> process runs inside a repo checkout. If MergeBrief ever ships as an
> installed distribution (global npm package, prebuilt binary) running
> outside a checkout, no anchor exists — relative values will refuse boot
> with an explicit message and such deployments must use absolute paths.
> Revisit the resolution rule when that distribution mode becomes real.

Every boot-knowable problem **refuses boot with per-field issues** (values
never echoed): unknown provider, unknown keys, a key env var that is unset,
a CLI that is missing or not logged in. API keys are BYOK-by-env-NAME —
the key value never lives in this file, the DB, or repo config.

## The five providers

| provider | class | auth | effort knob | notes |
|---|---|---|---|---|
| `anthropic` | API | `apiKeyEnv` (default `ANTHROPIC_API_KEY`) | yes | the default; `claude-sonnet-5` = cost knob |
| `openai` | API | `apiKeyEnv` (default `OPENAI_API_KEY`) | discovered at run time (a model without `reasoning_effort` records `effort: null`) | `model` required; `baseUrl` escape hatch for self-hosted compatible servers (preflight downgrades to warnings) |
| `openrouter` | API | `apiKeyEnv` (default `OPENROUTER_API_KEY`) | gated by the model's listed `reasoning` support | full slug required; boot requires the model to list `structured_outputs`; `require_parameters` is forced on every request |
| `claude-code` | **local CLI** | your interactive `claude /login` (OAuth/keychain) | none (`effort: null` — honest gap) | lockdown: `--tools ""`, print mode, no `--bare`; served model verified from `modelUsage` post-run |
| `codex` | **local CLI** | your interactive `codex login` | `model_reasoning_effort` | lockdown: `--sandbox read-only --skip-git-repo-check --ephemeral`; **provenance blind spot**: codex's JSONL carries no model id, so a silent server-side reroute is unobservable — the stamp records what you configured |

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

Isolation per CLI (what a generation run may touch): claude-code runs with
ALL built-in tools disabled and print mode; codex runs read-only sandboxed
with no session persistence. Both run under hard + inactivity watchdogs
with a process-group kill ladder — a hung CLI (or its grandchildren) is
killed, classified, and dumped, never waited on forever.

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

Before releases and after CLI upgrades, run the live smoke:
[`docs/dev/generator-smoke-recipe.md`](../dev/generator-smoke-recipe.md).
