# Harness CLI deployed feasibility (containers, auth persistence, subscription ToS)

**Date:** 2026-07-12
**Purpose:** companion to `harness-cli-capabilities.md`. That note covers invocation/schema/output; this one answers: *can the agent-harness CLI adapters run inside a deployed docker-compose worker?* Decision already locked — adapters are **local-only in v1**; this note records the WHY (for README/docs boundary wording) and the revisit triggers. It blocks nothing.

**Superseded in part:** the subscription-ToS readings below (§1, §2, and the ToS column of the verdict table) predate a fuller primary-source pass and are more pessimistic than the evidence supports — Anthropic's legal page now carries an explicit carve-out for signing in to the unmodified Claude Code binary, and OpenAI publishes a guide for `codex exec` on ChatGPT auth. See `harness-subscription-ban-risk.md` for the current reading. The containerization, auth-persistence, and operational findings here stand.

**Scope note:** "deployed" here means an unattended Linux container (docker-compose worker) invoking the CLI on the user's behalf. Three independent gates per CLI: (a) does auth technically survive containerization, (b) does the vendor's *subscription* ToS permit unattended/server use, (c) is the operational story (install, pinning, upgrades, failure modes) sane. API-key auth is legally uncomplicated everywhere — the interesting question is subscription auth, which is what makes these CLIs cheap enough to be the point.

**Sources (fetched 2026-07-12 unless noted):**

- Claude Code authentication docs: <https://code.claude.com/docs/en/authentication>
- Claude Code dev container docs: <https://code.claude.com/docs/en/devcontainer>
- Claude Code legal & compliance docs: <https://code.claude.com/docs/en/legal-and-compliance>
- Claude Code GitHub Actions docs: <https://code.claude.com/docs/en/github-actions>
- Anthropic Consumer Terms of Service (effective 2025-10-08): <https://www.anthropic.com/legal/consumer-terms>
- Codex auth docs: <https://developers.openai.com/codex/auth> → 308 → <https://learn.chatgpt.com/docs/auth>
- Codex non-interactive docs: <https://developers.openai.com/codex/noninteractive> → 308 → <https://learn.chatgpt.com/docs/non-interactive-mode>
- Codex CLI README + `docs/install.md`: <https://github.com/openai/codex>
- Codex GitHub Action README: <https://github.com/openai/codex-action>
- OpenAI Terms of Use (RoW, effective 2026-01-01): <https://openai.com/policies/row-terms-of-use/> — openai.com 403s non-browser fetchers; text read from a 2026 Wayback Machine snapshot of that URL
- anthropics/claude-code issue #28091 (OAuth-token API rejection reports): <https://github.com/anthropics/claude-code/issues/28091>
- Cursor CLI docs: <https://cursor.com/docs/cli/installation>, <https://cursor.com/docs/cli/reference/authentication>, <https://cursor.com/docs/cli/reference/configuration>, <https://cursor.com/docs/cli/github-actions>
- Cursor Terms of Service (effective 2026-01-13): <https://cursor.com/terms-of-service>
- OpenCode docs: <https://opencode.ai/docs/>, <https://opencode.ai/docs/providers/>

---

## 1. Claude Code (`claude`)

### Containerization / auth persistence

- **Credential locations** (authentication docs): macOS → encrypted macOS Keychain; Linux → `~/.claude/.credentials.json` (mode `0600`); Windows → `%USERPROFILE%\.claude\.credentials.json`. `CLAUDE_CONFIG_DIR` relocates the file on Linux/Windows. Managed via `/login` / `/logout`.
- **Volume mount works and is officially documented.** The dev container docs tell you to mount a named volume at `~/.claude` to persist "authentication token, user settings, and session history" across rebuilds: `"source=claude-code-config,target=/home/node/.claude,type=volume"`. If mounted elsewhere, set `CLAUDE_CONFIG_DIR` to the mount path. (devcontainer docs)
- **macOS → Linux transplant does not exist**: on the host Mac the credential is in the Keychain, not a file, so you can't bind-mount a Mac's credentials into a Linux worker. First login must happen with a Linux-homed `~/.claude` (e.g. `claude /login` run inside the container image once, persisted via the volume) or skip files entirely via a token.
- **Headless login options** (authentication docs): (1) browser login has a paste-code fallback explicitly called out as "common in WSL2, SSH sessions, and containers"; (2) `claude setup-token` mints a **one-year** OAuth token for `CLAUDE_CODE_OAUTH_TOKEN`, documented "for CI pipelines, scripts, or other environments where interactive browser login isn't available" — requires a Pro/Max/Team/Enterprise plan, inference-only scope; (3) `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` env vars; (4) `apiKeyHelper` script for rotating credentials. Note `--bare` mode reads only the API-key paths — not `CLAUDE_CODE_OAUTH_TOKEN` (see companion note §1).
- **Refresh/expiry:** docs document login *lifetime*, not refresh mechanics: logins expire; ≥v2.1.203 warns 5 days ahead at startup; an unattended session that outlives the login "stops making progress once the credential expires and can't recover until you sign in again" (authentication docs). Whether/how the CLI auto-refreshes the short-lived access token within the login lifetime, and whether that rewrite requires the `~/.claude` mount to be writable: UNVERIFIED (implied by the volume-mount guidance, not stated).
- **Official container guidance is first-class**: a Dev Container Feature (`ghcr.io/anthropics/devcontainer-features/claude-code:1.0`), a reference `.devcontainer/` (Dockerfile + egress firewall + persistent volumes) in `anthropics/claude-code`, and Codespaces guidance (store `ANTHROPIC_API_KEY` or a `setup-token` value as a Codespaces secret). (devcontainer docs)

### Subscription ToS

- **Consumer Terms (2025-10-08), §3:** you may not "access the Services through automated or non-human means, whether through a bot, script, or otherwise" — *"except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it"*. §2 bans sharing account credentials or making the account available to anyone else.
- The "otherwise explicitly permit" carve-out is doing the work: Anthropic's own authentication docs describe `setup-token` subscription auth for CI/scripts, i.e. unattended use *of Claude Code itself* on a subscription is vendor-documented.
- **But the legal & compliance page draws two hard lines** (quoted verbatim):
  - "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
  - OAuth authentication "is intended exclusively for purchasers of Claude … subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications", and "Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- **Enforcement is real, not theoretical:** since ~Feb 2026 the raw API rejects `sk-ant-oat01-*` tokens (incl. `setup-token` output) outside official surfaces — `"OAuth authentication is currently not supported."` (user reports, claude-code issue #28091; the tokens continue to work *inside* Claude Code, which is why the CI docs still stand). Enforcement timeline is user-reported, not vendor-documented — treat details as UNVERIFIED.
- **Reading for MergeBrief:** a user running *their own* `claude` binary with *their own* subscription in *their own* self-hosted worker sits between "ordinary, individual usage" and automated service use — a genuine gray zone. What is clearly out: MergeBrief-as-hosted-service routing through users' Pro/Max credentials. API-key auth in a worker is clean under §3's own carve-out.

### Operational story

- **Install/pin:** dev-container feature installs latest; for reproducible images the docs say install from the Dockerfile with `npm install -g @anthropic-ai/claude-code@X.Y.Z` and set `DISABLE_AUTOUPDATER=1` (Claude Code otherwise **auto-updates itself inside the container by default**). (devcontainer docs)
- **Auth mount:** named volume at `/home/<user>/.claude` (or `CLAUDE_CONFIG_DIR`); or no mount at all + `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` env — the env-var route is stateless and compose-friendly.
- **Failure modes:** OAuth login expiry mid-run = documented stall ("stops making progress"); `setup-token` shifts that to a 1-year horizon but it still dies silently at expiry — pair with the `system/api_retry` `authentication_failed` category from the companion note for detection. Keychain is a **macOS-local** problem (cf. docker-builds memory: keychain fails sandboxed/backgrounded) — Linux containers use the plain file and dodge it. Root gotcha: the CLI rejects `--dangerously-skip-permissions` when run as root — the worker image needs a non-root user. (devcontainer docs)

## 2. OpenAI Codex CLI (`codex`)

### Containerization / auth persistence

- **Credential location** (auth docs): `auth.json` under `CODEX_HOME` (default `~/.codex/auth.json`), or OS keyring, per `cli_auth_credentials_store` = `file` | `keyring` | `auto` (default: prefers OS store, **falls back to `auth.json`** — so a keyring-less Linux container degrades to the file automatically). Docs: treat `~/.codex/auth.json` "like a password: it contains access tokens."
- **Volume mount / credential copying is explicitly blessed**: the auth docs list, as supported headless options, `codex login --device-auth` (browser link + one-time code, no localhost callback), **copying `~/.codex/auth.json` from a machine with browser access to the headless machine**, SSH-forwarding the callback port, and `printenv OPENAI_API_KEY | codex login --with-api-key`. Enterprise: `codex login --with-access-token`.
- **Refresh:** ChatGPT tokens "refresh automatically during use"; long-idle credentials can still require re-login (auth docs). Refresh rewrites `auth.json`, so a mounted volume must be writable; the non-interactive docs even describe copying the *refreshed* `auth.json` between CI jobs as a documented advanced pattern.
- **Official CI guidance:** the [Codex GitHub Action](https://github.com/openai/codex-action) installs the CLI, proxies the Responses API to reduce key exposure, and takes a `codex-version` input for pinning. Env auth for one-shot runs: `CODEX_API_KEY=<key> codex exec --json "task"`.

### Subscription ToS

- **OpenAI Terms of Use (RoW, effective 2026-01-01), "What you cannot do":** "Automatically or programmatically extract data or Output"; "Interfere with or disrupt our Services, including circumvent any rate limits or restrictions"; Registration: "You may not share your account credentials or make your account available to anyone else." (Wayback copy of the live URL; openai.com blocks non-browser fetchers.)
- **However, OpenAI's own Codex docs carve out subscription automation explicitly** (non-interactive docs): API keys are "the right default for automation because they are simpler to provision and rotate"; ChatGPT-managed auth in CI is described as an advanced path — "Use this path only if you specifically need to run as your Codex account", intended for "enterprise teams using ChatGPT-managed Codex access on trusted runners", "Do not use this workflow for public or open-source repositories." So headless *subscription* use is vendor-documented, merely discouraged as a default — materially more permissive than Anthropic's posture.
- No Codex-specific clause found in the consumer ToS itself; the governing text is the general restrictions above plus the Codex docs. Whether OpenAI treats a self-hosted always-on worker the same as "CI on trusted runners": not addressed anywhere found — gray, but the documented CI pattern is close kin.

### Operational story

- **Install/pin:** `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, `npm install -g @openai/codex` (pinnable `@X.Y.Z`), or `brew install --cask codex` (README). `docs/install.md` also offers a DotSlash file per GitHub release for commit-pinned versions across a team. **No auto-update mechanism is documented** — version drift is whatever your package manager does (UNVERIFIED whether the binary nags about updates).
- **Auth mount:** volume (or secret-file) at `/root/.codex/auth.json` — or point `CODEX_HOME` at the mount. Stateless alternative: `CODEX_API_KEY` env (API billing).
- **Failure modes:** long-idle subscription creds require interactive re-login — a worker that runs rarely will rot its auth; auth failures surface only as message strings in the JSONL (companion note §2), so detect by pattern, not type. codex-action security warning worth stealing for any worker design: "Do not set `OPENAI_API_KEY` or `CODEX_API_KEY` as a job-level environment variable in workflows that check out or run repository-controlled code."

## 3. Cursor CLI (`cursor-agent`)

### Containerization / auth persistence

- **Credential location: not documented.** Authentication docs say only that after `agent login` "your credentials are securely stored locally". Config (not credentials) lives at `~/.cursor/cli-config.json` (macOS/Linux; `$XDG_CONFIG_HOME/cursor/cli-config.json` on Linux/BSD, `CURSOR_CONFIG_DIR` override) — the configuration docs explicitly do not name a credential path. Exact on-disk auth path: **UNVERIFIED**; consequently whether subscription login survives a volume mount into a container is also **UNVERIFIED**.
- **Headless login:** `NO_OPEN_BROWSER=1 agent login` prints the login URL instead of launching a browser (whether the flow then polls or needs a localhost callback: UNVERIFIED). The documented automation path is **API keys**: `CURSOR_API_KEY` env or `--api-key` flag, "for automation, scripts, or CI environments" (authentication docs).
- **Refresh/expiry:** nothing documented — token lifecycle entirely opaque.
- **Official CI guidance exists** (github-actions docs): install via `curl https://cursor.com/install -fsS | bash` in the job, auth via a `CURSOR_API_KEY` repo secret, run `agent -p "..." --model ...`. Subscription login in CI is not mentioned at all.

### Subscription ToS

- **Cursor ToS (effective 2026-01-13):** no clause addressing automated/headless/CI use either way. Relevant restrictions: no harvesting/scraping/extracting data from the Service; account confidentiality is your responsibility; no rent/lease/lend/sell. Silence ≠ permission, but there is no Anthropic-style "native applications only" line either; and Cursor's own docs recommending API keys for automation implies sanctioned programmatic use via that route.
- Whether API-key usage bills against the subscription pool or separate usage-based pricing: **UNVERIFIED** (not stated in the CLI docs fetched).

### Operational story

- **Install:** `curl https://cursor.com/install -fsS | bash`. Docs are inconsistent on the install dir — installation page says `~/.local/bin`, the GitHub Actions page says add `$HOME/.cursor/bin` to PATH. **Auto-updates by default** ("Cursor CLI will try to auto-update by default"); no documented disable or version pin — in a long-lived container that means silent drift, or a broken self-update if the install dir isn't writable (behavior UNVERIFIED). A `channel` field in `cli-config.json` selects the release channel but isn't a pin.
- **Failure modes:** undocumented credential path + undocumented expiry + unpinnable binary = three unknowns stacked; the only supportable deployed configuration is `CURSOR_API_KEY` env with the binary installed at container start (accepting whatever version ships that day).

## 4. opencode

### Containerization / auth persistence

- **Credential location:** `~/.local/share/opencode/auth.json`, written by `/connect` (providers docs). Plain file — trivially volume-mountable; provider API keys also flow via env vars.
- **Official Docker image exists**: `docker run -it --rm ghcr.io/anomalyco/opencode` (docs intro) — the only one of the four with a vendor-published container image. Auto-update behavior in containers: not documented — UNVERIFIED.

### Subscription ToS — whose terms govern

- opencode is an open-source client multiplexing other vendors' auth, so **the governing ToS is always the upstream provider's**, and the answers differ per provider:
  - **Anthropic: prohibited and removed.** Providers docs, verbatim: "There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this." — "Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0". This is the concrete instance of the Claude Code legal page's "does not permit third-party developers to offer Claude.ai login" clause, enforced early 2026.
  - **OpenAI: works today, blessing unverified.** opencode's docs list ChatGPT Plus (with Copilot, GitLab Duo) as supported "zero setup" subscription logins. No OpenAI primary source found that either permits or bans third-party clients riding ChatGPT/Codex OAuth; the consumer-ToS "programmatically extract data or Output" clause is the applicable text, and community reporting says OpenAI has so far tolerated it. Status: **UNVERIFIED / tolerated-not-sanctioned** — exactly the posture that got the Anthropic route killed.
  - **Provider API keys** (Anthropic console keys, OpenAI platform keys, opencode Zen): uncomplicated, same as any server-side API use.

### Operational story

- **Install/pin:** `curl -fsSL https://opencode.ai/install | bash`, `npm i -g opencode-ai` (pinnable), `brew install anomalyco/tap/opencode`, or the Docker image. Companion-note caveat stands: docs track the `dev` branch; pin and conformance-test.
- **Failure modes:** inherits every upstream failure mode of whichever provider is multiplexed, minus the official CLIs' error surfaces; and its subscription routes live at the pleasure of vendors that have already demonstrated (Anthropic, 2026) they will cut them off without notice.

---

## Feasibility verdict per CLI

| CLI | Auth survives container? | Headless login | Subscription ToS for a deployed worker | API-key mode | Ops (install/pin/update) | Verdict |
|---|---|---|---|---|---|---|
| `claude` | Yes — documented `~/.claude` volume mount (Linux file creds); macOS Keychain creds non-transplantable | `setup-token` (1-yr, subscription, vendor-documented for CI); paste-code login; API-key env | Gray: CI-on-subscription is vendor-documented, but limits "assume ordinary, individual usage" + OAuth is for "native Anthropic applications"; hosted-service routing explicitly banned; enforcement precedent exists | Clean (§3 carve-out) | npm pin + `DISABLE_AUTOUPDATER=1` documented; auto-updates by default | **Feasible, self-host-only, gray on sub auth** — cleanest with API key or user-supplied setup-token |
| `codex` | Yes — `auth.json` copy/mount is a documented pattern; keyring auto-falls-back to file | `--device-auth`; `--with-api-key`; `CODEX_API_KEY` | Most permissive: ChatGPT-managed auth on "trusted runners" documented (discouraged as default); consumer ToS still bans programmatic extraction generally | Clean, recommended default | npm/brew/installer, DotSlash pinning, no auto-updater documented | **Most deployable of the four** |
| `cursor-agent` | UNVERIFIED — credential path undocumented | `CURSOR_API_KEY` only (documented); `NO_OPEN_BROWSER=1` login flow semantics unverified | ToS silent; docs steer automation to API keys | Documented for CI | curl install; auto-updates, **no pin/disable documented** | **API-key-only, and only if version drift is acceptable** |
| `opencode` | Yes — plain-file `auth.json`; official Docker image | `/connect` + API keys; subscription logins per provider | Not its own call: Anthropic sub route **dead** (removed 1.3.0, "Anthropic explicitly prohibits this"); ChatGPT sub route tolerated, unsanctioned | Clean per provider | curl/npm/brew/Docker; dev-branch docs, pin + smoke-test | **Technically easiest, legally inherits the worst of each provider** |

**One-line boundary wording for the README:** harness adapters are local-only in v1 because the thing that makes CLI backends attractive — subscription auth — is at best a documented-but-discouraged path (Codex), at worst explicitly reserved for "ordinary, individual usage of Claude Code" with active enforcement (Anthropic), and undocumented (Cursor) or already revoked once (opencode×Anthropic) elsewhere; deployed workers on API keys are legally fine but erase the cost advantage, so they wait for a real deployed mode decision.

## Revisit triggers

Re-open the deployed-mode question if any of these land:

1. **Anthropic sanctions non-interactive/service use of subscription auth** beyond today's `setup-token`-for-CI: e.g. a workload/service token product, a documented always-on worker story, or the legal page's "ordinary, individual usage" / "native Anthropic applications" language loosening. Conversely: if `setup-token` docs *disappear* or its scope narrows, the local CI-ish uses shrink too — watch <https://code.claude.com/docs/en/legal-and-compliance> on each release.
2. **OpenAI formalizes "Sign in with ChatGPT" for third-party model usage** (long-standing ask — openai/codex issue #10974) or publishes an explicit policy on subscription auth in third-party clients/servers. Either direction (bless or block) changes both the `codex` calculus and opencode's ChatGPT route.
3. **Cursor documents the credential store, token lifecycle, and a version pin** — the three UNVERIFIEDs that currently make it undeployable even with clean ToS.
4. **A vendor blesses or ships a server/container distribution** of its CLI (opencode already has a Docker image; an Anthropic- or OpenAI-published worker image would be a strong sanction signal).
5. **Enforcement events**: any repeat of the Jan–Feb 2026 Anthropic OAuth cutoff (against Codex-in-third-party-clients, or against subscription CI patterns) resets this note's ToS column — re-verify all four before acting on it.
6. **MergeBrief itself grows a hosted arm** (currently ruled out — OSS-only direction): the "on behalf of their users" clause then applies with full force and subscription auth is off the table regardless of the above; deployed mode would be API-key-only by design.
