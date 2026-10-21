# Agent credential and tool-access exposure

**Status:** research complete  
**Date:** 2026-08-14  
**Scope:** OpenAI API, Anthropic API, local Codex, local Claude Code, MCP, and
T3 Code comparison

## Conclusion

There is a real credential-disclosure risk, but it is not best described as
"the model automatically receives the API key." In a plain API request, the
provider credential is an HTTP authentication header while model input is a
separate request field. The credential becomes model-visible only if the
application copies it into input, a readable file or environment variable is
returned by a local tool, or an integration returns it in tool output. OpenAI
documents API keys as bearer headers and the Responses `input` separately;
Anthropic documents its API key/token as request headers and Claude Code as
sending prompts and outputs to the model service. This separation is therefore
an architectural inference, not a promise that providers never process the
authentication header as part of operating their service.
([OpenAI authentication](https://platform.openai.com/docs/api-reference/authentication),
[OpenAI function-call flow](https://developers.openai.com/api/docs/guides/function-calling),
[Anthropic Claude Code authentication](https://code.claude.com/docs/en/authentication),
[Anthropic Claude Code data flow](https://code.claude.com/docs/en/data-usage))

The material risk is the **agent runtime**, not the inference endpoint alone.
Local Codex and Claude Code can read files, run commands, and use MCP tools with
the host user's authority. Command output and tool results are fed back to the
hosted model, so disabling a command's outbound network does not prevent a
secret in stdout or stderr from reaching the model provider. OpenAI's local
shell documentation explicitly requires the client to capture stdout/stderr
and return it as `shell_call_output`; Anthropic's tool-use flow likewise has the
client execute a tool and return a `tool_result` to Claude.
([OpenAI shell](https://developers.openai.com/api/docs/guides/tools-shell),
[Anthropic tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview))

For MergeBrief specifically, this is a **priority-now issue** for the Codex CLI
adapter. It passes almost the entire host environment to Codex, strips only a
short billing/authentication list, and then allows Codex's shell in a read-only
sandbox. Current Codex defaults do not automatically filter variables whose
names contain `KEY`, `SECRET`, or `TOKEN`. Unrelated AWS, GitHub, npm, database,
session, signing, or internal service credentials can therefore become shell
output and model context. Untrusted PR text provides a plausible prompt-
injection path. The Claude Code adapter has a smaller model-facing surface
because it supplies `--tools ""`, but its non-interactive invocation should
also be isolated from user/project MCP startup and settings.

## Risk by surface

| Surface | What the model can see | Credential exposure risk | Assessment |
| --- | --- | --- | --- |
| Plain OpenAI or Anthropic API request | Request input/messages, tool definitions, prior outputs, and any tool results the application sends | The API auth key is a transport credential, not an ordinary prompt field. Exposure occurs if application code logs/copies it, returns it from a tool, or sends secret-bearing files/output | **Low by default; application-controlled** |
| Local Codex CLI/app | Prompts, files the runtime reads, shell stdout/stderr, MCP resources/results, and other enabled tool results | Shell environment and readable files may contain unrelated credentials; MCP widens reachable data/actions; prompt injection can induce reads | **Medium to high without a minimal environment and tool isolation** |
| Local Claude Code | Prompts, files/IDE context, Bash output, MCP resources/results, and enabled tool results | Read-only commands include `cat` and other file readers; broader reads, Bash, MCP, and bypass modes increase authority. Non-interactive `-p` disables trust verification | **Medium without sandbox/deny rules; high with bypass permissions or untrusted MCP** |
| MCP or connector | Tool names/descriptions/instructions, selected resources, arguments, and results; the server receives its configured authorization | A malicious or over-privileged server can access or return sensitive data, inject instructions, or perform actions. A local stdio server is code running with local privileges | **Authority multiplier; treat each server as a security principal** |

## What local agents can access

### Codex

Codex uses an OS-enforced sandbox locally. Its default agent setup disables
network access and limits writes, but `workspace-write` can still read and run
commands in the workspace; `read-only` is explicitly a mode for reading files
and answering questions. These controls reduce mutation and direct network
exfiltration, but they do not make readable content safe to return to the
model. OpenAI also warns that prompt injection can cause an agent to follow
instructions in untrusted web content.
([Codex approvals and sandboxing](https://learn.chatgpt.com/docs/agent-approvals-security))

Codex has a dedicated `shell_environment_policy`. OpenAI recommends starting
with `inherit = "none"` or the trimmed `inherit = "core"`, adding explicit
values and filters, and avoiding unnecessary secrets. Critically,
`ignore_default_excludes` currently defaults to `true`, meaning variables with
names containing `KEY`, `SECRET`, or `TOKEN` are kept unless the operator opts
into filtering. OpenAI also recommends `allow_login_shell = false` as a
hardening option.
([Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy),
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference))

Codex MCP configuration is shared by the desktop app, CLI, and IDE extension.
Local stdio servers receive configured environment variables; remote servers
can receive bearer/OAuth credentials; server initialization instructions are
placed alongside tool guidance. Codex supports server/tool allowlists and
per-tool approval modes, but merely selecting a read-only shell sandbox does
not remove MCP authority.
([Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli))

Cloud Codex has a materially different boundary: setup can receive configured
secrets, while OpenAI says those secrets are removed before the agent phase;
the agent then runs in an isolated container, offline by default. That guarantee
does not apply to a locally spawned CLI process inheriting the user's host
environment.
([Codex approvals and sandboxing](https://learn.chatgpt.com/docs/agent-approvals-security))

### Claude Code

Claude Code defaults to read-only permissions, but Anthropic's built-in
read-only command set includes `cat`, `head`, `tail`, `grep`, `find`, and
read-only Git commands. Those commands can run without a prompt. File-tool
`Read` deny rules help, but Anthropic notes that they do not constrain arbitrary
Python/Node subprocesses; OS-level enforcement requires enabling the sandbox.
Anthropic provides `denyRead` and project-specific permission controls for
sensitive repositories.
([Claude Code security](https://code.claude.com/docs/en/security),
[Claude Code permissions](https://code.claude.com/docs/en/permissions))

Claude Code stores its own login in macOS Keychain, or in a user-only
credentials file on Linux (`0600`) and under the Windows user profile. This is
better than putting the login token in a repository, but it does not protect
unrelated credentials that a permitted Bash command or readable file can
reach. Environment credentials such as `ANTHROPIC_AUTH_TOKEN` and
`ANTHROPIC_API_KEY` take precedence over other login routes; short-lived or
dynamic credentials via a helper reduce static-secret exposure.
([Claude Code authentication](https://code.claude.com/docs/en/authentication))

Anthropic explicitly warns that prompt injection remains possible and
recommends reviewing commands, avoiding direct pipes of untrusted content, and
using a VM for scripts and external tool calls. Trust verification is disabled
for non-interactive `-p` runs. More specifically, Anthropic documents that
project `.mcp.json` servers are connected without asking in non-interactive
runs when project settings are enabled, and recommends `--setting-sources
user` or `--bare` before running `claude -p` in a repository the operator did
not write.
([Claude Code security](https://code.claude.com/docs/en/security),
[Claude Code permissions and non-interactive trust](https://code.claude.com/docs/en/permissions))

## MCP trust boundary

MCP does not make a credential visible to the language model merely because it
exists. The host/client may attach a bearer token or OAuth credential to the
server transport without placing the raw value in normal model content.
However, MCP deliberately gives the model access to server-provided tools,
resources, prompts, and results, and gives the server access to whatever data
is sent in calls. OpenAI warns that a malicious MCP server can exfiltrate
anything that enters model context and recommends `allowed_tools` plus approval
for sensitive actions. Anthropic says servers that fetch external content can
introduce prompt injection and does not security-audit or manage every MCP
server.
([OpenAI MCP risks](https://developers.openai.com/api/docs/guides/tools-connectors-mcp#risks-and-safety),
[Anthropic MCP](https://code.claude.com/docs/en/mcp),
[Anthropic security](https://code.claude.com/docs/en/security))

The protocol itself treats tool descriptions/annotations as untrusted unless
they come from a trusted server and calls for explicit consent before tool
invocation. Its security guidance says local MCP servers should run with
minimal privileges and restricted filesystem/network access. It also forbids
token passthrough, requires audience validation, recommends short-lived access
tokens, and calls out confused-deputy, SSRF, prompt-injection, token-theft, and
over-broad-scope risks.
([MCP specification security principles](https://modelcontextprotocol.io/specification/2025-11-25),
[MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices),
[MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization))

Practical consequences:

- A local stdio MCP server is an executable dependency, not a passive schema.
  Treat adding one like installing and running code.
- A remote MCP server is both a data recipient and an instruction/tool source.
  Its retention, logging, compromise, and prompt-injection properties are
  outside the model provider's boundary.
- Read-only annotations and tool descriptions are hints supplied by the
  server, not a sufficient authorization boundary. Keep host-enforced
  allowlists and approvals.
- Give each server the smallest possible OAuth scopes and use distinct,
  audience-bound credentials. Never place static bearer values in checked-in
  `.mcp.json`, `config.toml`, or command arguments.

## Retention, logging, and training

Exposure to the model provider is still consequential even if no attacker
receives the secret immediately:

- OpenAI does not train on API inputs/outputs by default. Standard API abuse-
  monitoring logs may retain customer content for up to 30 days. The Responses
  API has application-state retention for 30 days by default; Zero Data
  Retention and Modified Abuse Monitoring are eligibility-based controls, and
  third-party MCP servers have their own retention policies.
  ([OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint))
- For individual ChatGPT/Codex plans, content may be used for model improvement
  unless the user opts out; Codex full-environment sharing has a separate
  control. Business, Enterprise, Edu, and API content is not used for training
  by default.
  ([OpenAI data use](https://help.openai.com/en/articles/5722486-api-data-usage-policies),
  [Codex plan data controls](https://help.openai.com/en/articles/11369540))
- Anthropic commercial/API traffic is not used to train generative models
  unless the customer opts in. Standard commercial API input/output retention
  is 30 days, with contractual ZDR available to eligible organizations and
  exceptions for safety or legal requirements.
  ([Anthropic commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data),
  [Anthropic ZDR](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to))
- Claude Code consumer retention is 30 days when model improvement is disabled
  and five years when it is enabled. Commercial retention is normally 30 days.
  Local session transcripts are plaintext under `~/.claude/projects/` for 30
  days by default. Explicit feedback can upload transcripts/code and has longer
  retention; normal metrics exclude code/prompts/file paths and error reports
  redact known secret patterns, but pattern redaction is not a substitute for
  avoiding exposure.
  ([Claude Code data usage](https://code.claude.com/docs/en/data-usage))

No retention policy turns a live credential disclosure into an acceptable
event. A disclosed token should be revoked or rotated immediately.

## MergeBrief implementation audit

### Existing protections

- API adapters resolve the configured key for SDK authentication; no evidence
  was found that they add the key to generation prompts.
- The harness spawns argv directly rather than through a shell, caps output,
  redacts provider/CLI error text, and strips a defined set of provider billing
  credentials before both generation and startup checks.
- Claude Code generation supplies `--tools ""`, which prevents the model from
  invoking built-in tools during the structured-generation task.
- Codex uses `--sandbox read-only`, `--ephemeral`, and a strict output schema,
  reducing mutation and persistence.

Relevant code:
[harness spawn](../../../packages/generators/src/harness/run.ts#L108-L123),
[credential strip list](../../../packages/generators/src/harness/run.ts#L379-L416),
[Claude Code lockdown](../../../packages/generators/src/adapters/claudeCode.ts#L190-L220),
[Codex lockdown](../../../packages/generators/src/adapters/codex.ts#L120-L159).

### Priority-now finding: Codex inherits unrelated host secrets

`envForSpawn` starts from `process.env` and removes only these names:
Anthropic auth/base URL, Anthropic Bedrock/Vertex switches, Codex/OpenAI auth,
and OpenRouter auth. Every other string-valued variable is passed to the Codex
process. The adapter does not override Codex's `shell_environment_policy`, does
not disable login-shell semantics, and does not isolate user MCP configuration.

`read-only` prevents writes; it does not prevent the shell from reading its
inherited environment or returning output. Codex's documented default keeps
`*KEY*`, `*SECRET*`, and `*TOKEN*` variable names. The model can therefore cause
a command to reveal a credential to the OpenAI model endpoint. No separate
network request from the command is necessary. Prompt injection in PR titles,
descriptions, comments, diffs, filenames, or repository instructions can be
the trigger; the generation prompt already treats externally sourced PR
material as data but model safeguards are not an enforcement boundary.

Examples of credential classes not covered by the current denylist include
cloud-provider credentials, `GITHUB_TOKEN`, package-registry tokens,
`MERGEBRIEF_TOKEN`, database connection strings, signing/session secrets, and
arbitrarily named internal credentials. This list is illustrative only; a
larger denylist will remain incomplete.

**Severity:** high confidentiality impact when a developer launches the local
Codex adapter from a credential-rich shell; exploitability depends on a model
following malicious content, but the attack path crosses an untrusted-content
boundary and does not require filesystem writes or command egress.

### Secondary finding: ambient MCP/settings are outside the intended generator contract

The generator contract needs `(schema, system, user) -> structured object`.
Neither CLI adapter needs repository tools, user MCP tools, plugins, hooks, or
project instructions to fulfill it.

The Claude adapter removes built-in tools, which materially lowers the risk,
but Anthropic documents that `--tools ""` does not remove MCP tools. The adapter
also uses non-interactive `-p` without `--safe-mode`, `--bare`, an MCP deny rule,
or a user-only settings source. Anthropic documents that `-p` disables trust
verification and may connect project `.mcp.json` servers without asking. In
this application's normal flow the current repository is MergeBrief rather
than the externally reviewed repository, which reduces exposure to a hostile
target repository, but ambient local settings and executable MCP startup
remain unnecessary authority.

A value-free local inventory on 2026-08-14 found four user-scoped Claude MCP
servers plus user-scoped hooks and plugins. No repo-scoped `.mcp.json` or
`.codex/config.toml` was present. This makes the Claude MCP path active on the
development machine today, while the repo-scoped path remains a future risk.

The Codex adapter does not disable configured MCP servers. A user's normal MCP
connections can therefore be visible to a task whose only requirement is pure
structured generation. Tool approvals may reduce action risk, but the adapter
should not depend on per-user settings for its security contract.

## T3 Code comparison

This comparison inspected T3 Code's default `main` branch at commit
[`c9063f03ea1c16e0239e1996a9b6ef611679995d`](https://github.com/pingdotgg/t3code/tree/c9063f03ea1c16e0239e1996a9b6ef611679995d)
on 2026-08-14. The statements marked **confirmed** below come directly from
that commit. Statements marked **inference** describe the security consequence
of the confirmed wiring, and **not found** means a control was not present in
the inspected invocation or documentation—not that no downstream provider
component can supply one.

### How T3 Code invokes the local agents

| Surface | Confirmed source behavior | Security consequence |
| --- | --- | --- |
| Claude interactive sessions | T3 uses the Anthropic Agent SDK `query()` with the selected project as `cwd`, the `claude_code` preset system prompt, inherited/provider-instance environment, and all three settings sources: `user`, `project`, and `local`. It grants the project and T3 attachment directory as additional directories, installs a `canUseTool` approval callback, and can add T3's own authenticated MCP server. ([Claude query options](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4081-L4139), [settings sources](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L1171-L1175)) | **Confirmed:** user/project/local configuration and the working tree are deliberately in scope. **Inference:** hooks, plugins, project instructions, and configured MCP capabilities can participate according to Claude Code's settings semantics because the main-session invocation does not use `strictMcpConfig`, an empty MCP map, or a restricted settings source. |
| Claude permission modes | `auto-accept-edits` maps to `acceptEdits`, `auto` maps to Claude's `auto`, and `full-access` maps to `bypassPermissions` with `allowDangerouslySkipPermissions: true`; supervised/approval-required leaves the SDK permission mode unset and routes decisions through `canUseTool`. ([mode mapping](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4081-L4117)) | **Confirmed:** full access bypasses permission prompts. **Not found:** an invocation-owned OS sandbox or network-off policy in these query options. Claude Code/provider defaults therefore remain part of the boundary. |
| Codex interactive sessions | T3 spawns `codex app-server` in the selected project `cwd`, passing the merged host/provider environment and optional `CODEX_HOME`; it also forwards configured launch arguments. ([spawn](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L862-L895), [launch arguments](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/codexLaunchArgs.ts#L3-L16)) | **Confirmed:** normal Codex home/config/auth and almost the entire server environment reach the child. **Inference:** project instructions and user/project MCP/config remain available unless the user's forwarded config disables them. |
| Codex permission modes | Supervised maps to `untrusted` + `read-only`; auto-accept-edits maps to `on-request` + `workspace-write`; auto uses the same sandbox with the `auto_review` reviewer; full access maps to `never` + `danger-full-access`. ([thread configuration](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L264-L314)) T3's user guide says new threads default to full access. ([permission-mode guide](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/docs/user/permission-modes.md#L3-L34)) | **Confirmed:** the default interactive posture allows commands and edits without prompts and removes the Codex sandbox. This is appropriate only when the user knowingly wants a general coding agent, not for pure structured generation. |
| Claude one-shot text generation | For commit messages, PR content, branch names, and titles, T3 runs `claude -p --output-format json --json-schema … --model … --dangerously-skip-permissions`, sends the prompt on stdin, sets the repository as `cwd`, and passes the inherited/provider environment. It supplies no empty tool list, bare/settings isolation, MCP isolation, or sandbox option. ([Claude text generation](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L159-L219)) | **Confirmed:** a supposedly pure text-generation operation runs Claude Code with permission bypass in a credential-bearing project process. This is a materially broader surface than MergeBrief's `--tools ""` invocation. |
| Codex one-shot text generation | T3 runs `codex exec --ephemeral --skip-git-repo-check -s read-only --output-schema … --output-last-message … -`, sends the prompt on stdin, uses the repository as `cwd`, and passes the inherited/provider environment plus optional `CODEX_HOME`. Selected user launch arguments for config/features are forwarded. ([Codex text generation](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/CodexTextGeneration.ts#L180-L219), [forwarded exec args](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/codexLaunchArgs.ts#L18-L40)) | **Confirmed:** this is close to MergeBrief's Codex lockdown, but it still exposes the child to ambient environment/config and does not establish an MCP-free or minimal shell environment. Read-only prevents writes, not reads or model-bound command output. |
| Provider environment and authentication | Provider-instance variables are merged on top of `process.env`, not allowlisted. Claude keeps `HOME` so macOS Keychain login still works and optionally sets `CLAUDE_CONFIG_DIR`; Codex optionally sets `CODEX_HOME`. T3 documents normal `claude auth login`/`codex login`, and also documents provider-specific endpoint/key variables stored as server secrets. ([environment merge](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/ProviderInstanceEnvironment.ts#L3-L15), [Claude home behavior](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Drivers/ClaudeHome.ts#L17-L34), [authentication setup](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/README.md#L13-L32), [provider endpoint/key configuration](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/docs/user/providers-claude.md#L98-L135)) | **Confirmed:** the “sensitive” storage flag protects return to the app UI, but configured values still enter the provider process because that is how they authenticate or redirect it. **Inference:** any model-callable command that receives the same environment may expose those values unless a provider-enforced child-shell policy removes them. |
| T3 MCP credential | When T3's own MCP session is active, Claude receives its authorization header in the SDK MCP definition; Codex receives a bearer-token environment variable and config pointing at the local MCP endpoint. ([Claude MCP injection](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4126-L4138), [Codex MCP injection](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/CodexAdapter.ts#L1665-L1695)) | **Confirmed:** the MCP server must receive authorization. **Inference:** putting the Codex bearer value in the app-server environment creates an additional disclosure target if Codex's shell environment policy passes it to model-callable commands. |
| Capability probes | The current Claude probe is intentionally promptless, sets `allowedTools: []`, supplies an empty MCP map with `strictMcpConfig: true`, and disables connected claude.ai MCP servers. It still loads user/project/local settings for command discovery and passes the environment. ([probe hardening](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeProvider.ts#L575-L610), [promptless initialization](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeProvider.ts#L703-L743)) The Codex probe starts `app-server` from the T3 server's own `process.cwd()` with inherited environment/config. ([Codex probe](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/CodexProvider.ts#L322-L367), [probe cwd/environment](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/CodexProvider.ts#L503-L551)) | **Confirmed:** T3 demonstrates that Claude MCP startup can be explicitly isolated while preserving account discovery. **Inference:** MergeBrief should adopt equivalent fail-closed probe tests rather than assume a version/auth check cannot trigger ambient startup behavior. |
| Local event logs | T3 writes native and canonical provider events to rotating local logs; the Claude native record includes the complete SDK message as its payload. Defaults include a 14-day maximum age and 512 MiB total budget. ([native payload](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/ClaudeAdapter.ts#L1679-L1715), [event-log defaults](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/EventNdjsonLogger.ts#L25-L37), [serialization](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/provider/Layers/EventNdjsonLogger.ts#L440-L448), [log path](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/config.ts#L109-L131)) | **Confirmed:** prompts, tool events, and provider payloads can gain a second local lifetime. **Not found:** general content redaction before native/canonical provider events are serialized; retention and filesystem protection are therefore security controls, not merely observability settings. |

T3 Code includes useful secret-safe public error handling in some paths—for
example, generic CLI exceptions are wrapped without copying arbitrary error
text into the public message—but the one-shot text generators copy CLI stdout
or stderr into a `TextGenerationError` on non-zero exit. That output is
provider-controlled and may contain tool or credential material.
([generic normalization](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/TextGenerationUtils.ts#L72-L111),
[Claude exit detail](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L193-L216),
[Codex exit detail](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/CodexTextGeneration.ts#L229-L252))

No T3-specific prompt-injection defense or agent credential-exposure warning
was found in the inspected README, permission/provider guides, or web UI access
copy. The UI accurately says full access allows commands and edits without
prompts, but does not warn that agent-readable credentials, hooks, MCP, or
untrusted repository content share that boundary.
([UI access descriptions](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/web/src/components/chat/ChatComposer.tsx#L230-L254))
This is an absence-of-control finding, not proof that the underlying Claude
Code or Codex safeguards are disabled. T3's own text-generation prompts place
staged patches, PR templates, thread history, user messages, and attachment
metadata directly in the prompt and truncate by character count; they do not
add an untrusted-data security boundary.
([T3 prompt assembly](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/TextGenerationPrompts.ts#L34-L58),
[PR-content prompt](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/TextGenerationPrompts.ts#L94-L137),
[thread-title prompt](https://github.com/pingdotgg/t3code/blob/c9063f03ea1c16e0239e1996a9b6ef611679995d/apps/server/src/textGeneration/TextGenerationPrompts.ts#L277-L317))

### Comparison with MergeBrief

MergeBrief's local CLI surface is narrower than T3's interactive agent surface:
it is one-shot structured generation, Claude's built-in tools are removed, and
Codex is read-only and ephemeral. It is also safer than T3's Claude one-shot
helper because MergeBrief does not pass `--dangerously-skip-permissions`.
However, both projects' Codex one-shot paths inherit a broad host environment,
run in a real repository context, and do not prove user/project MCP, hooks,
plugins, instructions, login-shell values, or CLI redirects are absent.

T3's hardened Claude capability probe is the strongest reusable pattern from
the comparison: make the tool set empty, make MCP config explicitly empty and
strict, disable connected MCP discovery separately, avoid sending a prompt,
and test that no server starts. Its interactive `full-access` default and its
Claude text-generation permission bypass are not suitable precedents for
MergeBrief's pure generator contract.

## Prompt-injection and exfiltration threat inventory

Prompt text saying “treat this as data” is useful defense in depth, but it is
not a security boundary. The enforceable boundary is the runtime authority
available after the model is confused. MergeBrief already fences linked
context and review comments, strips nested fence tags, bounds repository
instructions, and tells the model those surfaces are data.
([prompt defenses](../../../packages/brief-core/src/generation/prompt.ts#L109-L136),
[linked-context fencing](../../../packages/brief-core/src/generation/categorize.ts#L103-L115),
[review-comment fencing](../../../packages/brief-core/src/generation/categorize.ts#L413-L428),
[forged repo-fence stripping](../../../packages/brief-core/src/generation/repo-context.ts#L78-L120))
Those controls reduce instruction confusion but cannot compensate for an agent
that can read credentials or call ambient tools.

| Threat path | Current evidence and status | Required coverage |
| --- | --- | --- |
| PR title, description, file paths, unified/incremental diffs, and review comments | **Confirmed input:** all enter model context; comment/linked-context tags are explicitly labeled untrusted, while title, description, file names, and diff are structurally delimited but remain adversary-controlled text. ([full prompt assembly](../../../packages/brief-core/src/generation/categorize.ts#L179-L208), [delta assembly](../../../packages/brief-core/src/generation/categorize.ts#L443-L461)) | Test injections in every field independently and in combinations. Success means valid structured output and zero observable tool/MCP/hook activity—not merely that the model refuses the instruction. Strip or neutralize forged section tags across every untrusted field, not only when repo context happens to be present. |
| Repository instructions and custom policy text | **Confirmed semi-trusted input:** default-branch instructions and custom-attribute criteria are inserted into the prompt with bounded influence and fence stripping. ([repo-context policy](../../../packages/brief-core/src/generation/prompt.ts#L109-L136), [assembly](../../../packages/brief-core/src/generation/categorize.ts#L130-L176)) | Treat a compromised default branch as an attacker. Test directives that request file/env reads, schema changes, tool use, or secret disclosure. Keep policy validation authoritative and ensure textual criteria cannot create executable/tool authority. |
| Linked external context | **Confirmed indirect-injection path:** text fetched from URLs in the PR description is added to the prompt and labeled untrusted. ([linked-context rule](../../../packages/brief-core/src/generation/prompt.ts#L199-L213)) | Preserve provenance per document, cap size/type, strip nested delimiters, and never execute instructions or follow new links found inside retrieved text. Add fixtures for hostile issue pages, redirects, HTML comments, document metadata, and content that quotes apparently trusted system text. |
| Model tool output and MCP results | **Confirmed general agent path; currently unnecessary for the generator.** Provider docs establish that tool results return to model context. Ambient local MCP remains possible in the CLI invocations. | Make “no model-callable tools and no MCP servers” an invocation-owned invariant. Canary tests must fail on server startup as well as tool invocation. If any future retrieval tool is added, label every result untrusted and gate outbound arguments and returned fields independently. |
| Hooks, plugins, skills, MCP startup, and project instructions | **Confirmed configuration exposure; exact startup set requires runtime verification.** The adapters do not use a bare/strict empty configuration, and local inventory already found user-scoped Claude servers/hooks/plugins. | Start fake user-, project-, and local-scoped components whose startup alone fails the test. Cover normal generation, version/auth probes, failure paths, and retries. Reject unsupported CLI versions rather than silently dropping isolation flags. |
| Parent environment and login shell | **Confirmed:** the harness copies the parent environment minus a short denylist; Codex's inner shell policy and login-shell behavior are not pinned. | Build an allowlist-first process environment and a second provider-shell allowlist. Set `inherit = "none"`/`core`, `ignore_default_excludes = false`, explicit includes, and `allow_login_shell = false`. Test canaries with ordinary names as well as `KEY`/`TOKEN`/`SECRET`, and test shell startup files cannot restore them. |
| Readable filesystem and auth stores | **Confirmed capability:** read-only Codex can read, and Claude's normal auth route intentionally retains `HOME`/keychain access. Files such as `.env`, cloud/SSH/package-manager config, CLI histories, credential helpers, sockets, and auth stores may be reachable even when the credential is absent from the environment. | Run the generator in a credential-minimal OS sandbox/container with an explicit read allowlist. Mount only required prompt/schema/auth broker surfaces. Test fake secrets outside the repository, in dotfiles, in parent directories, and behind helper commands. Provider login material must authenticate the CLI without becoming readable to model-callable commands. |
| Provider endpoint, proxy, and billing redirects | **Confirmed partial mitigation:** known Anthropic/OpenAI/OpenRouter environment redirects are stripped, but CLI config files, helpers, provider profiles, generic proxy variables, DNS/CA settings, and future env names are not controlled. | Pin approved provider endpoints and auth mode at the invocation boundary where supported. Reject config/provider/endpoint overrides, helpers, proxy variables, and launch args outside an allowlist. Test that a hostile project/user config cannot redirect prompts or credentials to a canary endpoint. |
| Unicode, bidirectional, zero-width, homoglyph, HTML-comment, and encoded instructions | **Inference/evasion class:** delimiter stripping and natural-language warnings operate on visible strings; equivalent directives can be obscured or encoded and decoded by the model. | Add adversarial evals for Unicode normalization, bidi controls, zero-width separators, homoglyph section tags, HTML/Markdown hiding, URL/base64/hex encoding, and nested quoted instructions. Do not rely on detection as the main control: a successfully decoded injection must still have no tool or secret-reading authority. |
| Cross-turn and schema-feedback retry | **Confirmed second-order path:** after schema failure, raw model output and validation text are copied into a fresh CLI prompt; API adapters continue the conversation. ([retry feedback](../../../packages/generators/src/validation/enforceSchema.ts#L65-L75), [retry loop](../../../packages/generators/src/validation/enforceSchema.ts#L171-L215)) An injected first response can therefore become a more privileged-looking quoted block on attempt two. | Mark previous output as untrusted data, cap it, strip control delimiters, and preferably retry with the same zero-authority runtime. Test an invalid first answer containing tool instructions, forged system tags, secret requests, and encoded payloads. Ensure retries do not load additional configuration or gain different permissions. |
| Previous briefs and revision history | **Confirmed cross-turn path:** anchored briefs and revision narratives feed prior model-produced artifacts back into later prompts as reference context. The prompt labels the anchor as data, but the artifact can preserve an earlier injection. ([anchor rules](../../../packages/brief-core/src/generation/prompt.ts#L161-L186), [revision context](../../../packages/brief-core/src/generation/categorize.ts#L591-L609)) | Revalidate and structurally serialize stored artifacts before reinjection. Test malicious text surviving in summaries, titles, risk notes, quotes, and ticket fields across several revisions. Never grant later turns more authority than the first. |
| JSON Schema names and descriptions | **Confirmed model-visible control plane:** the CLI receives a generated schema, and validation errors/schema feedback are reintroduced into prompts. Current schemas are code-defined plus validated custom vocabulary, but future dynamic descriptions could become an injection source. | Permit schema descriptions and enum labels only from trusted static code or tightly validated data. Escape/control-length-limit every dynamic label. Add a test that malicious repo-defined criteria cannot alter the output contract, request tools, or appear as an executable instruction in feedback. |
| Model output, error causes, and failure dumps | **Confirmed local persistence:** failed raw output plus validation error is written to `.failed.json`; its default file mode follows process/umask, and the path enters logs/errors. ([failure dump](../../../packages/generators/src/validation/enforceSchema.ts#L78-L103), [dump/error flow](../../../packages/generators/src/validation/enforceSchema.ts#L200-L221)) If a model or tool ever emits a secret, the dump becomes a second copy. | Create dumps with `0600` in a private directory, redact or quarantine credential-like content before ordinary diagnostics, set deletion/size limits, and never upload automatically. Test values only with canary identifiers/hashes. Treat any real secret in model output, stderr, a dump, or a transcript as an incident requiring rotation. |
| CLI stdout/stderr, application logs, telemetry, and traces | **Confirmed mixed posture:** normal error messages avoid free-form provider text and timeout tails are pattern-redacted, but regex redaction is incomplete by construction and comments indicate diagnostic detail may be retained. ([redaction boundary](../../../packages/generators/src/harness/redact.ts#L9-L31), [redaction patterns](../../../packages/generators/src/harness/redact.ts#L32-L80)) | Apply structured allowlists before logging; never log prompts, tool results, raw output, full environment, command arguments containing secrets, or auth/config files. Verify OpenTelemetry exporters and crash reporting cannot capture those fields. Add canaries with unfamiliar formats so tests do not merely mirror the regex list. |
| Output consumed by UI, GitHub, Notion, or another agent | **Inference/second-order path:** schema validation constrains shape, not the meaning of free-text fields. A hostile summary or quote can carry instructions into a later human/agent/system context. | Contextually escape output, keep provenance, and never auto-execute links/commands or pass generated prose to another agent as instructions. Test that stored/generated text remains data when rendered, posted, exported, or used in later generation. |

The common exploit chain to break is:

1. Attacker-controlled PR or retrieved content supplies an instruction.
2. The model follows it despite textual data-boundary warnings.
3. A shell, filesystem read, MCP tool, hook, plugin, helper, or redirected
   provider gives the instruction access to sensitive data or an egress path.
4. The value returns through tool output/model context or is copied into a
   local dump, transcript, log, telemetry event, or downstream artifact.

Eliminating step 3 for pure generation makes the system resilient even when
steps 1–2 eventually bypass model-level prompt-injection defenses.

## Recommended remediation

### Immediate engineering work

1. **Make the harness environment allowlist-first.** Build a minimal spawn
   environment from required runtime values rather than copying `process.env`
   and subtracting known credential names. Keep provider authentication in the
   CLI's protected login/keychain path. Document every allowed variable and
   why it is required.
2. **Enforce Codex's inner shell environment policy on every run and probe.**
   Use `inherit = "none"` where practical, otherwise `core`; set
   `ignore_default_excludes = false`; use an include allowlist; and set
   `allow_login_shell = false`. Do this with invocation-owned configuration so
   a permissive user config cannot weaken the harness.
3. **Remove ambient tool configuration.** Run both generators with isolated
   settings/configuration that contains no MCP servers, plugins, hooks, skills,
   or project instructions. Prefer a provider-supported bare/no-settings mode.
   If authentication makes that impossible, create a purpose-built isolated
   profile and explicitly prove which config layers still load.
4. **Add canary tests at both process layers.** Seed fake secrets with names
   both inside and outside familiar patterns, then have fake CLIs report only
   variable names/presence—not values. Assert the CLI process and every
   model-callable child command cannot observe them. Add a fake project/user
   MCP server whose startup is a test failure; assert it never starts.
5. **Fail closed on unsupported CLI versions/configuration.** If the required
   environment or MCP isolation flags are unavailable or cannot be verified,
   refuse the CLI adapter rather than relying on model instructions.
6. **Pin the authentication and provider route.** Reject unapproved endpoint,
   proxy, credential-helper, launch-argument, and provider-profile overrides.
   Authentication should prove identity to the intended provider without
   making the credential readable by the model's child processes.
7. **Add an OS read boundary, not only a write sandbox.** Give generation a
   private temporary directory plus only the files it must read. Keep home
   directories, parent repositories, sockets, cloud/SSH/package-manager
   stores, and application secrets outside the mount/read allowlist.
8. **Harden retries and diagnostics as hostile-content paths.** Re-serialize
   prior output as bounded data before retry, keep identical zero-tool
   authority across attempts, create failure dumps with `0600`, and enforce
   local retention/size/deletion. Logs and telemetry should receive only
   allowlisted structured metadata, never raw prompt/output/tool content.
9. **Build a provenance-aware injection test matrix.** Cover each PR field,
   repo instructions, linked pages, comments, diffs, filenames, prior briefs,
   schema descriptions, tool results, and combinations thereof. Include
   Unicode, bidi, zero-width, homoglyph, HTML-comment, base64/hex, quoted-system,
   and multi-turn payloads. Assert capability non-use, not just model wording.

### Operating controls

- Launch local agents from a credential-minimal shell or dev container. Do not
  assume `read-only` or network-off protects environment variables.
- Keep `.env`, cloud config, SSH material, package-manager auth, and CLI token
  stores outside agent-readable roots; enforce OS-level read restrictions,
  not only prompt instructions.
- Use short-lived, narrowly scoped credentials and separate identities for
  automation. Prefer workload identity or a credential broker/proxy that does
  not place the long-lived credential in the agent process.
- Treat repository instructions, issues, PR text/diffs, web pages, and MCP
  results as untrusted data. Require approval for any sensitive read, write, or
  cross-system transfer.
- Allowlist MCP servers and tools centrally. Pin/review local server code,
  sandbox stdio servers, minimize OAuth scopes, and audit calls. Do not accept
  token passthrough.
- Disable provider training where appropriate, select business/API commercial
  terms for company code, and use ZDR/MAM only as defense in depth.
- Keep retrieved pages and generated artifacts provenance-labeled as they move
  through storage, UI, GitHub/Notion posting, exports, and later model calls.
  Rendering or reinjection must never upgrade generated prose into trusted
  instructions or make links/commands auto-executable.
- Never print a secret during diagnosis. Verify exposure with names, hashes,
  canary identifiers, or presence booleans; rotate any credential whose value
  may already have appeared in a prompt, tool result, transcript, dump, or log.

## Suggested acceptance criteria for the priority-now ticket

- The Codex and Claude Code generator subprocesses receive an explicit minimal
  environment; no arbitrary parent variable is inherited.
- A model-callable command receives no credential variables, including canary
  names that do not contain `KEY`, `SECRET`, or `TOKEN`.
- Login-shell profile files cannot reintroduce filtered values.
- User- and project-scoped MCP servers, plugins, hooks, skills, and agent
  instructions cannot load during pure generation.
- Existing subscription/keychain login still works without copying credential
  material into prompts, arguments, logs, failure dumps, or model-callable
  command environments.
- Automated tests cover generation and auth/version probes for both CLIs and
  fail if a canary MCP server starts or a canary variable is observable.
- Tests place canary files and helper commands in the home directory, parent
  directories, common credential-store paths, and login-shell profiles; none
  are readable or executable from a generation attempt.
- Attempts cannot change provider endpoint, proxy, authentication identity, or
  billing route through environment, CLI config, project config, helper, or
  launch argument.
- Adversarial fixtures cover every untrusted input source, encoded/Unicode
  variants, first-attempt output echoed into retry, and stored output reused in
  later revisions. Passing means no tool/config startup and no canary exposure.
- Failure dumps are private (`0600`), bounded, retained only for a documented
  interval, excluded from telemetry/uploads, and tested with unfamiliar canary
  formats. Logs/traces contain no prompts, raw outputs, tool results, or secret
  values.
- Self-host documentation states the residual trust boundary and the incident
  response: revoke/rotate on suspected exposure.
