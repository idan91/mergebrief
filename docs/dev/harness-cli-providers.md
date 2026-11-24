# Subscription CLI providers: contributor notes

The `claude-code`, `codex` and `cursor` providers run a vendor CLI as a child process on your own machine, under your interactive login. Self-hosters only need [the user-facing summary](../self-host/generators.md#subscription-cli-providers). This page holds what a contributor or a host-process operator needs: why they stay out of the image, how each CLI is held in, what billing they reach, and how to smoke-test an adapter by hand.

## Why they never run in the image

A container never sees your installed CLI or your login, wherever it runs, so the boundary is host process versus container, not local versus remote. The image bakes `MERGEBRIEF_RUNTIME=compose-worker`, and a CLI provider under that marker refuses boot with a targeted message instead of a missing-binary error. One config file can feed both runtimes, so a `provider: codex` switch made for your local loop would otherwise take down the compose worker.

To run a CLI provider locally beside a compose worker, give the worker its own config: a worker-only `environment:` entry in `docker-compose.override.yml` pointing `MERGEBRIEF_CONFIG` at a separate file, with its own mount. An empty YAML file is a valid zero-config choice and gets the `anthropic` default. The `MERGEBRIEF_CONFIG` in `.env` reaches only host processes, since compose sets its own for the containers.

Deployed workers on API keys would work, but they erase the cost advantage that is the point of these providers.

## Terms of service

Checked on 2026-08-26: running the vendor's own CLI non-interactively against your own subscription, on your own machine, is documented by both vendors as a supported use, and every enforcement action on record targeted tools that reimplemented the vendor's client or handled its OAuth tokens. MergeBrief spawns the unmodified binary and never touches a credential.

Two caveats an operator owns. Anthropic's permission lives in a documentation page rather than versioned legal terms, so it can narrow without notice. And "advertised usage limits … assume ordinary, individual usage", which is undefined and volume-keyed. The safe shape is one operator, one login, one machine, no shared credential and no generation run on anyone else's behalf.

## Isolation per CLI

Every CLI run, startup checks included, starts in a fresh empty directory under `~/.cache/mergebrief/harness`, removed after the run, so it never sees the directory you launched from. The base sits in your home rather than the shared temp dir because claude reads `CLAUDE.md` from every parent of its working directory, and on Linux any local user can write to `/tmp`.

- **claude-code:** every built-in tool off, print mode, no session persistence, `--setting-sources ""`, `--strict-mcp-config` and `--disable-slash-commands`, so your user-level settings, hooks, plugins, MCP servers and skills under `~/.claude` stay out. Print mode alone does not stop a non-bare `claude -p` run from executing hooks and connecting MCP servers; the flags do.
- **codex:** `--skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules`, its hooks feature off, shell, hosted web search, browser, computer-use, image, plugin and sub-agent tools off, under a permission profile that reads only codex's minimal system paths, its install folders and the empty working folder (not your home, not the `auth.json` in `CODEX_HOME`), with no network. Auth still reads `CODEX_HOME`.
- **cursor:** `--mode plan` (a bare print-mode run applies file writes). cursor-agent has no switch to skip user config, so its config under `~/.cursor` applies, MCP servers included. MergeBrief writes a deny-all `.cursor/cli.json` into the empty working folder for every run; in testing it refused every shell command, file read and web fetch cursor tried. It also denies MCP calls, which is untested, and cursor enforces the file itself, not the operating system. The CLI keeps session state under `~/.cursor` between runs, and on macOS a `CURSOR_API_KEY` from the environment is written to the keychain.

Every CLI runs under hard and inactivity watchdogs with a process-group kill ladder: a hung CLI, or its grandchildren, is killed, classified and dumped.

## Environment a CLI receives

A CLI starts with an allowlisted environment, never the worker's. None of these does anything under compose.

| Variable | CLI | What it does |
| --- | --- | --- |
| `PATH`, `HOME`, `USER`, `TMPDIR`, `LANG`, `LC_*` | all | Process basics and locale. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, their lowercase forms, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` | all | Proxy and CA settings, passed through. |
| `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR` | `claude-code` | Its login token and config folder. claude also gets `DISABLE_AUTOUPDATER=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. |
| `CODEX_HOME` | `codex` | The folder holding its login. |
| `CURSOR_API_KEY` | `cursor` | Outranks `cursor-agent login` and bills the same subscription pool. On macOS the CLI persists it to the keychain. |
| `CURSOR_CONFIG_DIR`, `XDG_CONFIG_HOME` | `cursor` | Its config folder. |

Everything else the worker holds (`DATABASE_URL`, the App key, `SESSION_KEY_V1`, other provider keys) stays out. That also keeps billing on the subscription: `ANTHROPIC_API_KEY` or `CODEX_API_KEY` sit above the interactive login in each CLI's auth precedence and would rebill every generation to an API account.

## Billing

- **An `apiKeyHelper` in the CLI's own settings file still outranks OAuth.** The environment cannot reach it; remove it if you have one. At startup the worker reads `claude auth status` and refuses to start if the active route is an API key, including a settings-file `apiKeyHelper`. Output too old to carry the route fields gives an "unverifiable" warning instead.
- **Version floors.** An older CLI can silently ignore the flags above, so the worker refuses to start below claude 2.1.307, codex 0.163.0 or cursor-agent 2026.10.19, naming both versions. A newer release starts with a warning, because built-in tools it added are unchecked. A `--version` with no readable version also starts with a warning.
- **A stray `CLAUDE_CODE_OAUTH_TOKEN` in your shell startup files** attaches to every headless run. If attribution looks wrong, check `grep -r CLAUDE_CODE_OAUTH_TOKEN ~/.zshenv ~/.zshrc ~/.profile`.
- **Never override `HOME` to isolate the CLI.** On macOS the OAuth credentials live in the keychain, tied to your real home. Use `CLAUDE_CONFIG_DIR`.
- **Subscription billing holds only within plan quota.** Headless runs roll into paid extra usage when that toggle is on, with no prompt. Turn extra usage off in your account's billing settings if quota exhaustion should be an error instead of a bill. One publicly reported `claude -p` workload spent $313 in 8.5 hours before anyone noticed.
- **Scale.** Per-PR generation fits a Pro or Max window; the eval suite (about 60 generations per full run) does not fit a Pro plan.

### Attribution

Older `claude` CLI versions (around 2.1.207) misattributed headless subscription runs to the linked Console account's prepaid API credits. At CLI 2.1.226 (2026-08-08), bare `-p`, the exact harness invocation and the `claude setup-token` route all billed the subscription, with extra usage off and the Console balance unmoved. No changelog mentions the fix, so re-verify after a CLI upgrade if attribution matters:

1. Note your Console prepaid balance and turn extra usage off.
2. Run one generation (`pnpm -C tools/categorizer categorize --config ../../mergebrief.config.yaml <pr-url>`).
3. Wait a few minutes for attribution to settle.
4. Confirm the balance did not move and the run shows on your claude.ai usage page.

That check ran well below plan quota, so near-limit behaviour is untested. The envelope's `total_cost_usd` is a notional token price and cannot tell you which account paid.

## Peak memory per slot

A CLI provider holds one child process per worker slot for the length of a generation, so size the host for `slots x child RSS + worker baseline`. Measure the peak around a real generation with `/usr/bin/time -l` (macOS) or `/usr/bin/time -v` (Linux) wrapped around `pnpm -C tools/categorizer categorize --config ../../mergebrief.config.yaml <pr-url>`; a one-word prompt measures the idle floor, not the peak. None of the three is measured yet.

## Check a config without spending a webhook

```sh
pnpm -C tools/categorizer categorize --config ../../mergebrief.config.yaml <pr-url>
```

It boots the same generator the worker would and fails fast on the same checks. The path is relative to `tools/categorizer`. The categorizer CLIs never read `MERGEBRIEF_CONFIG`; they take `--config` only.

## When the claude-code login stops authenticating

Fall back to the `anthropic` provider with an API key. In `mergebrief.config.yaml`, set `generator.provider: anthropic`, remove `command:` and `timeouts:` (that provider refuses them at boot), and check that `model:` is an API model id or absent. Put the key in `ANTHROPIC_API_KEY`, or the variable `apiKeyEnv` names, and restart the worker.

## Live smoke of an adapter

One real `generate()` against a real provider or CLI, run by hand from a checkout. Never wire it into vitest or CI: it spends money and needs live auth (keychains, `auth.json`, API keys) a CI runner lacks. The suites in `packages/generators/test/` hold the adapters' logic against shims; the smoke covers what they cannot: envelope fidelity after a CLI upgrade, real auth, real provider schema enforcement and retry limits, and the kill ladder against a real process tree.

Run it after a CLI version upgrade, after touching an adapter's transport, envelope or classification, and once over every adapter before a release.

```sh
# API adapters (need the key variable set):
pnpm -C packages/generators smoke -- --adapter anthropic
pnpm -C packages/generators smoke -- --adapter openai --model gpt-6.1-sol
pnpm -C packages/generators smoke -- --adapter openrouter --model anthropic/claude-sonnet-5.5

# CLI adapters (need the CLI logged in on this machine):
pnpm -C packages/generators smoke -- --adapter claude-code
pnpm -C packages/generators smoke -- --adapter codex
pnpm -C packages/generators smoke -- --adapter cursor   # cursor-agent login, or CURSOR_API_KEY

# Validate and smoke an instance config (paths resolve from packages/generators):
pnpm -C packages/generators smoke -- --config ../../mergebrief.config.yaml
```

Exit 0 means schema-valid output came back. On each run check:

1. The startup check passed, with no "boot refused". For a CLI that proves `--version` and the auth preflight against the real binary.
2. The origin line names the provider, model and effort you expected: `effort: null` where the knob does not exist (`claude-code`, models without `reasoning`), and `codex-default` when codex runs its configured default.
3. The output printed and is schema-valid, with enum tags only from the closed vocabulary.
4. Any `warning:` lines are explainable (a served-model mismatch, an effort-knob gap). These are the lines that reach a brief as `generationWarnings`.

### Kill a hung run

The watchdog, the kill ladder and the stderr redaction are tested against shims (`harness.test.ts` in `packages/generators`). Check a real process tree by hand after changing that path:

1. Start a smoke run against a CLI adapter, and mid-run put the CLI's backend out of reach: drop the network, or `kill -STOP` the CLI process.
2. Expect the inactivity watchdog to fire, 3 minutes by default; set `timeouts.inactivityMs` lower in a scratch config for a faster check. cursor's stream is silent until exit, so its watchdog defaults to the 15-minute `hardMs` unless you set `inactivityMs`. The run exits nonzero with a `timeout`-kind message carrying a redacted stderr tail, and `pgrep -f claude`, `pgrep -f codex` or `pgrep -f cursor-agent` finds nothing.
3. `kill -CONT` if you used `SIGSTOP`, and clean up.
