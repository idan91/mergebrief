# Harness CLI subscription auth: is it a ban risk?

**Date:** 2026-08-26 (all sources fetched this date unless noted)
**Question:** can an operator get their Claude or ChatGPT account suspended
for running MergeBrief's `claude-code` / `codex` generator providers, which
spawn the vendor's own CLI non-interactively against the operator's
subscription login?

**Verdict: no, for the shape we ship.** Both vendors document headless
subscription automation as a product feature, and every enforcement action
found in the record targets tools that replaced the vendor's client or
handled its credentials. MergeBrief does neither. The residual risk is not
enforcement but **revocation**: Anthropic's permission lives in an editable
docs page rather than versioned legal terms, and that page was rewritten
once already in 2026.

Companion notes: `harness-cli-capabilities.md` (invocation/schema/output),
`harness-cli-deployed-feasibility.md` (containers, auth persistence),
`t3code-invocation-comparison.md` (flag-level comparison).

---

## 1. What we actually do

`packages/generators/src/adapters/claudeCode.ts` spawns the installed
`claude` binary per attempt: `-p --output-format stream-json --verbose
--tools "" --model <id> --system-prompt-file <path> --json-schema <json>`,
prompt on stdin. Deliberately **no `--bare`** — bare mode reads only
API-key auth and never touches the keychain, so it would defeat the point
of the adapter.

`adapters/codex.ts` spawns `codex exec --json --sandbox read-only
--skip-git-repo-check --ephemeral --output-schema <path>`.

Properties that decide the answer:

- The binary is **unmodified** and vendor-published. We resolve it from
  `PATH` (or an operator-configured path) and never patch it.
- We **never read, store, forward, or proxy a credential.** The spawn
  inherits the operator's own login. `harness/run.ts` strips credential env
  vars before spawning so an API key cannot silently rebill the run;
  `CLAUDE_CODE_OAUTH_TOKEN` survives on purpose because it *is* the
  subscription route.
- We **never pass `cwd`** (`harness/run.ts:120`), and MergeBrief clones no
  repositories.
- One operator, one login, one machine. Nothing is served on anyone's
  behalf.
- Harness providers are opt-in. The zero-config default is `anthropic` with
  an API key, and the compose worker **refuses** to boot a harness provider
  outright (`config/registry.ts`).

## 2. Anthropic: the clause that permits, and the clause that limits

### Consumer Terms carry the prohibition, and its own escape hatch

<https://www.anthropic.com/legal/consumer-terms>, §3 (US and UK/EEA
variants byte-identical on this bullet; UK variant effective 2025-10-08):

> "Except when you are accessing our Services via an Anthropic API Key **or
> where we otherwise explicitly permit it**, to access the Services through
> automated or non-human means, whether through a bot, script, or
> otherwise."

The second limb is load-bearing. Read without it, this bans Anthropic's own
documented CI flow, which is not a coherent reading. The Usage Policy
(effective 2025-09-15) restricts automation only for account creation and
spam; it has no clause on unattended operation or volume.

### Anthropic explicitly permits it, in three places

<https://code.claude.com/docs/en/authentication>:

> "**For CI pipelines, scripts, or other environments where interactive
> browser login isn't available, generate a one-year OAuth token with
> `claude setup-token`**… This token authenticates with your Claude
> subscription and requires a Pro, Max, Team, or Enterprise plan."

<https://code.claude.com/docs/en/github-actions>:

> "With a `prompt` input, the Claude Code GitHub Action runs in **automation
> mode on any GitHub event, including a cron schedule**."
> "If you authenticate with an OAuth token, **runs use your Claude
> subscription instead of API billing**."

<https://code.claude.com/docs/en/headless> ("Run Claude Code
programmatically") documents `-p` for scripts and CI, and identifies
`--bare` as the *exception* that opts out of subscription auth:

> "**In bare mode, Claude Code never reads OAuth credentials or the system
> keychain.**"

So subscription auth on a non-bare `-p` run is the documented default of a
page whose title is "Run Claude Code programmatically."

Most recent and most direct — <https://support.claude.com/en/articles/15036540>,
banner dated 2026-06-15:

> "For now, nothing has changed: Claude Agent SDK, **`claude -p`**, and
> third-party app usage still draw from your subscription's usage limits."

A category Anthropic designs billing products around is not one it treats as
a terms violation.

### The carve-out names our shape

<https://code.claude.com/docs/en/legal-and-compliance>, "Authentication and
credential use". The prohibitions:

> "Anthropic does not permit third-party developers to offer Claude.ai login
> into their own applications, or to route requests through Free, Pro, or
> Max plan credentials **on behalf of their users**. Moreover, developers may
> not collect, store, or intermediate Claude.ai credentials or session
> tokens — sign-in to a Claude account must complete through Anthropic's own
> flow."

And the exemption, in the same section:

> "**Nor does it prevent an end user from signing in to the unmodified
> Claude Code binary with their own Claude subscription.**"

Every prohibition is conditioned on serving *other people*. None describes
a local tool invoking the operator's own unmodified binary.

### What does limit us

Same page, "Acceptable use":

> "**Advertised usage limits for Pro and Max plans assume ordinary,
> individual usage of Claude Code and the Agent SDK.**"

Undefined, and paired in the adjacent section with "Anthropic reserves the
right to take measures to enforce these restrictions and may do so without
prior notice." This is volume-keyed, not automation-keyed. It caveats what
the *limits* promise rather than what use is permitted.

## 3. OpenAI: no automated-access clause at all

Terms of Use (effective 2026-01-01; EU/UK variant updated 2026-01-16). The
complete "What you cannot do" list contains exactly one automation-shaped
bullet:

> "Automatically or programmatically extract data or Output"

It sits between a reverse-engineering ban and a "represent Output as
human-generated" ban, under a heading about illegal, harmful, or abusive
activity — scraping-shaped. Read literally it would prohibit OpenAI's own
documented `codex exec --json | jq`. Note the Business Terms use the
narrower "extract data from the Services **other than as permitted through
the Services**" (§3.3(f)), which shows what the drafters mean by "extract".

There is no bot, script, crawler, or automated-access clause anywhere in the
consumer terms. The Usage Policies (effective 2025-10-29) are content rules
only, with no clause on programmatic use.

`codex exec` is documented for exactly our use
(<https://developers.openai.com/codex/noninteractive>):

> "Non-interactive mode lets you run Codex from scripts (for example,
> continuous integration (CI) jobs) without opening the interactive TUI. You
> invoke it with `codex exec`."

OpenAI publishes a dedicated guide for running it on ChatGPT-managed auth
(<https://developers.openai.com/codex/auth/ci-cd-auth>), naming as intended
audience "users who need ChatGPT/Codex rate limits instead of API key
usage". Its example workflow runs `codex exec --json`. The pricing page's
feature table lists "Codex SDK, `codex exec`, and scriptable workflows" with
no unavailability marker on Plus or Pro.

OpenAI does steer automation toward API keys — "API keys are the right
default for automation because they are simpler to provision and rotate" —
but the stated reason is credential rotation and blast radius, not
entitlement.

**One line here gets misread.** "Do not use this workflow for public or
open-source repositories" appears twice, both times inside a paragraph about
`auth.json` being a password. It is a rule about not seeding your credential
onto a runner that executes untrusted repository code. It is not a
restriction on open-source tools invoking Codex. An operator running the CLI
on their own machine against their own `auth.json` engages none of the CI
conditions it describes.

Documented deactivation triggers (help article 10562188, updated 2026-08-25):
Usage Policy content violations, circumventing security or access
restrictions, credential sharing, harm or disruption, repeated violations,
failed identity verification. Automation, scripting, wrappers, and volume
appear nowhere.

## 4. Enforcement: what actually happened, and to whom

No first-party or corroborated report exists of headless or programmatic use
*alone* triggering enforcement. Every real action sorts on one axis, and it
is not interactive-versus-headless.

| Product | Credential handling | Client | Outcome |
| --- | --- | --- | --- |
| OpenCode | Bundled its own OAuth plugin | Reimplemented; copied Claude Code's system prompt verbatim; **suppressed its own User-Agent** for the Anthropic provider | Anthropic Legal demanded removal; plugin deleted 2026-03-19 |
| Roo Code | Own `claude-code/oauth.ts` | Reimplemented | Removed at Anthropic's request, Jan 2026 |
| Kilo Code | Own integration | Reimplemented | Deprecated Jan 2026 |
| t3code | Inherits keychain login | **Unmodified `claude`** (Agent SDK for chat, raw `-p` for one-shots) | No action. Still shipping |
| MergeBrief | Inherits keychain login, strips credential env vars | **Unmodified `claude`**, `--tools ""` | — |

The discriminator, from an Anthropic engineer explaining why third-party
harnesses are prohibited (The Register, 2026-02-20):

> "They generate unusual traffic patterns **without any of the usual
> telemetry that the Claude Code harness provides**."

Everything in the top half replaced the harness. Everything in the bottom
half runs it, and therefore emits the telemetry that sentence asks for.

Also untouched and visible: Conductor (commercial), Zed via
claude-agent-acp, Claude Squad, happy-coder, CloudCLI, OpenClaw. The
industry's public posture is inconsistent — Cline ships a Claude Code
provider advertising subscription billing with no warning, while Warp's docs
state flatly that Anthropic and OpenAI do not allow subscription plans in
third-party clients.

### The rate-limit and harness episodes were billing, not bans

- **2025-07-28**: weekly rate limits announced. Anthropic's stated causes
  were Claude Code running "continuously in the background, 24/7" and users
  "sharing accounts and reselling access". The action was rate limiting.
  Nobody was suspended.
- **2026-01 → 2026-06**: subscription OAuth tokens began failing outside
  official surfaces; third-party harness coverage was withdrawn (2026-04-04,
  with a month's credit), reinstated (2026-05-13), then the metering change
  was paused (2026-06-15). Auth and billing plumbing throughout, reversed
  twice.
- The one high-profile account action in this window (OpenClaw's author,
  2026-04-10) was reversed within hours, and an Anthropic engineer stated
  publicly that "Anthropic has never banned anyone for using OpenClaw."

### The folklore has a traceable origin

<https://github.com/anthropics/claude-code/issues/36324> ("headless mode
documentation does not warn it should not be used from scripts when using a
subscription account") is a user *inferring* ban risk from the Consumer
Terms text. It reports no
incident, names no affected account, and cites no policy change. Anthropic
never replied; it was auto-closed as stale. Downstream repetition of "you
can be banned for headless mode" traces back to this reading, not to an
enforcement event.

The one documented real-world failure of orchestrated `-p` is a **bill**:
<https://github.com/anthropics/claude-code/issues/57719> reports $313 spent
in 8.5 hours with no client-side spend cap.

## 5. On adopting t3code's approach

Nothing to adopt.

t3code has two Claude paths. Interactive sessions use
`@anthropic-ai/claude-agent-sdk`; one-shot structured generation (commit
messages, PR bodies, titles) spawns `claude -p --output-format json
--json-schema` per call. Our workload is only the second kind, and t3code —
with the SDK already wired for their chat product — chose raw `-p` for it
too.

Switching our adapter to the Agent SDK would gain nothing and cost
something:

- **Same wire.** The SDK spawns the same binary on the same keychain OAuth.
  No ToS ground is gained.
- **Worse paperwork.** The SDK docs carry an unqualified note that Anthropic
  "does not allow third party developers to offer claude.ai login or rate
  limits for their products, including agents built on the Claude Agent
  SDK", and place SDK use under the **Commercial** Terms. The carve-out we
  rely on is written around the Claude Code binary, not the SDK. The swap
  would trade a named exemption for a prohibition-shaped note.
- **Wrong tool.** The SDK exists for multi-turn sessions. We generate
  one-shots.
- **Lost machinery.** Our harness owns process-group kill ladders, hard and
  inactivity watchdogs, and output caps that t3code's single 180 s timeout
  does not have. Those exist because unattended runs hang.

t3code is MIT licensed, so copying would be permitted. It is moot: their
one-shot path is our path, and on credential handling and tool lockdown we
are the stricter implementation.

Worth knowing rather than relying on: t3code's author reported "a small
number of reports of Anthropic banning T3 Code users without warning"
(2026-04-18), adding that his Anthropic contacts believed this was in error.
Across the first-hand reports collected, the recurring trigger was a **plan
upgrade**, and at least two reporters had never used a third-party tool. No
Anthropic statement attributes any ban to third-party tool use. His earlier
"confirmed safe for Claude subs" claim rests on an unreadable screenshot of
what appears to be a mass subscriber email, not a tool-specific letter — do
not lean on it in either direction.

## 6. Residual risk, ranked

1. **Revocation, not enforcement.** The permission is a docs page Anthropic
   can edit without a version bump. The February 2026 text of the
   legal-and-compliance page banned end users outright ("Using OAuth tokens
   obtained through Claude Free, Pro, or Max accounts in any other product,
   tool, or service … is not permitted"); the current unmodified-binary
   carve-out replaced it and is only months old. Consumer Terms §3's
   "where we otherwise explicitly permit it" means the permission can be
   withdrawn by editing documentation.
2. **Volume.** "Ordinary, individual usage" is undefined and is the only
   clause that plausibly bites us. The documented failure mode is a bill,
   not a ban: there is no client-side spend cap on `-p`.
3. **Unreconciled terms.** The Agent SDK docs place SDK use under Commercial
   Terms; the Claude Code legal page places Pro/Max Claude Code under
   Consumer Terms; `claude -p` is documented as the Agent SDK via the CLI.
   No primary source resolves which governs it. Not resolvable from outside.
4. **Account responsibility.** "You are responsible for all activity
   occurring under your Account" is independent of the automation question.
   Whatever a tool does autonomously is attributed to the operator.

## 7. The safe shape

Derived from the carve-outs, and what our docs tell operators:

- Spawn the **unmodified**, vendor-published binary.
- Never read, store, forward, or proxy a credential; let sign-in complete
  through the vendor's own flow.
- One operator, one login, one machine. Never share `~/.codex/auth.json` or
  a Claude login, and never run generations on another person's behalf.
- Do not present the product as, or name it after, the vendor's client, and
  do not imply endorsement.
- Keep volume within what an individual plan's advertised limits
  contemplate; disable extra-usage roll-over if you want quota exhaustion to
  be a loud failure instead of a charge.

Anything hosted — MergeBrief-as-a-service routing generations through
subscriber credentials — is squarely prohibited and is not on the table.

## 8. Revisit triggers

Re-run this note if any of these change:

- The Claude Code legal-and-compliance page loses or narrows the "unmodified
  Claude Code binary" carve-out, or the Consumer Terms drop the "where we
  otherwise explicitly permit it" limb.
- `claude setup-token`, the subscription OAuth option in the Claude Code
  GitHub Action, or `codex exec` on ChatGPT auth is withdrawn or restricted.
- Anthropic revives the paused Agent SDK credit plan, which would move
  `claude -p` off subscription limits onto a separate allowance.
- A credible, corroborated report appears of enforcement against a tool that
  spawns an unmodified vendor binary without handling credentials — the
  first such report would break the pattern this note rests on.
- MergeBrief starts reading repository checkouts. A non-bare `-p` run
  executes hooks from `.claude/settings.json` and connects `.mcp.json`
  servers found in its working directory; generation spawns in an empty
  temp `cwd` and clones nothing, so this is inert today and becomes live the moment generation
  runs against a checkout.
- MergeBrief acquires a hosted mode, or any path where one credential serves
  more than its owner.
