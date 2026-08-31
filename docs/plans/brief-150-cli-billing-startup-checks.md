# BRIEF-150 — Claude CLI startup checks: version-floor warning + billing-route assertion

Implementation plan (init-plan output, 2026-08-08). Ticket:
[BRIEF-150](https://app.notion.com/p/3b65e9400eeb81e5ada4d362d48e8d14) —
decisions 1–3 locked on the BRIEF-141 wayfinder map; do not relitigate.

## Scope

Extend the claude-code startup check (ADR 0030 #5) with two billing checks:

1. **Version-floor warning, non-fatal**: installed CLI older than `2.1.226`
   (the billing-attribution-verified floor) ⇒ `warn` — older versions
   misattributed subscription OAuth spend to Console prepaid.
2. **Billing-route assertion, refuse on mismatch**: at boot, verify the
   active auth route is the subscription; an API-key route under the
   claude-code provider ⇒ `ConfigError`, fail-loud. Closes the residual
   `apiKeyHelper` hole (`run.ts` BRIEF-140 note) at verification time.

claude-code only; codex never had the leak. No generation surface touched ⇒
**no eval runs**.

## Mechanism decision (the one open question): parse CLI output, no SDK

**Decided: parse `claude auth status --json` stdout in the existing auth
preflight. The `@anthropic-ai/claude-agent-sdk` dependency is rejected.**

Empirical grounding (verified locally 2026-08-08, CLI 2.1.226 — the floor
version itself):

| Route | `authMethod` | `apiKeySource` | `subscriptionType` | Verdict |
|---|---|---|---|---|
| Keychain login | `claude.ai` | absent | `"max"` | subscription — pass |
| `CLAUDE_CODE_OAUTH_TOKEN` | `oauth_token` | absent | absent | subscription — pass |
| `ANTHROPIC_API_KEY` env | `claude.ai` | `"ANTHROPIC_API_KEY"` | `null` | API key — refuse |
| `apiKeyHelper` in settings | `api_key_helper` | `"apiKeyHelper"` | absent | API key — refuse |

`--json` is the default output of `auth status`, which is already the
probe's `authArgv` — the assertion reads the stdout of a spawn that already
happens. Why not the SDK:

- The SDK spawns its own CLI subprocess, outside the harness spawn boundary —
  it would bypass `envForSpawn` credential stripping, the kill ladder, and
  the watchdog timers (`harness/run.ts` invariants, BRIEF-140).
- The SDK resolves/bundles its own CLI executable by default — risk of
  probing a different binary than the operator's configured `command`.
- A new runtime dependency for four JSON fields the CLI already prints.

The t3code SDK init-probe (docs/dev/t3code-invocation-comparison.md §2)
stays a display-only reference; `auth status --json` exposes the same
account fields without it.

### Assertion semantics

- **Pass**: `apiKeySource` absent AND `authMethod` ∈ {`claude.ai`,
  `oauth_token`}.
- **Refuse (ConfigError)**: any `apiKeySource` present, or `authMethod`
  outside the pass set — remediation message names `apiKeyHelper` in the
  CLI settings and the strip-list behavior. Messages use fixed/allowlisted
  vocabulary only; `authMethod`/`apiKeySource` are untrusted CLI strings and
  never reach errors verbatim (no-secrets-in-errors invariant).
- **Warn, don't refuse — unverifiable**: exit-0 `auth status` whose stdout
  doesn't parse to the expected shape (older CLI without these fields).
  Positive-evidence refusal only: refusing on unparseable output would make
  decision 1's non-fatal old-version stance unreachable (old CLIs would
  brick on the parse instead of warning on the version). Existing
  non-completion rules (timeout/signal ⇒ ConfigError, no false auth
  verdicts) are untouched.
- Version check: parse leading `major.minor.patch` from `--version` stdout
  (`2.1.226 (Claude Code)` shape), numeric-compare against the floor
  constant. Older ⇒ warn; unparseable ⇒ warn "version unverifiable".

## Design

- `harness/probe.ts` — two optional generic hooks on `HarnessProbeArgs`,
  invoked only after the existing exit-code checks pass:
  - `interpretVersionOutput?: (stdout: string) => string | null` — non-null
    ⇒ warning to surface (probe gains optional `log?: Logger`).
  - `interpretAuthOutput?: (stdout: string) => Result<string | null, ConfigError>`
    — `ok` with optional warning, or refusal issues.
  Probe stays adapter-agnostic; codex passes nothing and is untouched.
- `adapters/claudeCode.ts` — claude-specific interpreters, mirroring the
  `CODEX_PROBE` precedent (adapter owns its probe knowledge):
  - `CLAUDE_BILLING_VERSION_FLOOR = "2.1.226"` + version interpreter.
  - Billing-route interpreter: lenient (non-strict) Zod shape over the
    fields read (`loggedIn`, `authMethod`, `apiKeySource`,
    `subscriptionType`); returns the pass/refuse/unverifiable verdict per
    the semantics above.
- `config/registry.ts` — wire both interpreters into the CLAUDE_CODE
  `probeHarnessCli` call; pass `deps.log` through.
- Test shims (`test/shims`, fake-the-binary pattern): claude shim answers
  `auth status` with a configurable JSON body; cases — keychain pass,
  oauth_token pass, apiKeyHelper refuse, env-key refuse, unparseable
  warn-pass, old-version warn-pass, version-unparseable warn-pass.
- `docs/self-host/generators.md` — one line in the Billing subsection
  (§"what subscription actually guarantees") describing the boot assertion
  (ticket decision 3; BRIEF-151 docs already landed, no coordination left).

## Git requirements (git-eng — mandatory for ALL git operations)

- Branch **off `main`** (PR #251 merged 2026-08-08):
  `feature/BRIEF-150/cli-billing-startup-checks`.
- **Chunked commits** (strategy confirmed): one commit per logical unit.
- **Pre-commit gate (confirmed): `security-reviewer` on the staged diff
  before every commit**; findings with confidence ≥ 80 are fixed and
  re-reviewed until clean.
- No `Co-Authored-By` trailers; no AI attribution in the PR description.
- Push HTTPS via the gh credential helper.
- **`reviewer` on the full branch diff before opening the PR**;
  iterate on medium+ findings (nitpick-only = clean).
- PR to `main`, title `[BRIEF-150] chore: Claude CLI Billing Startup
  Checks`; Idan merges.

## Specialist skills (confirmed via AskUserQuestion)

- **`typescript-eng` — mandatory** during implementation.
- Repo rules apply: strict TS, no `enum`/bare `as`, Zod at boundaries
  (`zod/v4`), named exports, extensionless imports, `Result` for expected
  failures, no secrets in errors, coverage floors ride in `pnpm test`.

## Shape: one subtask, one PR

Single S-effort subtask; estimated ~120 src + ~250 test + ~10 docs LOC ≈
**380 LOC — one PR** (well under the 500 ideal). Commit chunks:

1. `probe.ts` generic hooks + probe unit tests.
2. `claudeCode.ts` interpreters (version floor + billing route) + tests.
3. `registry.ts` wiring + claude shim extension + registry-level tests +
   the generators.md docs line.

**Model/effort/invocation**: sequential in the main thread — design is
settled here, execution is small and mechanical; no implementation
subagents. Subagents only as review gates: `security-reviewer` per commit,
`reviewer` once on the branch diff.

## Implementation steps

1. `git-eng`: create `feature/BRIEF-150/cli-billing-startup-checks` off
   up-to-date `main`.
2. Chunk 1 — probe hooks: extend `HarnessProbeArgs` (`log`,
   `interpretVersionOutput`, `interpretAuthOutput`); invoke after existing
   pass conditions; tests for hook plumbing (warn surfaced, refusal
   propagates, absent hooks = today's behavior). security-reviewer ⇒ commit.
3. Chunk 2 — claude interpreters: floor constant, version parse/compare,
   auth-status Zod shape + verdict mapping; exhaustive unit tests over the
   route table. security-reviewer ⇒ commit.
4. Chunk 3 — registry wiring + shim JSON configurability +
   integration-level probe tests through `createGenerator`; generators.md
   line. security-reviewer ⇒ commit.
5. Verify: `pnpm -C packages/generators typecheck && pnpm -C
   packages/generators test && pnpm lint`.
6. `reviewer` on branch diff; iterate medium+ findings.
7. PR to `main` per git-eng rules; report eval-not-needed rationale (no
   generation surface) in the PR body.
