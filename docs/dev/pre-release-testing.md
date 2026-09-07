# Pre-release testing

The pass to run before calling a build releasable. Two halves: the **gates
index**, everything a machine already proves — run it, read the exit code —
and the **residual manual walkthrough**, which is only what no gate can reach.

Every walkthrough step carries exactly one disposition tag (ADR 0038 §11):
`manual-until: <ticket/trigger>` names what will retire it, `manual-forever:
<reason>` says why nothing will. Steps that became `automated:` are gone from
the walkthrough and folded into the gates index. The residual is meant to
shrink — when a trigger fires, move the step, don't keep both copies.

Last consolidated: 2026-08-03 (BRIEF-113 browser-suite dispositions).

---

## Gates that must be green

```sh
pnpm install
pnpm -r test        # every package suite + the 75% line floor per package (BRIEF-110)
pnpm lint           # oxlint --type-aware · eslint sliver · knip · prettier · stylelint (BRIEF-111)
pnpm -r typecheck   # every package tsconfig
pnpm -C apps/web test:e2e   # chromium browser suite + axe-core (BRIEF-113)
```

Exit code is the judge for all four. What they cover that this page used to
walk by hand:

- Every package suite green — `generators`, `worker`, `api`, `github`,
  `persistence`, `cli`, `apps/web`, `brief-core`, `repo-config`, `logging`,
  `tools/categorizer` — each against its own coverage floor.
- Access control on the reviewer API: `/api/*` 401 signed-out, an
  inaccessible repo id → 404 (never 403 — no existence leak), the `auth`
  audit row, and the negative not being cached (`apps/api`).
- CLI exit codes against the contract table, `--json` shapes, stderr
  fidelity (`apps/cli`).
- Generator config refusals — bad provider, unknown key, missing key var,
  missing CLI binary, set-but-empty `MERGEBRIEF_CONFIG`, invalid `drafts:`
  block — with values never echoed (`packages/generators`).
- The reviewer surface in a real browser (E2E v1, `apps/web/e2e`): the
  committed fixture brief renders through the real server with no console
  errors; View/Compare deep links resolve, normalize an unavailable pair and
  fall back on an unrecognized one; chunk cards, the PR-description
  disclosure, the risk-attribute rail jump and the shortcuts modal behave;
  read-through snaps instead of smooth-scrolling under reduced motion; and
  axe-core finds no serious/critical violation on any of those states
  (picker, both revisions, Changes Only, shortcuts dialog, receipt drawer).
  Unauthenticated fixture path only — the DB loader is BRIEF-118.
- Repo-config parsing (`packages/repo-config`): `.mergebrief/settings.yaml`
  and `policy.yaml` reject on any unknown or bad field (strict schemas);
  `instructions.md` has no schema and is gated only by its byte budget; an
  absent file is reported absent, never defaulted into existence.

Not gates yet:

- [ ] CI green on the release commit — `manual-until: BRIEF-37 + BRIEF-112`
      (CI billing, then the affected-filter overhaul). Until then CI is
      path-filtered per package, so a local `pnpm -r test` is the only run
      that exercises cross-package contract changes together.
- [ ] Eval report in the PR body for generation-surface changes —
      `manual-until: BRIEF-112` (the presence check is designed, not live).
      The harness itself stays a convention gate and never enters CI: live
      spend.

---

## Residual manual walkthrough

### Deployed stack — compose + webhook loop

Full walkthrough: [`brief-19-smoke.md`](./brief-19-smoke.md) (~30–40 min,
spends real tokens). Tunnel/App plumbing: [`webhook-loop.md`](./webhook-loop.md).
Build caveats: foreground `docker compose build` (keychain fails
sandboxed/backgrounded; never pipe the build output).

Each of the four steps below carries the same tag —
`manual-until: full-loop E2E (ADR 0038 §4 park — trigger: the first
webhook-spine regression the piecewise integration tests miss; it also needs
a fake generator adapter, which does not exist yet)` — stated once here
rather than repeated four times.

- [ ] `docker compose up -d` → postgres/web/worker all running; migrations
      apply idempotently at boot.
- [ ] Push to an open PR → webhook 200 → ONE debounced generate job → Brief
      appears without manual reload (queued → generating → rendered).
- [ ] Push mid-generation → run recorded `superseded` (not failed), newer
      head generates; `attempts` untouched.
- [ ] Exactly ONE branded Entry comment on the PR thread, replaced (never
      duplicated) on the next settled push, deep-linking the exact span
      (BRIEF-22).

### External Postgres (BRIEF-131)

Setup: a managed-provider database (Neon/Supabase free tier is enough),
`docker-compose.external-db.yml`, recipes in
[`../self-host/compose.md`](../self-host/compose.md#external-postgres-managed-database).
The refusal/precedence LOGIC (TLS gate matrix, `_FILE` precedence, the
check-only ledger comparison) is all in the gates index
(`packages/persistence` config + migration-check suites); what stays manual
is the real wire — provider TLS handshakes, CA chains, and role models are
exactly what the PGlite-based suites cannot see. Every step carries the same
tag — `manual-forever: needs a live managed provider; re-run on a pg /
pg-connection-string bump or an external-db compose change, not every
release` — stated once here.

- [ ] TLS refusal fires: provider DSN with NO `sslmode` → worker refuses
      boot naming the three choices; no DSN echoed in the log.
- [ ] Connects verified: `?sslmode=verify-full` (+`sslrootcert` via the CA
      mount if the provider's chain needs pinning — record which it was)
      → worker boots, web `/readyz` 200.
- [ ] Auto-migrate applies on first boot against the fresh provider DB;
      second boot no-ops.
- [ ] `MERGEBRIEF_AUTO_MIGRATE=false` against a behind DB → worker refuses
      with the pending count + the manual command; web stays on `/healthz`
      but `/readyz` red / first API request 503.
- [ ] The refusal's manual command (DDL-capable DSN, host-absolute
      `sslrootcert` if pinned) → worker starts clean on restart; web
      recovers WITHOUT restart.
- [ ] `DATABASE_URL_FILE` via the compose `secrets:` blocks boots; with
      BOTH variables set the boot warning names the shadowed
      `DATABASE_URL`.

### Reviewer surface

- [ ] GitHub OAuth login → picker rows with status pills; org switcher
      (remembered default binding; bogus installation POST → 403).
      `manual-forever: a real user-to-server OAuth consent against a real
      GitHub App — no hermetic surface can mint one.`
- [ ] Deep link in a fresh private window → auth redirect → brief; SSR first
      paint; `cache-control: no-store`; malformed spans → 404 / normalized.
      `manual-until: BRIEF-118` — the seeded E2E suite covers first paint
      and View/Compare normalization on the repo route with a seeded
      session; the auth redirect and the `no-store` header still wait for
      the seeded-session slice.
- [ ] Second revision → compare bar: Previous Brief highlights via
      marks/narrative endpoints; head-advance banner never auto-swaps the
      page (BRIEF-19/21). `manual-until: BRIEF-118` (E2E v2 slice — v1's
      comparison coverage is the local fixture's Changes Only span, not the
      DB-backed compare bar).
- [ ] Revisions timeline: walk briefed heads, thread-jump into conversation
      (BRIEF-24/25); "Your last review" enables only after a submitted
      checkpoint (BRIEF-21/23). `manual-until: BRIEF-118` — the conversation
      section is route-injected and absent on the local path, so thread-jump
      moved out of E2E v1 with the checkpoint arm. v1 does cover walking the
      revision timeline on the local fixture.
- [ ] Outdated-thread jump specifics (folded from BRIEF-29; needs a real
      multi-revision PR with outdated review threads) —
      `manual-until: BRIEF-118` for the DOM behaviour too (no conversation
      section on the unauthenticated path), and the real-PR arms ride the
      E2E v2 trigger:
      - anchor sha IS a briefed revision → "Jump to revision" lands on
        `?head=<anchor>&thread=<id>`, conversation open, target row
        revealed even behind the show-more cap / inside collapsed bot
        groups, and focused;
      - anchor sha never briefed (common — debounce) → affordance disabled
        with a reachable reason + GitHub permalink fallback, no
        nearest-revision guessing;
      - reduced-motion: landing snaps instead of smooth-scrolling. (E2E v1
        pins the reduced-motion contract on the brief screen's own scroller;
        the thread-landing path is not reachable there.)
      Any defect becomes its own fix PR.
- [ ] Review submit: comments post to GitHub, checkpoint written by the
      webhook (commit_id pinned, bots filtered), submitted comments go
      read-only locally, verdict spent on success (BRIEF-23/25).
      `manual-forever: writes land on a real PR thread through a real App
      installation; the hermetic suites stop at the octokit boundary.`
- [ ] Author self-review surface (BRIEF-43). Full walkthrough:
      [`brief-43-testing.md`](./brief-43-testing.md). Fast pass:
      `manual-forever: needs a draft PR you author plus a SECOND GitHub
      account for the non-author arm — two real identities against one
      installation.`
      - own-draft state renders for the author (chip "Self-review — your
        draft", submit/receipt hidden, flags read-only, mark-ready CTA) and
        the same PR is a plain reviewer view for a non-author — no "mode"
        wording anywhere;
      - soft gate lists current-head flags (zero flags → skipped; historical
        revision → chip stays, CTA disabled, no gate);
      - mark-ready flips the PR non-draft on GitHub and the surface converges
        to reviewer view; `converted_to_draft` returns it WITHOUT regenerating;
      - post-now on an own-draft inline comment posts to GitHub (commit_id
        pinned) and renders as a "yours" thread; the reviewer composer stays
        private-until-submit (ADR 0004 — a "Post" button in reviewer state is a
        hard regression).
- [ ] Draft generation policy (BRIEF-64; edits to `mergebrief.config.yaml`'s
      `drafts:` block — restart web AND worker after each change; both read
      the file). `manual-forever: the real draft lifecycle — GitHub's own
      mark-ready button, converted_to_draft, close-then-reopen — only exists
      on a real PR. The config parsing and refusal arms are already in the
      gates index.`
      - no `drafts:` block (or no file) → drafts generate on the normal
        window; nothing changed from before;
      - `drafts: { debounceSeconds: 900 }` → a FRESH draft's first brief
        still arrives on the normal window; a push after that brief shows
        the queued heading "can take up to about 15 minutes" (own-draft
        view only) and the job's `run_at` sits ~15 min out (check
        `graphile_worker.jobs`);
      - mark ready (our CTA or GitHub's button) while the damped job is
        pending → exactly ONE job remains, `run_at` ~10s out; brief is
        fresh when the reviewer arrives;
      - a submitted review on the damped draft re-queues on the NORMAL
        window (reviews never damp);
      - `drafts: { generate: off }` → a new draft push writes the PR row
        but NO generation row and NO job; the PR page still renders
        conversation/meta, and the author sees the "off on this instance —
        …marked ready" empty-state copy; mark ready → the first brief
        generates; a review on the draft writes its checkpoint but does
        not enqueue; close then REOPEN the draft → the PR returns to open
        (the wedge regression);
      - `generate: off` beats repo `entryCommentOnDrafts: true` (no brief
        → no entry comment on the draft, automatically);
      - a non-author viewing the same draft sees no policy copy anywhere.

### CLI (`mergebrief`, BRIEF-17)

- [ ] Mint a token in the web app → `pr` → `groups` → `diff --group` →
      `submit` round-trip against the deployment. Setup:
      [`../self-host/cli.md`](../self-host/cli.md).
      `manual-forever: a real deployment, a real minted token and real
      review writes; the suite covers the same commands against the api app
      in-process.`
- [ ] Agent-driven pass: point an AI coding agent (e.g. Claude Code) at a
      briefed PR with only the CLI on PATH, a minted token, and the prompt
      "review this PR with mergebrief" — no other coaching. Pass = the
      agent completes the `pr` → `groups` → `diff --group` → `submit`
      round-trip unaided from `--help` and `--json` output alone, and never
      needs a human to interpret an error. Anywhere it stalls or misreads
      output (ambiguous help text, unparseable error, exit code
      contradicting the contract table) is a CLI usability defect — file it
      against the CLI, not the agent.
      `manual-forever: the pass condition is whether an unaided agent finds
      the surface legible — a judgement no assertion expresses.`

### Generator backends (BRIEF-11; live auth + spend)

Recipe with per-adapter checklists and the exact commands:
[`generator-smoke-recipe.md`](./generator-smoke-recipe.md). NEVER wire any of
these into vitest or CI. Every step in this section carries the same tag —
`manual-forever: live provider auth (OAuth keychains, auth.json, API keys)
and real spend; ADR 0038 keeps live-spend surfaces out of CI permanently` —
stated once here rather than repeated six times.

#### Accounts & credentials needed (one per adapter)

| adapter | needs | notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | the deploy default — already required by the compose walkthrough |
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
      -- --adapter …`): startup check passes, origin honest (effort
      echoed/null per adapter; `codex-default` when unconfigured), output
      schema-valid, warnings explainable. Adapters: `anthropic`,
      `claude-code` (needs `claude /login`), `codex` (needs `codex login`),
      `openai` (try one reasoning + one non-reasoning model — the second
      must log knob discovery and stamp `effort: null`), `openrouter`
      (one structured-outputs slug; one WITHOUT must refuse boot).
- [ ] Zero-config compose boot (only `ANTHROPIC_API_KEY` set) still
      generates a Brief end-to-end — the no-file default is the
      pre-BRIEF-11 behavior exactly.
- [ ] Worker + web with `MERGEBRIEF_CONFIG` pointing at a BAD file refuse
      at boot (compose logs show the per-field issues). The refusals
      themselves are in the gates index; what stays manual is that the
      containers surface them instead of booting degraded.
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

### Local dev loop (no Docker, quick confidence)

- [ ] `pnpm dev` → paste a public PR URL → Generate → Brief renders; same
      head reuses the cached artifact (no second spend).
      `manual-forever: generates against a live model — real spend.`
- [ ] `pnpm categorize <pr-url>` and `pnpm delta <pr-url> <base> <head>`
      produce artifacts under `tools/categorizer/out/`.
      `manual-forever: same — live spend.`
- [ ] Concern view and the busy-header menu keyboard semantics (menu focus,
      Escape-returns-to-trigger — BRIEF-14/27/28) spot-checked on the
      generated Brief. `manual-until: BRIEF-118` — reachable without auth,
      simply not in the v1 spec set.

---

## Failure protocol

Fix-forward on `main` (small PR; one-liners may go direct per the
docs-on-main convention). For generation failures, the raw model output of
every failed attempt is dumped to the failure dir
(`<label>-*.failed.json`) — start there before re-running anything that
spends.
