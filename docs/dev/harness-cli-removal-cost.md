# Harness-CLI removal cost (BRIEF-141 research)

What stripping the `claude-code` and `codex` adapters would take, if the
release-time ship/no-ship call goes against shipping them. Survey of the
seam as of 2026-08-08 (main @ 315ada64). **No removal happens on the
BRIEF-141 map** — this documents the cost so the release call is informed.

## Verdict up front

The seam is clean: no package outside `packages/generators` imports any
harness or CLI-adapter export, and the compose worker never had the
binaries. Removal is a single-package surgery plus docs/example edits —
roughly **-3,400 LOC deleted, ~200 LOC edited, zero cross-package
fallout**. One deliberate casualty: the BRIEF-140 spawn-env credential
strip seam lives inside `harness/run.ts` and dies with it (it exists only
to guard CLI spawns — nothing else consumes it).

## Deleted outright (≈1,230 source + ≈2,190 test LOC)

Source:

| File | LOC | Notes |
| --- | --- | --- |
| `src/adapters/claudeCode.ts` | 371 | adapter |
| `src/adapters/codex.ts` | 246 | adapter (+ `CODEX_PROBE` consumed by registry) |
| `src/harness/run.ts` | 423 | spawn/stream machinery; **contains the BRIEF-140 `envForSpawn` credential strip-list** |
| `src/harness/probe.ts` | 111 | boot probe (`--version` + auth preflight) |
| `src/harness/redact.ts` | 81 | secret redaction + timeout error |

Tests:

| File | LOC |
| --- | --- |
| `test/harness.test.ts` | 679 |
| `test/claude-code.test.ts` | 393 |
| `test/codex.test.ts` | 323 |
| `test/claude-code.contract.test.ts` | 103 |
| `test/codex.contract.test.ts` | 91 |
| `test/shims/fake-claude.cjs` | 345 |
| `test/shims/fake-codex.cjs` | 256 |

The shared contract suite (`test/contract.ts`) stays — the API adapters
run it too; only the two harness contract entries go.

## Edited (≈200 LOC removed across files)

- `src/config/registry.ts` (459 total): `CLAUDE_CODE`/`CODEX` provider
  tokens, `harnessTimeouts` + `claudeCodeOptions` + `codexOptions`
  schemas, both registry entries (probe wiring, served-model verify,
  login guidance strings), probe-related `createGenerator` plumbing —
  ≈120 lines. Provider union shrinks to
  `anthropic | openai | openrouter`; unknown-provider errors update.
- `src/index.ts`: the `ClaudeCodeGenerator`/`CodexGenerator` exports and
  the whole `harness/` export block (≈15 lines).
- `src/config/loader.ts`: comment references only.
- `smoke/generate-smoke.ts`: `--adapter claude-code|codex` arms + usage
  string (≈10 lines).
- `mergebrief.config.example.yaml`: the "Harness CLIs" block
  (`command:`, `timeouts:`) and the provider-list comments (≈15 lines).
- `tools/categorizer/test/eval-report.test.ts`: one CLI-account
  reference; `eval/report.ts`'s account-verification caveat comment.
- Per-runtime marker refusal (decided on the map's config ticket): if
  removal ships, the compose-worker targeted-refusal branch for harness
  providers becomes dead code and goes too.

## Docs fallout

- `docs/self-host/generators.md`: provider table drops two rows; the
  50-line "Harness CLIs are LOCAL-ONLY in v1 — deliberately" section
  (including the billing subsection) goes; scattered provider-list
  mentions (~10 sites).
- `docs/self-host/cli.md`, `compose.md`, `operations.md`: zero
  references — untouched.
- `docs/dev/harness-cli-capabilities.md` (211),
  `harness-cli-deployed-feasibility.md` (135),
  `t3code-invocation-comparison.md` (294): historical research —
  **keep** (they document why the adapters existed and what removal
  cost; cheap, and they'd be needed again for any revival).
- ADR 0030 (harness invocation shape): gets a superseded/status note,
  not deleted.

## What removal does NOT touch

- Compose files, worker Dockerfile, `packages/worker` — never had the
  binaries or any harness import.
- `packages/brief-core`, `apps/web`, `tools/categorizer` runtime code —
  grep confirms the only hits are prose comments ("eval harness",
  "codex round N" review annotations), not code coupling.
- The three API adapters and the shared contract suite.
- Coverage floors: generators loses ~2,190 test LOC against ~1,230
  source LOC — ratio-neutral to favorable; the vitest lines threshold
  should hold without adjustment (verify on the branch).

## Revival cost

Everything deleted is self-contained and history-recoverable; the
capabilities/feasibility/t3code docs stay on main. Revival ≈ revert of
one removal PR plus re-running the contract suite against current CLI
versions.
