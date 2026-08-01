# BRIEF-82 — Constraint-mesh survey: what comparable OSS repos actually enforce

Primary-source survey (repo files only — workflows, configs, in-repo docs —
fetched 2026-08-01 from shallow clones of each default branch) of nine repos:
five comparable TS/pnpm-monorepo projects (tRPC, Zod, Hono, Vitest, Astro) and
four multi-language test-discipline exemplars (esbuild, ripgrep, ruff,
FastAPI). Every claim cites the file at the pinned HEAD SHA. Research doc only
— no code changes, no adoption verdicts (those belong to the downstream
grill; standing rule: survey is evidence, not ceiling).

Citation form: (`owner/repo: path` @ `short-sha`). SHAs are the default-branch
HEADs at fetch time, listed in the cohort table.

## TL;DR

Across nine repos spanning solo-maintainer to company-scale, the enforced
mesh is far narrower than the tooling catalog suggests: **mutation testing
and Gherkin/BDD are absent in 9/9**; code coverage is measured in only 3/9
and hard-gated at a number in exactly one (FastAPI's double-enforced 100%);
none of the rigor-famous infrastructure projects (ruff, esbuild, ripgrep,
Vitest) measures coverage of itself at all — their quality budget goes to
snapshot mass, differential/ecosystem testing, real-binary execution, and
generated-artifact freshness gates instead. Nobody in the TS cohort ships an
in-house lint plugin; architecture rules ride *configured stock rules*
(`no-restricted-imports`, Biome overrides, clippy `disallowed-methods`) plus
dedicated tools (knip, madge, ts-prune, publint). Flake posture is near-zero
tolerance: retries exist only at the browser/E2E layer (Playwright 2–3), and
the preferred fixes are structural — test serialization, version pinning,
explicit quarantine lists — never blanket reruns. Path-filtered CI is
common, and every repo that combines it with required checks adds an
aggregation job (`alls-green` / `required-checks-passed`) so skipped jobs
don't break branch protection. No repo runs an npm/pip/cargo audit gate in
CI; supply-chain posture is pin-everything (SHA-pinned actions, frozen
lockfiles) + renovate-with-cooldown at team scale, or freeze-and-pin with no
bots at solo scale.

## Cohort

| Repo | HEAD @ fetch | Branch | Stack | Maintainer model (in-repo evidence) |
|---|---|---|---|---|
| trpc/trpc | `dfbafa8` | main | pnpm + turbo monorepo, vitest | Small core team (`.github/CODEOWNERS`: `* @trpc/trpc-core`) |
| colinhacks/zod | `912f0f5` | main | pnpm workspace, vitest | Effectively solo (`FUNDING.yml` = `github: colinhacks`; no CODEOWNERS/governance) |
| honojs/hono | `51db313` | main | bun-driven single package, vitest | Soft-BDFL (`docs/CONTRIBUTING.md`: "I want to write the code as I like") |
| vitest-dev/vitest | `ec367cf` | main | pnpm monorepo, vitest (dogfood) | Team-run org (release-branch policy, triage-gated ecosystem-ci in `CONTRIBUTING.md`) |
| withastro/astro | `296248c` | main | pnpm + turbo monorepo, node:test + Playwright | Org-scale (merge queue, bot fleet, `AGENTS.md`) |
| evanw/esbuild | `6ff1d8b` | main | Go + JS harnesses, Makefile-canonical | Solo (`docs/development.md`: "how **I** develop esbuild"; no CONTRIBUTING.md) |
| BurntSushi/ripgrep | `435f59f` | master | Rust workspace | Solo (`Cargo.toml` single author; `AI_POLICY.md` bans autonomous agents) |
| astral-sh/ruff | `2742f95` | main | Rust workspace + Python tooling | Company-scale (CODEOWNERS, reviewer pools, paid runner fleet) |
| fastapi/fastapi | `95f8322` | master | Python (uv), pytest | BDFL + small team (`docs/en/docs/management.md`: "I'm the BDFL") |

### Selection rationale

- **tRPC** — the closest structural analogue: pnpm+turbo TS monorepo with a
  vitest suite, small core team, heavy typed-API surface. Shows what a
  Codecov-ratchet + example-app E2E matrix looks like at our stack.
- **Zod** — solo-maintainer TS library with outsized user base; the best
  evidence for what a one-person quality mesh actually enforces (and skips).
- **Hono** — small-team multi-runtime TS library; the one TS repo in the
  cohort with a *blocking* numeric coverage bar, plus multi-runtime test
  matrices instead of browser E2E. Also our API framework.
- **Vitest** — our own test runner, dogfooding itself; a pnpm monorepo with
  the deepest CI supply-chain hardening in the TS cohort and explicit
  test-tier directory segregation.
- **Astro** — pnpm+turbo monorepo at org scale with Biome+ESLint dual
  linting, knip as a blocking gate, and turbo-affected CI — the upper bound
  of TS-monorepo CI sophistication.
- **esbuild** — solo-maintained Go exemplar famous for reliability; shows a
  Makefile-canonical tier system, snapshot testing, and freeze-and-pin
  supply chain with zero bots.
- **ripgrep** — solo-maintained Rust exemplar; the strongest counterexample
  to "rigor = more tools" (no clippy, no coverage, one massive real-binary
  integration suite across 10 architectures).
- **ruff** — the maximalist gate mesh (snapshot mass, ecosystem diffing,
  differential fuzzing, generated-code freshness, clippy-pedantic) — useful
  as the ceiling, with scale caveats flagged.
- **FastAPI** — the one repo with a hard 100% coverage bar and an
  executable-docs pattern; also the most hardened fork-PR posture in the
  cohort. Kept over pydantic/Django to represent the "coverage-maximalist"
  pole with a solo-BDFL model.

### Our baseline (verified in-repo 2026-08-01)

pnpm-workspace monorepo (10 `packages/*` + `apps/web` + `tools/categorizer`);
vitest 4.1.8 with **zero vitest config files** (zero-config per package, so
no coverage config exists anywhere); 203 `*.test.ts(x)` files tracked; lint =
`oxlint --type-aware` (oxlint 1.72.0 + oxlint-tsgolint) at root, prettier
`--check .` + stylelint scoped to `apps/web` only; a single hand-rolled
path-filtered `ci.yml` (per-job `git diff | grep -E` filters, node 22,
`pnpm/action-setup@v4` with **no explicit version** — it resolves from
`packageManager: pnpm@11.10.0`, so the inventory's "CI pnpm 10 vs root 11"
mismatch is not present in the current file); actions tag-pinned (`@v4`), no
dependabot/renovate, no playwright/e2e, no stryker, no `.feature` files
(root `package.json`, `.github/workflows/ci.yml`, `apps/web/package.json`,
`git ls-files` greps @ working tree on `main`).

## Layer 1 — Coverage

**Measured: 3/9. Hard numeric CI gate: 1/9. Ratchet: 1/9. Absent: 6/9.**

- **FastAPI — 100%, double-gated.** `coverage.py` via pytest-cov; per-matrix-leg
  coverage files uploaded as artifacts and combined in a `coverage-combine`
  job that runs `coverage report --fail-under=100` (`fastapi/fastapi:
  .github/workflows/test.yml` L319 @ `95f8322`); a second, independent gate
  posts a commit status via smokeshow with
  `SMOKESHOW_GITHUB_COVERAGE_THRESHOLD: 100` (`.github/workflows/smokeshow.yml`
  L57). Coverage `source` includes `docs_src` and `tests` themselves —
  doc examples and the tests must be fully executed (`pyproject.toml`
  L235–244); omissions are enumerated per-file (L245–256). Notably there is
  no `fail_under` in `pyproject.toml` — the bar lives only in CI.
- **Hono — blocking 75% project bar via Codecov.** `@vitest/coverage-v8`
  always on (`honojs/hono: vitest.config.ts` @ `51db313`), merged across
  node + bun + deno coverage artifacts, uploaded with
  `fail_ci_if_error: true`; `codecov.yml`: project `target: 75%`,
  `threshold: 1%` (status-check blocking), patch `target: 80%` but
  `informational: true` (`honojs/hono: codecov.yml`,
  `.github/workflows/ci.yml` L18–35 @ `51db313`).
- **tRPC — ratchet, not a number.** Vitest istanbul provider
  (`trpc/trpc: vitest.config.ts` @ `dfbafa8`, no `thresholds` key — grep 0
  hits); Codecov `status.project.default: { target: auto, threshold: 1% }`
  (allow 1% drop), `patch: off`, upload CI-blocking via
  `fail_ci_if_error: true`, token withheld on fork PRs
  (`trpc/trpc: codecov.yml`, `.github/workflows/main.yml` @ `dfbafa8`).
- **Absent — Zod** (no coverage key in any vitest config, no codecov.yml, no
  coverage script; a stale `CONTRIBUTING.md` line claims a coverage badge
  that no config supports — `colinhacks/zod` @ `912f0f5`, greps 0 hits).
- **Absent — Vitest itself** (no codecov reference anywhere; the CI suite
  named `coverage` tests the coverage *feature*, not Vitest's own code —
  `vitest-dev/vitest: package.json`, `test/coverage-test/` @ `ec367cf`).
- **Absent — Astro** (no c8/nyc/istanbul in manifests, scripts, or
  workflows; the custom `node:test` runner passes no coverage option —
  `withastro/astro: scripts/cmd/test.js` @ `296248c`).
- **Absent — esbuild** (no `-cover` in Makefile or workflows @ `6ff1d8b`),
  **ripgrep** (no llvm-cov/tarpaulin/codecov @ `435f59f`), **ruff** (zero
  `coverage` hits across all 20 workflows @ `2742f95`).

The split is not by rigor but by project type: the three that measure are
user-facing API surface libraries; the compilers/linters/test-runners with
the strongest reliability reputations measure nothing and spend the budget
on layers 2 and 6.

## Layer 2 — E2E / browser / real-binary tests

Present in some form in 7/9, but the *shape* varies wildly and browser
automation is a minority:

- **tRPC** — the heaviest live-service rig: an `e2e` CI job matrixed over
  ~19 example apps with a postgres service container, Playwright inside the
  examples (`retries: CI ? 3 : 0`, real Next dev server, prisma
  migrate+seed), plus `e2e-deno`, `e2e-bun`, `e2e-legacy-node` jobs. **The
  entire layer is `continue-on-error: true`** — advisory, not
  merge-blocking (`trpc/trpc: .github/workflows/main.yml`,
  `examples/next-prisma-starter/playwright.config.ts` @ `dfbafa8`).
- **Vitest** — three blocking layers: `test/e2e` spawns real vitest
  processes (ubuntu node 22/24/26 + macOS + windows legs); `test/browser`
  dogfoods its own Playwright browser-mode provider, sharded 2-way per OS;
  `test/ui` uses `@playwright/test` proper with `retries: CI ? 2 : 0`,
  `trace: 'on-first-retry'` (`vitest-dev/vitest: .github/workflows/ci.yml`
  L99–227, `test/ui/playwright.config.ts` @ `ec367cf`). All fixture-based.
- **Astro** — Playwright against the local dev server, Chrome config +
  a 3-file Firefox config, fixture projects per test, `retries: CI ? 2 : 0`,
  `workers: CI ? 1`, run on ubuntu+windows (`withastro/astro:
  packages/astro/playwright.config.js`, `.github/workflows/ci.yml`
  L277–314 @ `296248c`).
- **Hono** — no browser layer at all; instead multi-runtime integration
  suites under `runtime-tests/{node,bun,deno,fastly,lambda,lambda-edge,workerd,…}`,
  each a vitest project or native runner, all emulated/fixture-driven
  (wrangler, vite-plugin-fastly, local lambda mocks), each its own CI job
  (`honojs/hono: vitest.config.ts`, `.github/workflows/ci.yml` L72–182 @
  `51db313`).
- **ripgrep** — the real compiled `rg` binary run as a subprocess against
  in-repo corpora (`tests/util.rs` L182 `process::Command::new(rg)` @
  `435f59f`), executed under qemu on 10 cross targets (s390x, riscv64,
  ppc64…) in CI (`ci.yml` L66–105) — cross-architecture reality testing in
  place of browser E2E.
- **ruff** — differential testing against the world: the `ecosystem` job
  builds ruff from base and head refs and diffs lint/format results across
  real repos (report-only for diffs; CI fails only on crashes — `grep -q
  "project error" && exit 1`, `astral-sh/ruff: .github/workflows/ci.yaml`
  L626–747 @ `2742f95`); per-PR differential fuzzing with
  `--baseline-executable … --only-new-bugs` (L749–803); nightly 1000-seed
  fuzz that auto-files issues (`daily_fuzz.yaml`); downstream `ruff-lsp`
  pytest suite run against the fresh binary (L957–1015).
- **esbuild** — hand-rolled `scripts/end-to-end-tests.js` in the default
  test tier on 3 OSes, plus **live-registry install tests on a 6-hourly
  cron** (npm/pnpm/yarn/berry/deno — `evanw/esbuild:
  .github/workflows/e2e.yml` @ `6ff1d8b`), plus a wasm-browser harness.
- **Absent — Zod** (no playwright/cypress anywhere; nearest analog is
  compile-time ecosystem fixtures: `tsc` against drizzle-zod and ai-sdk
  sources and a 3-module-resolution matrix — `colinhacks/zod:
  packages/integration/package.json` @ `912f0f5`) and **FastAPI** (Playwright
  exists only as a docs-screenshot generator; all functional tests are
  in-process `TestClient` API tests — `fastapi/fastapi:
  scripts/playwright/`, `pyproject.toml` @ `95f8322`).

## Layer 3 — Mutation testing

**0/9.** Verified by repo-wide greps at the pinned SHAs: no
stryker/mutmut/cosmic-ray/cargo-mutants configuration or invocation in any
of the nine repos (each per-repo grep returned zero relevant hits; ruff's
and esbuild's only "mutation" hits are GraphQL strings and prose). The
practice has zero adoption in this cohort, including the repos most famous
for test rigor.

## Layer 4 — Gherkin / BDD

**0/9.** No cucumber/gherkin dependency, no `.feature` files, no
pytest-bdd/behave in any repo (repo-wide grep/find at each pinned SHA; the
only "cucumber" hits in the cohort are Zod enum test *data* —
`colinhacks/zod: packages/zod/src/v4/classic/tests/enum.test.ts` @
`912f0f5`).

## Layer 5 — Test-pyramid labeling and flake handling

**Segregation is by directory + CI job, never by tag/marker taxonomy:**

- Explicit directory tiers: Vitest (`test/unit`, `test/e2e`, `test/browser`,
  `test/ui`, `test/coverage-test`… mapped to a CI matrix axis
  `suite: [unit, e2e, coverage]` — `vitest-dev/vitest: package.json`,
  `.github/workflows/ci.yml` L107 @ `ec367cf`); Astro
  (`test/units/**` vs `test/*.test.ts` vs `test/types` vs `e2e/**`, encoded
  as separate package scripts and CI jobs — `withastro/astro:
  packages/astro/package.json` @ `296248c`); esbuild (Makefile tiers:
  `test` = dev suite, `test-all` = release suite with the slow extras;
  comments say exactly that — `evanw/esbuild: Makefile` @ `6ff1d8b`).
- Convention-only segregation: tRPC coalesces integration tests into
  `packages/tests/` but runs one CI job for everything
  (`trpc/trpc: CONTRIBUTING.md`, `.github/workflows/main.yml` @ `dfbafa8`);
  Zod co-locates tests in `src/` with no tiering (`colinhacks/zod:
  packages/zod/src/v4/classic/tests/` @ `912f0f5`); ripgrep is in-module
  `#[cfg(test)]` + one integration harness whose module names (`feature`,
  `regression`, `misc`) are the only taxonomy (`BurntSushi/ripgrep:
  tests/tests.rs` @ `435f59f`).
- Distinctive extra tiers: ruff's 3,697 committed insta snapshots + 356
  Markdown-driven `mdtest` files run inside normal `cargo test`
  (`astral-sh/ruff: crates/`, `CONTRIBUTING.md` L346 @ `2742f95`);
  FastAPI's `tests/test_tutorial/` mirroring `docs_src/` — every doc
  example is an importable app executed under coverage (`fastapi/fastapi:
  pyproject.toml` coverage `source`, `scripts/test.sh` @ `95f8322`); Zod's
  gated type-level tests (`typecheck.enabled: true, checker: "tsc"`)
  matrixed over TypeScript 5.5 and latest (`colinhacks/zod:
  vitest.config.ts`, `.github/workflows/test.yml` @ `912f0f5`).
- **Flake handling — retries are rare and layer-scoped:** unit-test retries
  exist in exactly one repo (tRPC: `retry: CI ? 2 : 0` in
  `vitest.config.ts` @ `dfbafa8`); Playwright retries 2–3 in CI at tRPC,
  Vitest (UI suite only), Astro. Zod, Hono, ripgrep, ruff, esbuild, FastAPI
  have **zero retry configuration** (per-repo greps, 0 hits). The
  structural alternatives observed: nextest `serial` test-group for
  race-prone file-watching tests + 60s deadlock terminate
  (`astral-sh/ruff: .config/nextest.toml` @ `2742f95`); Vitest isolating
  git-mutating e2e tests into a serial project (`test/e2e/vitest.config.ts`
  L4–9 @ `ec367cf`); esbuild pinning away flake causes (Deno pinned to
  1.24.0 "due to random segfaults" — `e2e.yml` L22–24 @ `6ff1d8b`);
  FastAPI converting hangs to failures with a global 20s pytest timeout and
  `filterwarnings = ["error"]` (`pyproject.toml` L222–233 @ `95f8322`).
- **Quarantine mechanisms (2/9):** ruff commits a flaky-ecosystem-project
  list (`crates/ty_python_semantic/resources/primer/flaky.txt`, consumed
  with `--flaky-runs 10/20` @ `2742f95`); Astro carves out one known-flaky
  suite as warn-don't-fail (`xvfb-run … || echo "::warning …Known flaky;
  not failing CI."` with a TODO — `ci.yml` L266–271 @ `296248c`). tRPC's
  blanket `continue-on-error: true` on all e2e jobs is quarantine at the
  granularity of an entire layer (`main.yml` @ `dfbafa8`).

## Layer 6 — Static constraints

**Custom in-house lint plugins: 0/9.** What exists instead:

- **Architecture-as-configured-stock-rules.** tRPC: `no-restricted-imports`
  banning `@trpc/*/src`; an adapter-isolation rule scoped to
  `packages/server/src/adapters/**` (cannot import core — "helps us ensure
  third party adapters can be made"); `no-restricted-syntax` banning
  `Symbol.dispose`; `max-params: 3`; `no-console: error` in `packages/**`
  (`trpc/trpc: eslint.config.js` @ `dfbafa8`). Astro: Biome overrides as
  architecture rules — `noNodejsModules: error` on `src/**/runtime/**`
  ("runtime agnostic"), tests must import `dist/` not `src/`, tiered
  `noConsole` (`withastro/astro: biome.jsonc` L137–210 @ `296248c`).
  Vitest: `no-restricted-imports` banning `path` repo-wide and `vitest`
  self-imports inside `packages/` (`vitest-dev/vitest: eslint.config.js` @
  `ec367cf`). ruff: clippy `disallowed-methods` banning `std::env::var`,
  `std::fs::*`, `Path::exists` with per-ban rationale — seam enforcement as
  lint (`astral-sh/ruff: clippy.toml` @ `2742f95`). esbuild: a grep-as-lint
  Makefile target failing the build on any `"path/filepath"` import
  (`evanw/esbuild: Makefile` L84–86 @ `6ff1d8b`).
- **Dead-code/dependency gates:** knip CI-blocking at Astro (inside
  `lint:ci` — `package.json` @ `296248c`) and Vitest (dedicated workflow,
  `knip --treat-config-hints-as-errors` — `.github/workflows/knip.yml` @
  `ec367cf`); ts-prune at tRPC (`lint.yml` @ `dfbafa8`); madge circular-dep
  job at Zod (`--circular … packages/zod/src` — `test.yml` @ `912f0f5`);
  `cargo shear --deny-warnings` at ruff (`ci.yaml` L805–816 @ `2742f95`).
  Package-surface linting: publint at Hono (postbuild) and Astro (CI step).
- **Linter maximal ↔ minimal poles:** ruff runs clippy pedantic with ~15
  documented allows, `-D warnings`, plus `unsafe_code`/`unreachable_pub`
  warns (`Cargo.toml [workspace.lints]` @ `2742f95`); ripgrep runs **no
  clippy at all** (grep 0 hits @ `435f59f`) and esbuild disables staticcheck
  with a pointed comment ("annoying, distracting, and largely useless" —
  `staticcheck.conf` @ `6ff1d8b`) — both still enforce formatting
  (`cargo fmt --check`; `gofmt` check on one CI leg) and doc-warning gates
  (`RUSTDOCFLAGS: -D warnings`, ripgrep `ci.yml` L234–246).
- **Dual linters are normal in modern TS repos:** Astro = Biome (fast rules)
  + ESLint (type-aware only: `switch-exhaustiveness-check`,
  `no-floating-promises`) + knip (`eslint.config.js`, `package.json` @
  `296248c`); Zod = Biome only, with opinionated opt-outs annotated inline
  (`noExplicitAny: off // "any" is amazing` — `biome.jsonc` @ `912f0f5`);
  Hono = shared org ESLint config with ~100 type-aware rules explicitly
  disabled (`eslint.config.mjs` @ `51db313`).
- **Type-checking beyond one checker:** FastAPI runs mypy `strict = true`
  *and* Astral's `ty` with `error-on-warning = true` (`pyproject.toml`
  L202–220, 363–400 @ `95f8322`); Zod matrixes its type-level tests across
  two TypeScript versions; ruff type-checks its own Python with ty
  (`ci.yaml` L364–369 @ `2742f95`).
- **TS strictness beyond `strict: true`:** tRPC is the maximalist
  (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` —
  `tsconfig.build.json` @ `dfbafa8`); Zod adds `exactOptionalPropertyTypes`
  but sets `noUncheckedIndexedAccess: false` explicitly
  (`.configs/tsconfig.base.json` @ `912f0f5`); Hono and Vitest stay at the
  plain `strict` family (`tsconfig.base.json` @ `51db313` / `ec367cf`);
  Astro adds `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals/
  Parameters` (`configs/tsconfig.base.json` @ `296248c`).
- **Format enforcement breadth:** whole-repo prettier at tRPC
  (`"**/*" --ignore-unknown`) and Hono (+ editorconfig-checker), both
  auto-fixed on PRs via autofix.ci (`trpc: lint.yml`; `hono: autofix.yml`);
  Astro makes formatting **not PR-blocking** — an action auto-formats after
  merge (`format.yml`, `CONTRIBUTING.md` "optional" @ `296248c`); Vitest
  formats via ESLint stylistic rules, no prettier at all; FastAPI and ruff
  run format checks inside pre-commit/CI (`ruff format --check`;
  `cargo fmt --all --check`).
- **Generated-artifact freshness gates** (a recurring in-house pattern):
  ruff regenerates AST/formatter code and fails on `git status --porcelain`
  (`ci.yaml` L608–619 @ `2742f95`); esbuild re-runs its unicode-table
  generator and diffs (`ci.yml` L214–216 @ `6ff1d8b`); Vitest fails on
  stale build artifacts after docs generation (`ci.yml` L51–53 @
  `ec367cf`); tRPC fails CI on stale generated openapi test routers
  (`main.yml` @ `dfbafa8`).
- **Workflow-security linting is an emerging norm (4/9):** zizmor runs at
  ruff, Vitest, Astro (SARIF workflows) and FastAPI (pre-commit + CI), with
  actionlint at ruff/Vitest (`.github/workflows/zizmor.yml` in each;
  `.pre-commit-config.yaml` @ `2742f95` / `95f8322`).

## Layer 7 — CI structure

- **Path filtering: 5/9 filter, 4/9 run everything.** Declarative
  `paths-ignore` for docs at Hono (`ci.yml` L5–12 @ `51db313`) and Astro
  (plus `dorny/paths-filter` for the language-tools job — `ci.yml` L35–57
  @ `296248c`); changed-files-based skip-if-docs-only at Vitest
  (`tj-actions/changed-files` → `should_skip` — `ci.yml` L70–94 @
  `ec367cf`); FastAPI gates test/benchmark on `dorny/paths-filter` `src`
  flags (`test.yml` L33–45 @ `95f8322`); ruff **hand-rolls it** — a
  `determine_changes` job computes merge-base `git diff --quiet` against
  explicit pathspec lists emitting 9 flags, every list including the
  workflow file and lockfiles themselves, with a documented trap avoided
  ("Do not exclude all Markdown files… tests for ty are written in
  Markdown" — `ci.yaml` L31–244 @ `2742f95`). tRPC, Zod, ripgrep, esbuild
  run the full suite on every PR (verified: no `paths:` on their test
  workflows).
- **Path filtering + required checks ⇒ aggregation job (2/2 that need it):**
  FastAPI's `alls-green` job with `allowed-skips` (`test.yml` L322–340 @
  `95f8322`) and ruff's `required-checks-passed` (`if: always()`, fails
  unless each needed job is `success` or `skipped` — `ci.yaml` L1312–1336
  @ `2742f95`). This is the cohort's answer to the skipped-required-check
  problem that path filtering creates.
- **Cross-package dependency-aware gating:** turbo remote cache +
  `--filter` at tRPC (`main.yml`, `turbo.json` @ `dfbafa8`); Astro rewrites
  `--filter=X` to `X[origin/<base>…HEAD]` on PRs via a custom script
  (`scripts/turbo-run-affected.js` @ `296248c`); Vitest and Zod use plain
  pnpm `--filter`. Nobody in the cohort has our failure mode of *not*
  running dependents' suites — turbo/affected graphs encode the dependency
  edges that our hand-rolled grep filters encode manually (and BRIEF-23
  showed can miss).
- **Action pinning splits cleanly by team scale:** SHA-pinned with version
  comments at Hono, Vitest, Astro, ruff, FastAPI — enforced by renovate
  `pinDigests` at three of them (`.github/renovate.json5` @ `ec367cf`,
  `296248c`, `2742f95`) — vs tag-pinned at tRPC, Zod, esbuild, ripgrep
  (ripgrep even pins `dtolnay/rust-toolchain@master`, a moving branch —
  `ci.yml` L128 @ `435f59f`). Toolchain pinning is universal in some form:
  `packageManager` field in every pnpm repo, `.tool-versions` (Hono),
  committed `go.version` (esbuild), `rust-toolchain.toml` = 1.97.1 (ruff),
  exact-node lint legs (Astro `24.15.0`).
- **Fork-PR posture:** default-deny permissions are the norm at the hardened
  end (`permissions: {}` workflow-level at Vitest, Astro, ruff, FastAPI;
  `contents: read` at Hono, ripgrep, esbuild); `persist-credentials: false`
  on every checkout at Vitest and ruff. `pull_request_target` appears
  **only in metadata/label-bot workflows** (tRPC labeler +
  dependabot-approve, Vitest label bots with written justification, Astro
  bots, FastAPI's 7 bot workflows each zizmor-annotated; zero uses at Zod,
  Hono, ripgrep, ruff, esbuild). Secret-bearing flows use `workflow_run`
  two-stage isolation (FastAPI Smokeshow/deploy-docs @ `95f8322`) or
  repo-equality guards (Hono benchmark comments, ruff paid runners, Astro
  cache priming). FastAPI goes furthest: a `guard-dependencies` workflow
  auto-closes any non-member PR touching `pyproject.toml`/`uv.lock`
  (`guard-dependencies.yml` @ `95f8322`).
- **Test-result artifacts are the exception:** coverage artifacts merged
  across legs (Hono, FastAPI); Vitest uploads per-leg blob reports merged
  into HTML reports (7-day retention, merge step itself report-only —
  `ci.yml` L163–348 @ `ec367cf`); ruff's `ecosystem-result` artifact feeds
  a PR-commenting bot (`ci.yaml` L734–741 @ `2742f95`). tRPC, Zod, Astro,
  ripgrep, esbuild upload nothing (greps 0 hits); Astro instead streams
  per-test timings via a custom `node:test` reporter
  (`scripts/testing/github-test-reporter.js` @ `296248c`).
- **Beyond-correctness gates at the high end:** type-check-perf and
  bundle-size regression tracking on every Hono PR (octocov +
  `tsc --diagnostics` — `.github/actions/perf-measures/action.yml` @
  `51db313`); CodSpeed benchmarks as PR jobs at ruff, Astro, FastAPI;
  tRPC's `monotest-build` job testing against built declaration files;
  FastAPI's `test-redistribute` running the full suite from inside the
  built sdist, and a **regression-proof job** that applies a PR's new tests
  to the base revision and warns if they already pass (`test.yml`
  L204–275 @ `95f8322`).

## Layer 8 — Supply chain

- **Audit gates: 0/9.** No `npm audit`/`pnpm audit`/`pip-audit`/
  `cargo-audit`/`cargo-deny` invocation in any workflow of any repo
  (verified per repo by workflow reads + greps; ruff and ripgrep also have
  no `deny.toml`).
- **Renovate at team scale (4/9):** tRPC (`config:base`, ignores examples,
  disables node/pnpm bumps — `.github/renovate.json` @ `dfbafa8`), Vitest
  (weekly, `group:allNonMajor`, `minimumReleaseAge: "1 day"` explicitly
  aligned with pnpm's supply-chain check — `renovate.json5` @ `ec367cf`),
  Astro (weekly, `minimumReleaseAge: "3 days"`, digest-pinning preset —
  `renovate.json5` @ `296248c`), ruff (weekly, dashboard, action
  `pinDigests: true` — `renovate.json5` @ `2742f95`). **Dependabot at
  FastAPI only** (monthly, 7-day cooldown, grouped, python restricted to
  dev deps — `.github/dependabot.yml` @ `95f8322`). **Nothing at Zod, Hono,
  esbuild, ripgrep** (verified absent) — the solo/small repos freeze and
  pin instead: esbuild's `go.mod` carries "Please do not change this"
  comments and oracle repos are cloned at hard-coded SHAs (`go.mod`,
  `Makefile` L743–746 @ `6ff1d8b`); ripgrep pins `cross` with an in-file
  rationale (`ci.yml` L43–46 @ `435f59f`).
- **Registry-side hardening (newest layer, 1/9):** Vitest sets pnpm
  `trustPolicy: no-downgrade` with an exception allowlist and verifies the
  lockfile once per CI run (`pnpm-workspace.yaml`, `ci.yml` L20–34 @
  `ec367cf`), plus npm provenance. Auto-merge of bot PRs exists at tRPC
  (`dependabot-approve.yml` auto-approves + squash-merges renovate/
  dependabot PRs @ `dfbafa8`).
- **Static security scanning:** Semgrep at Vitest (weekly) and Astro
  (weekly + per-PR, SHA-pinned container); CodeQL at tRPC; zizmor/actionlint
  as layer-6 noted. FastAPI's posture = SHA-pin everything + `uv sync
  --locked` + member-only dependency edits rather than scanners.

## Layer 9 — Flake / test-health tracking

- **No dashboards or flake-rate recording anywhere (0/9).**
- Observable mechanisms, by repo: ruff — committed ecosystem quarantine
  list + `--flaky-runs` re-execution, nextest slow-test surfacing
  (`final-status-level = "slow"`, 1s threshold) and daily fuzz auto-filing
  issues (`.config/nextest.toml`, `daily_fuzz.yaml` @ `2742f95`); Astro —
  warn-don't-fail carve-out for one flaky suite + per-test timing reporter
  (`ci.yml` L266–271, `scripts/testing/github-test-reporter.js` @
  `296248c`); tRPC — CI-only vitest retry 2 + Playwright retry 3 + advisory
  e2e layer (@ `dfbafa8`); Vitest — merged HTML reports for post-hoc
  inspection, on-demand ecosystem-ci triggered by permissioned comments
  (`ecosystem-ci-trigger.yml` @ `ec367cf`).
- **Scheduled full-suite crons as drift detection (4/9):** ripgrep nightly
  (`ci.yml` cron @ `435f59f`), FastAPI weekly (catches upstream drift via
  its starlette-git and `uv --resolution highest` legs — `test.yml` cron @
  `95f8322`), esbuild 6-hourly live install tests (`e2e.yml` @ `6ff1d8b`),
  ruff daily fuzz (`daily_fuzz.yaml` @ `2742f95`).

## Signals for BRIEF-82

Observed norms only — no adoption verdicts here; where cohort practice is
plainly a function of scale we don't have, that's flagged.

1. **Mutation testing and Gherkin/BDD have zero cohort adoption (0/9 each),
   including in the repos most famous for test discipline.** Their absence
   in our repo matches every surveyed peer, from solo Rust CLIs to
   company-scale linters.
2. **Coverage is not the cohort's rigor currency.** 6/9 don't measure it;
   the one hard bar (FastAPI 100%) is paired with a matching philosophy
   (executable docs, warnings-as-errors) rather than standing alone; the
   two Codecov users differ on shape (Hono fixed 75% project + informational
   patch; tRPC auto-target ratchet ±1% with patch off). Where coverage
   exists it is Codecov-status or CI-flag gated — never vitest-config
   `thresholds` (0/3 vitest-coverage users set them).
3. **The high-rigor repos spend the budget on execution realism and drift
   gates instead:** real-binary/multi-runtime/multi-arch execution
   (ripgrep-qemu, Hono runtimes, esbuild 3-OS), committed snapshots at
   scale (ruff insta, esbuild bundler snapshots), differential/ecosystem
   testing (ruff, Vitest ecosystem-ci — company-scale infrastructure), and
   generated-artifact freshness checks (4/9 fail CI on stale generated
   files) — the last being cheap at any scale.
4. **In-house lint plugins don't exist in this cohort; in-house *rules* do.**
   Architecture constraints are expressed as configured stock rules
   (`no-restricted-imports`/`no-restricted-syntax`, Biome per-path
   overrides, clippy `disallowed-methods`, even a grep in a Makefile) plus
   a dead-code/boundary tool (knip 2/5 TS repos, ts-prune, madge, cargo
   shear). Our oxlint-only setup has no equivalent of either mechanism yet;
   note oxlint's rule surface differs from ESLint's — the cohort's pattern
   is "stock engine + repo-specific restriction config", not custom
   engines.
5. **Test tiers are directories and CI jobs, not tags.** No repo uses
   marker/tag taxonomies for unit-vs-integration; several healthy repos
   (Zod, tRPC single job, ripgrep) don't segregate tiers in CI at all at
   sizes comparable to ours. E2E, where present, is always its own job.
6. **Flake posture: structural fixes over retries.** Unit-test retry
   appears once (tRPC); Playwright CI retries 2–3 are standard *only* at
   the browser layer; the rest serialize race-prone tests, pin flaky
   dependencies, or quarantine explicitly (committed list, warn-only step,
   advisory layer). No flake dashboards exist anywhere.
7. **Path-filtered CI is cohort-legitimate — including hand-rolled — but
   the disciplined implementations share three properties ours lacks:**
   filter lists include the workflow file and lockfiles themselves (ruff),
   dependency edges come from a graph (`turbo --filter` affected, pnpm
   filters) rather than hand-maintained greps, and required checks are
   reconciled via an aggregation job (`alls-green`,
   `required-checks-passed`). The cross-package gating gap we documented in
   BRIEF-23 is exactly the failure mode turbo-affected setups exist to
   close.
8. **Version pinning discipline correlates with contributor exposure:**
   repos expecting fork PRs at volume SHA-pin all actions (often
   renovate-enforced) and default-deny permissions; solo repos tag-pin and
   freeze dependencies manually. All pnpm repos pin via `packageManager`;
   our current CI resolves pnpm from that same field.
9. **Supply chain: no audit gates anywhere; the enforced practices are
   pin-everything + frozen lockfiles, renovate/dependabot with a
   release-age cooldown (1–7 days) at team scale, and — in the newest
   configs — workflow-security linting (zizmor 4/9) and pnpm
   trust-policy/provenance (Vitest).** Solo-repo practice is explicitly
   "no bots, freeze and pin".
10. **Fork-PR posture norms:** `pull_request_target` only for
    metadata bots, never for code execution; secrets isolated via
    `workflow_run` stages or repo-equality guards; the strictest peer
    (FastAPI) mechanically refuses outsider dependency-file edits. Directly
    relevant to our post-cutover OSS-contributor expectation.
11. **Scheduled cron runs of the full suite (4/9) serve as the cohort's
    drift/flake detector** in place of any tracking tooling — cheap, and
    independent of scale.

## Sources

All fetched 2026-08-01 from `git clone --depth 1` of the default branch;
HEAD SHAs as in the cohort table. File references resolve as
`https://github.com/<owner>/<repo>/blob/<sha>/<path>`.

- trpc/trpc @ `dfbafa8ef178a5a3d23ef9461caa9494b3ef7f95` — `.github/workflows/{main,lint,labeler,dependabot-approve,codeql-analysis,semantic-pr}.yml`, `vitest.config.ts`, `codecov.yml`, `eslint.config.js`, `prettier.config.js`, `tsconfig.build.json`, `turbo.json`, `package.json`, `.github/renovate.json`, `.github/setup/action.yml`, `examples/next-prisma-starter/{playwright.config.ts,package.json}`, `CONTRIBUTING.md`, `.github/CODEOWNERS`, `.github/FUNDING.yml`
- colinhacks/zod @ `912f0f51b0ced654d0069741e7160834dca742ee` — `.github/workflows/{test,release,stale,claude,claude-code-review,pullfrog}.yml`, `vitest.config.ts`, `biome.jsonc`, `.configs/tsconfig.base.json`, `package.json`, `packages/{integration,resolution,zod}/package.json`, `.husky/{pre-commit,pre-push}`, `scripts/{fail-on-console.ts,check-versions.ts}`, `CONTRIBUTING.md`, `FUNDING.yml`
- honojs/hono @ `51db3131d5e97076327edaa0afdb60ebb77c264f` — `.github/workflows/{ci,autofix,cr,no-response}.yml`, `.github/actions/perf-measures/action.yml`, `vitest.config.ts`, `runtime-tests/*/vitest.config.ts`, `codecov.yml`, `bunfig.toml`, `eslint.config.mjs`, `tsconfig.base.json`, `tsconfig.build.json`, `package.json`, `.tool-versions`, `docs/CONTRIBUTING.md`
- vitest-dev/vitest @ `ec367cf2a6c955da8304e8cea935d1f3dc034a98` — `.github/workflows/{ci,knip,zizmor,semgrep,cr,ecosystem-ci-trigger,pr-labeled-automated}.yml`, `.github/renovate.json5`, `.github/zizmor.yml`, `eslint.config.js`, `knip.jsonc`, `tsconfig.base.json`, `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `test/e2e/vitest.config.ts`, `test/ui/playwright.config.ts`, `test/browser/{package.json,docker-compose.yaml}`, `packages/vitest/package.json`, `AGENTS.md`, `CONTRIBUTING.md`
- withastro/astro @ `296248cb39e9e2cc3c0896441df75edb2d3b3959` — `.github/workflows/{ci,format,check,scripts,continuous_benchmark,semgrep,zizmor,check-merge,label,diff-dependencies}.yml`, `.github/renovate.json5`, `biome.jsonc`, `eslint.config.js`, `knip.js`, `prettier.config.mjs`, `configs/tsconfig.base.json`, `tsconfig.json`, `package.json`, `packages/astro/{package.json,playwright.config.js,playwright.firefox.config.js}`, `scripts/cmd/test.js`, `scripts/turbo-run-affected.js`, `scripts/testing/github-test-reporter.js`, `CONTRIBUTING.md`, `AGENTS.md`
- evanw/esbuild @ `6ff1d8b0d8c134e867a397eef39702a223ebef9e` — `Makefile`, `.github/workflows/{ci,e2e,validate,publish}.yml`, `go.mod`, `go.version`, `staticcheck.conf`, `internal/bundler_tests/bundler_test.go`, `scripts/{end-to-end-tests.js,package.json}`, `docs/development.md`, `RUNBOOK.md`
- BurntSushi/ripgrep @ `435f59fc4b43af3ab32f34d53fa34978f393fe52` — `.github/workflows/{ci,release}.yml`, `Cargo.toml`, `rustfmt.toml`, `tests/{tests.rs,util.rs}`, `fuzz/{Cargo.toml,fuzz_targets/fuzz_glob.rs}`, `ci/test-complete`, `CONTRIBUTING.md`, `AI_POLICY.md`
- astral-sh/ruff @ `2742f956d87314cf1522c69c9a95a71d972bd76c` — `.github/workflows/{ci,daily_fuzz,typing_conformance,ty-ecosystem-analyzer,ty-ecosystem-report,zizmor}.yaml|yml`, `.github/renovate.json5`, `.github/zizmor.yml`, `Cargo.toml` (`[workspace.lints]`), `clippy.toml`, `rustfmt.toml`, `rust-toolchain.toml`, `.config/nextest.toml`, `.pre-commit-config.yaml`, `crates/ty_python_semantic/resources/primer/flaky.txt`, `crates/ruff_dev/src/main.rs`, `fuzz/fuzz_targets/`, `CONTRIBUTING.md`
- fastapi/fastapi @ `95f8322ee1dcda7ceace7b1c4f6c9915b36d748f` — `.github/workflows/{test,smokeshow,pre-commit,zizmor,guard-dependencies,build-docs,deploy-docs,labeler,issue-manager,latest-changes,notify-translations,add-to-project,detect-conflicts,test-redistribute,bump-pre-commit-hooks}.yml`, `.github/dependabot.yml`, `pyproject.toml`, `.pre-commit-config.yaml`, `scripts/{test.sh,lint.sh}`, `tests/utils.py`, `docs/en/docs/{management,contributing}.md`
- This repo (working tree @ `main`, 2026-08-01): `.github/workflows/ci.yml`, `package.json`, `apps/web/package.json`, `packages/*/package.json`, `git ls-files` greps (test-file count, absence of vitest configs / playwright / stryker / `.feature` / dependabot / renovate)
