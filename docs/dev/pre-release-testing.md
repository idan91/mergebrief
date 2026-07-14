# Pre-release testing

The consolidated pass to run before calling a build releasable. Layered:
run layer 0 always; layers 1–3 before a release, after infra changes, or
after anything touching their surface. Deep walkthroughs live in their own
docs — this page is the index of use cases and what "pass" means for each.

Last consolidated: 2026-07-13 (post-BRIEF-11).

---

## Layer 0 — automated gates (minutes, no auth, no spend)

```sh
pnpm install
pnpm -r test          # all workspace suites
pnpm lint             # repo-root oxlint --type-aware; exit code is the judge
pnpm -C apps/web lint # prettier + stylelint
```

- [ ] Every package suite green: `generators`, `worker`, `api`, `github`,
      `persistence`, `cli`, `apps/web`, `tools/categorizer`.
- [ ] Known flake: `persistence` dev-db timeouts (different tests each
      run) — restart the compose Postgres and re-run before trusting a red.
- [ ] CI green on the release commit (when billing works) — CI is
      path-filtered per package, so a local `pnpm -r test` is the only run
      that exercises cross-package contract changes together.

## Layer 1 — deployed stack end-to-end (compose + webhook loop)

Full walkthrough: [`brief-19-smoke.md`](./brief-19-smoke.md) (~30–40 min,
spends real tokens). Tunnel/App plumbing: [`webhook-loop.md`](./webhook-loop.md).
Build caveats: foreground `docker compose build` (keychain fails
sandboxed/backgrounded; never pipe the build output).

Core lifecycle:
- [ ] `docker compose up -d` → postgres/web/worker all running; migrations
      apply idempotently at boot.
- [ ] Push to an open PR → webhook 200 → ONE debounced generate job →
      Brief appears without manual reload (queued → generating → rendered).
- [ ] Push mid-generation → run recorded `superseded` (not failed), newer
      head generates; `attempts` untouched.
- [ ] Exactly ONE branded Entry comment on the PR thread, replaced (never
      duplicated) on the next settled push, deep-linking the exact span
      (BRIEF-22).

Reviewer surface:
- [ ] GitHub OAuth login → picker rows with status pills; org switcher
      (remembered default binding; bogus installation POST → 403).
- [ ] Deep link in a fresh private window → auth redirect → brief; SSR
      first paint; `cache-control: no-store`; malformed spans → 404 /
      normalized.
- [ ] Second revision → compare bar: Previous Brief highlights via
      marks/narrative endpoints; head-advance banner never auto-swaps the
      page (BRIEF-19/21).
- [ ] Revisions timeline: walk briefed heads, thread-jump into
      conversation (BRIEF-24/25); "Your last review" enables only after a
      submitted checkpoint (BRIEF-21/23).
- [ ] Outdated-thread jump specifics (folded from BRIEF-29; needs a real
      multi-revision PR with outdated review threads):
      - anchor sha IS a briefed revision → "Jump to revision" lands on
        `?head=<anchor>&thread=<id>`, conversation open, target row
        revealed even behind the show-more cap / inside collapsed bot
        groups, and focused;
      - anchor sha never briefed (common — debounce) → affordance disabled
        with a reachable reason + GitHub permalink fallback, no
        nearest-revision guessing;
      - reduced-motion: landing snaps instead of smooth-scrolling.
      Any defect becomes its own fix PR.
- [ ] Review submit: comments post to GitHub, checkpoint written by the
      webhook (commit_id pinned, bots filtered), submitted comments go
      read-only locally, verdict spent on success (BRIEF-23/25).
- [ ] Access control spot checks: `/api/*` 401 signed-out; inaccessible
      repo id → 404 (never 403); audit line in the web log.

CLI (`mergebrief`, BRIEF-17):
- [ ] Mint a token in the web app → `pr` → `groups` → `diff --group` →
      `submit` round-trip against the deployment; `--json` exit codes per
      the contract table. Setup: [`../self-host/cli.md`](../self-host/cli.md).

## Layer 2 — generator backends (BRIEF-11; live auth + spend, manual-only)

Recipe with per-adapter checklists and the exact commands:
[`generator-smoke-recipe.md`](./generator-smoke-recipe.md). NEVER wire any
of these into vitest or CI.

### Accounts & credentials needed (one per adapter)

| adapter | needs | notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | the deploy default — already required by Layer 1 |
| `claude-code` | Claude subscription + `claude /login` | interactive OAuth/keychain; no API key |
| `codex` | ChatGPT subscription + `codex login` | interactive; subject to the plan's usage limits |
| `openai` | OpenAI **API** key (platform.openai.com, prepaid) | ChatGPT subscription does NOT cover it; a smoke costs cents |
| `openrouter` | OpenRouter account + small prepaid credit (~$5 min) | one key smokes both the structured-outputs slug and the refusal arm |

No account for an adapter → record that adapter as **SKIPPED (no account)**
in the pass record rather than faking coverage; the contract/SSE-fixture
suites still cover its logic, but the live wire stays unverified — say so
honestly in the release notes. (The `openai` `baseUrl` escape hatch is its
own checklist arm, not a substitute for the native smoke.) An OpenRouter
key is the cheapest way to close most of the gap: it natively covers
`openrouter` and can also exercise `openai`'s compatible-server arm via
`baseUrl: https://openrouter.ai/api/v1`.

- [ ] Live smoke per adapter you ship (`pnpm -C packages/generators smoke
      -- --adapter …`): boot probe passes, provenance honest (effort
      echoed/null per adapter; `codex-default` when unconfigured), output
      schema-valid, warnings explainable. Adapters: `anthropic`,
      `claude-code` (needs `claude /login`), `codex` (needs `codex login`),
      `openai` (try one reasoning + one non-reasoning model — the second
      must log knob discovery and stamp `effort: null`), `openrouter`
      (one structured-outputs slug; one WITHOUT must refuse boot).
- [ ] Config surface (`docs/self-host/generators.md`): a good
      `mergebrief.config.yaml` through `pnpm categorize --config …`; then
      each refusal arm — bad provider, missing key var, unknown key,
      missing CLI binary, set-but-empty `MERGEBRIEF_CONFIG` — refuses with
      per-field issues, values never echoed.
- [ ] Worker + web with `MERGEBRIEF_CONFIG` pointing at a BAD file refuse
      at boot (compose logs show the per-field issues).
- [ ] Zero-config compose boot (only `ANTHROPIC_API_KEY` set) still
      generates a Brief end-to-end — the no-file default is the
      pre-BRIEF-11 behavior exactly.
- [ ] ONE deliberate hung-run kill against a real CLI per release:
      watchdog fires, `timeout`-kind error with redacted stderr tail,
      `pgrep` shows no orphans (recipe §"The deliberate hung-run kill").
- [ ] After a `claude`/`codex` CLI version upgrade: re-run that adapter's
      smoke (envelopes are documented-but-unpromised; also re-verify
      claude's `modelUsage` metric casing vs the shim — impl-notes item).
- [ ] UI surfacing: a Brief generated through a CLI adapter shows
      `via <provider> (local CLI)/<model>` in the header; force a salvage
      or mismatch (or reuse one seen in the smokes) and confirm the amber
      `generationWarnings` block renders on the artifact.

## Layer 3 — local dev loop (no Docker, quick confidence)

- [ ] `pnpm dev` → paste a public PR URL → Generate → Brief renders; same
      head reuses the cached artifact (no second spend).
- [ ] `pnpm categorize <pr-url>` and `pnpm delta <pr-url> <base> <head>`
      produce artifacts under `tools/categorizer/out/`.
- [ ] Story/Concern views, Risk Surface chips, Receipt drawer, busy-header
      menu semantics (keyboard: menu focus, Escape-returns-to-trigger —
      BRIEF-14/27/28) spot-checked on the generated Brief.

---

## Failure protocol

Fix-forward on `main` (small PR; one-liners may go direct per the
docs-on-main convention). For generation failures, the raw model output of
every failed attempt is dumped to the failure dir
(`<label>-*.failed.json`) — start there before re-running anything that
spends.
