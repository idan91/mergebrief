# Pre-release testing

The consolidated pass to run before calling a build releasable. Layered:
run layer 0 always; layers 1–3 before a release, after infra changes, or
after anything touching their surface. Deep walkthroughs live in their own
docs — this page is the index of use cases and what "pass" means for each.

Last consolidated: 2026-07-15 (post-BRIEF-43).

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
- [ ] Author self-review surface (BRIEF-43; needs a **draft** PR you author,
      with a generated Brief, plus a second account for the non-author check).
      Full walkthrough: [`brief-43-testing.md`](./brief-43-testing.md). Fast
      pass:
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
- [ ] Draft generation policy (BRIEF-64; needs a **draft** PR you author +
      edits to `mergebrief.config.yaml`'s `drafts:` block — restart web AND
      worker after each config change; both read the file):
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
      - invalid values (e.g. `debounceSeconds: -5`, unknown key in
        `drafts:`) → web and worker both REFUSE boot with a `drafts:`-
        prefixed issue, secrets never echoed;
      - a non-author viewing the same draft sees no policy copy anywhere.
- [ ] Access control spot checks: `/api/*` 401 signed-out; inaccessible
      repo id → 404 (never 403); audit line in the web log.

CLI (`mergebrief`, BRIEF-17):
- [ ] Mint a token in the web app → `pr` → `groups` → `diff --group` →
      `submit` round-trip against the deployment; `--json` exit codes per
      the contract table. Setup: [`../self-host/cli.md`](../self-host/cli.md).
- [ ] Agent-driven pass: point an AI coding agent (e.g. Claude Code) at a
      briefed PR with only the CLI on PATH, a minted token, and the prompt
      "review this PR with mergebrief" — no other coaching. Pass = the
      agent completes the `pr` → `groups` → `diff --group` → `submit`
      round-trip unaided from `--help` and `--json` output alone, and never
      needs a human to interpret an error. Anywhere it stalls or
      misreads output (ambiguous help text, unparseable error, exit code
      contradicting the contract table) is a CLI usability defect — file it
      against the CLI, not the agent.

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
