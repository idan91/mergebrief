# Pre-release testing

The pass to run before calling a build releasable. Two halves: the **gates
index**, everything a machine already proves (run it, read the exit code),
and the **residual manual walkthrough**, which is only what no gate can
reach.

Every walkthrough step carries exactly one disposition tag, the convention
of the test-gate ADR: `manual-until: <trigger>` names what will retire it,
`manual-forever: <reason>` says why nothing will. Steps that became
`automated:` are gone from the walkthrough and folded into the gates
index. The residual is meant to shrink: when a trigger fires, move the
step, do not keep both copies.

Last consolidated: 2026-10-03 (the version notice, the one image, the
release flow).

---

## Gates that must be green

On the node version `.nvmrc` names, with a Docker daemon running:

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test                  # every member suite, each against its committed line floor
pnpm lint                     # oxlint (type-aware, i18next) · depcruise · knip · prettier · stylelint · check:catalog · check:config · check:migrations · check:releases · check:baselines
pnpm -r build                 # the CLI bundle and the web build
pnpm -C apps/cli docs:check   # the README's flag appendix matches the program
pnpm audit --prod --audit-level=high
pnpm -C apps/web test:e2e     # chromium over a disposable Postgres container
```

Exit code is the judge for every line. Root `pnpm test` is the categorizer
alone; `-r` is what runs the workspace. The standard line floor is 75; the
api carries 85 and the categorizer a temporary 60. `packages/types` has no
suite. When a packaging file changed (`Dockerfile`, `docker-entrypoint.sh`,
`.dockerignore`, `pnpm-workspace.yaml`, a lockfile), also build the image
and run its entrypoint with a bogus word: it must exit 1 and print the four
words `api | web | worker | migrate`.

```sh
docker build -t mergebrief:pr . && docker run --rm mergebrief:pr bogus
```

What the gates cover that this page used to walk by hand:

- Every member suite with a `test` script, against its own floor.
- Access control on the reviewer API: `/api/*` 401 signed out, a row held
  by an unreachable installation answers 404 (never 403, no existence
  leak), the denial is audited, and the negative is not cached.
- CLI exit codes against the contract table, `--json` shapes, stderr
  fidelity, `--version`, the skew lines, the daily update nag's cadence and
  cache.
- Generator config refusals (bad provider, unknown key, missing key var,
  missing CLI binary, set-but-empty `MERGEBRIEF_CONFIG`, invalid `drafts:`
  block) with values never echoed.
- Repo-config parsing: `.mergebrief/settings.yaml` and `policy.yaml` reject
  any unknown or bad field; `instructions.md` is gated only by its byte
  budget; an absent file is reported absent, never defaulted.
- The version notice's machinery: the api's daily fetch, the gap flags
  (`breaking`, `security`), the byte cap, the `update.available` log line,
  `GET /api/version` and the dismiss write, the `MergeBrief-Version` header,
  the `instance_version` row, and the expand-and-contract migration lint.
  The band, its dismissal, the Account menu row and dot, and the amber
  security state are covered at component level only: the browser suite's
  API runs as `dev`, which never checks.
- The release tool: notes-file parsing and placement, the stamp and the
  manifest prune, `version.json` and the Release body from the notes files,
  and the argv grammar. `check:releases` inside `pnpm lint` refuses a
  malformed notes file on the PR.
- The browser suite (`apps/web/e2e`): a seeded database with the fixture
  briefs, a signed-in session for the chromium project and a separate
  signed-out project. Home states (empty Inbox, filtered to nothing,
  merged and closed rows hidden, no reachable installation, a failed list
  and Try again), the Inbox (fold, mark, status, Generate waits for a URL,
  archive, bulk archive and delete counts, admin-only Delete, no sideways
  scroll at 320px), the brief (renders with no browser faults, not-found
  state, chunk cards, PR description, risk-attribute jump, shortcuts modal,
  focus mode, chunk strip), deep links (Changes Only, Previous brief, bogus
  params, normalize-down with "Your last review" disabled, the Revisions
  tab, rev, span, chunk, line, range and folded-line links, an unlandable
  line link, the tab title), review from Changes Only (card comment, span
  diff comment, dismissed flag), the signed-out landing, and axe-core with no serious or critical
  violation on the picker, both revisions, Changes Only, the shortcuts
  dialog and the submit modal.

Not gates yet:

- [ ] CI green on the release commit. `manual-until: Actions billing is on`.
      CI runs changed packages and their dependents behind one aggregate
      check, so a release commit still runs every line above locally.
- [ ] An eval report in the PR body for a generation-surface change. The
      presence job checks the body on those paths once billing is on; the
      harness itself is human-run and never enters CI (live spend).
      `manual-forever: live spend`.

How a release is published: [`releasing.md`](./releasing.md).

---

## Residual manual walkthrough

Run the deployed-stack sections against the release candidate's published
artifacts, not a source build: a source build reports `dev`, never checks
for releases and never shows the version notice. The candidate flow is in
[`releasing.md`](./releasing.md#release-candidates); until the ghcr package
is public, the host needs `docker login ghcr.io` first.

### Release artifacts

- [ ] The dispatch rehearsal: Actions, Release, Run workflow, `version` set
      to an unpublished version whose notes file exists. Every job runs,
      nothing publishes, and the artifact holds both compose files pinned to
      that version, `.env.example`, the Release body, and `version.json`
      when the rehearsed version is the highest stable one.
      `manual-until: Actions billing is on` (then it is the first thing to
      run after every change to `release.yml` or `tools/release`).
- [ ] The candidate tag `vX.Y.Z-rc.N`: npm holds the version under `next`
      (or `superseded` when a newer tag already exists), the Release is a
      prerelease with both compose files pinned to the exact tag plus
      `.env.example` and no `version.json`, and `latest` moved nowhere (npm,
      ghcr, the Releases page). `npm i -g mergebrief@next` installs it and
      `mergebrief --version` prints the candidate.
      `manual-forever: a real tag against the real registries`.
- [ ] The stable tag: `latest` on npm, on ghcr and on the Releases page;
      `releases/latest/download/version.json` lists the release with its
      `breaking` and `security` flags; `npm i -g mergebrief` installs it.
      `manual-forever: same`.
- [ ] Re-running the tag's workflow after a success changes nothing: npm
      skips the version, the Release keeps its assets, the image is rebuilt
      and re-pushed under the same tag. `manual-forever: same`.

### The image

Each step carries `manual-forever: needs the pulled image from ghcr; the CI
smoke builds from source and never pulls`.

- [ ] `docker manifest inspect ghcr.io/idan91/mergebrief:<X.Y.Z>` (the
      version, no `v`) lists linux/amd64 and linux/arm64.
- [ ] From the pulled image, `api`, `web`, `worker` and `migrate` each start
      (`docker compose run --rm api migrate` prints "schema current" on a
      migrated database), and a bogus word exits 1 with the usage line.
- [ ] `docker inspect` shows the OCI version label equal to the version;
      the `migrate` run logs that `version`, and the signed-in
      `GET /api/version` reports it, not `dev`.

### Deployed stack: compose + webhook loop

Fresh-host recipe:
[`../self-host/compose.md`](../self-host/compose.md) opens with it (curl the
compose file and `.env.example` from the Release, `docker compose up -d
--wait`).
Tunnel and App plumbing:
[`webhook-loop.md`](./webhook-loop.md). Source builds are the developer
path: foreground `docker compose build`, never piped, because the keychain
fails sandboxed or backgrounded.

Each of the steps below carries the same tag, `manual-until: a full-loop
browser test (parked by the test-gate ADR; trigger: the first webhook-spine
regression the piecewise integration tests miss; it also needs a fake
generator adapter, which does not exist yet)`, stated once here rather than
repeated.

- [ ] `docker compose up -d --wait` from the Release's files on an empty
      folder: api and web healthy, worker running; api and worker apply
      migrations idempotently at boot; `curl -i localhost:3000/api/version`
      answers 401 with no `MergeBrief-Version` header (a signed-out caller
      learns nothing); signed in, the header carries the version.
- [ ] Push to an open PR: webhook 200 on the api, ONE debounced generate
      job, the brief appears without a manual reload (pending, generating,
      rendered).
- [ ] Push mid-generation: the run is recorded `superseded` (not failed),
      the newer head generates, `attempts` untouched.
- [ ] Exactly ONE branded entry comment on the PR thread, replaced (never
      duplicated) on the next settled push, deep-linking the exact span.

### Upgrade

The operator's upgrade step is
[`operations.md`](../self-host/operations.md#the-upgrade-step): dump,
`pg_restore --list`, curl the new compose file, `pull`, `stop`, `up -d
--wait`. Run it from the previous candidate to the new one. Each step
carries `manual-forever: two real releases on a real host`.

- [ ] The chain runs to the end; the api or worker log, whichever booted
      first, carries `db.version.upgrade` with both versions; `mergebrief auth status
      --json` and the signed-in `GET /api/version` report the new version.
- [ ] Rolling back one non-breaking release, the previous compose file
      and `up -d --wait` alone, starts the older release against the newer
      schema: one `db.version.ahead` warning from the first process up, no
      refusal.
- [ ] Rolling back across a breaking release follows
      [`operations.md`](../self-host/operations.md#rolling-back): the older
      compose file first, then the restore of the pre-upgrade dump (or the
      provider snapshot); the older release starts on its own schema with
      no `db.version.ahead` warning.
- [ ] A breaking release's notes carry an `## Upgrade` section, and its
      Release body opens with `## Upgrade to X.Y.Z` followed by the
      extra-step lead (the security sentence first when both apply).

### The version notice

The machinery is in the gates index. What stays manual is the band against
a real `version.json` and the CLI nag against a real npm `latest`. The
local arm needs no release: serve a hand-made file and start the api as an
older version.

```sh
pnpm -C tools/release version-json v0.1.0 --out /tmp/version.json   # or a hand-edited file with a newer, breaking or security release
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp &
SERVER_VERSION=0.0.9 MERGEBRIEF_UPDATE_CHECK_URL=http://127.0.0.1:8765/version.json pnpm app:host
```

- [ ] After the 60-second boot delay the api logs `update.available` once
      (`warn` when the gap holds a security fix); the signed-in band says
      "MergeBrief X.Y.Z is available. This instance runs 0.0.9." with a
      Release notes link, and adds the extra-step sentence when a release in
      the gap is breaking. `manual-until: a browser spec that starts the e2e
      api with SERVER_VERSION and a stubbed version.json`.
- [ ] Dismiss hides the band for this user only; the avatar dot and the
      Account menu row stay until the instance runs that release; the dot
      clears the first time the menu opens; a newer release in the file
      brings the band back. Same tag.
- [ ] A security release cannot be dismissed: the band is amber with the
      warning icon and leads with "fixes a security issue". Same tag.
- [ ] The live arm: an instance on the previous stable release shows the
      band for the new one within a day of the tag.
      `manual-until: the second stable release exists` (a candidate compares
      equal to its final version and ships no `version.json`, so the first
      release cannot show it).
- [ ] The CLI nag: a CLI one version behind npm `latest` prints the update
      line once, on the run after the check, with the exact `npm i -g
      mergebrief@X.Y.Z` command, and a CLI a major behind the server prints
      the behind warning on every answer. The npm URL has no override, so
      only a real `latest` exercises it.
      `manual-until: the second stable release exists`.

### External Postgres

Setup: a managed-provider database (a free tier is enough), the Release's
`docker-compose.external-db.yml` selected through `COMPOSE_FILE` in `.env`,
recipes in
[`../self-host/compose.md`](../self-host/compose.md#external-postgres-managed-database).
The refusal and precedence LOGIC (the TLS gate matrix, `_FILE` precedence,
the check-only ledger comparison) is in the gates index; what stays manual
is the real wire: provider TLS handshakes, CA chains and role models are
what the PGlite-based suites cannot see. Every step carries the same tag,
`manual-forever: needs a live managed provider; re-run on a pg or
pg-connection-string bump or an external-db compose change, not every
release`.

- [ ] TLS refusal fires: a provider DSN with NO `sslmode`, and one with
      `sslmode=require`, each make api and worker refuse boot naming
      verify-full and disable; web never starts behind api's health check;
      no DSN in any log.
- [ ] Connects verified: `?sslmode=verify-full` (plus `sslrootcert` through
      the CA mount if the provider's chain needs pinning; record which) and
      api, worker and web come up, `/readyz` 200.
- [ ] Auto-migrate applies on the first boot against the fresh provider
      database; the second boot no-ops.
- [ ] `MERGEBRIEF_AUTO_MIGRATE=false` against a behind database: api and
      worker exit 1 naming the pending count and `docker compose run --rm
      api migrate`; on a fresh `up` web never starts, on a running stack
      web's `/readyz` is 503 and `/healthz` stays 200.
- [ ] The named command with a DDL-capable DSN (the one-line form in
      [`operations.md`](../self-host/operations.md#external-database-auto-migratefalse),
      `sslrootcert` as the container mount path if pinned): api and worker
      start clean on restart and a running web recovers WITHOUT a restart.
- [ ] A fresh provider database with `MERGEBRIEF_AUTO_MIGRATE=false`: the
      migrate run creates the app schema AND `graphile_worker`; the first
      `up -d` then boots clean with no DDL.
- [ ] An upgrade under `MERGEBRIEF_AUTO_MIGRATE=false` follows the
      operations recipe: provider snapshot, curl the new external-db compose
      file, migrate with the new image, then `up -d --wait`.
- [ ] `DATABASE_URL_FILE` through the compose `secrets:` block boots; with
      BOTH set the boot warning names the shadowed `DATABASE_URL`.

### Reviewer surface

- [ ] GitHub OAuth login, and Inbox rows with status pills.
      `manual-forever: a real user-to-server OAuth consent against a real
      GitHub App; no hermetic surface can mint one.`
- [ ] A deep link in a fresh private window: auth redirect, then the brief;
      the document answers `cache-control: no-store`.
      `manual-until: a signed-out deep-link spec and a document-header
      assertion` (first paint and the View/Compare normalization are
      covered by the seeded suite).
- [ ] A real second revision: the compare bar's Previous brief highlights
      through the marks and narrative endpoints, and the Newer commits
      chip never auto-swaps the page.
      `manual-until: a seeded second revision with marks and a narrative`.
- [ ] The Revisions timeline: thread-jump into the conversation, and "Your
      last review" enabling only after a submitted checkpoint (the seeded
      suite pins the disabled state).
      `manual-until: a seeded checkpoint and conversation`.
- [ ] Outdated-thread jump (needs a real multi-revision PR with outdated
      review threads). `manual-until: seeded conversation threads`; the
      real-PR arms ride the full-loop trigger:
      - the anchor sha IS a briefed revision: "Jump to revision" lands on
        `?head=<anchor>&thread=<id>`, conversation open, the target row
        revealed even behind the show-more cap or inside a collapsed bot
        group, and focused;
      - the anchor sha was never briefed (common, the debounce): the
        affordance is disabled with a reachable reason and a GitHub
        permalink fallback, no nearest-revision guessing;
      - reduced motion: the scroll to target snaps instead of smooth-scrolling (the
        scroll-to-target hook test pins the scroll calls; the thread
        scroll path is not covered).
      Any defect becomes its own fix PR.
- [ ] Review submit: comments post to GitHub, the checkpoint is written by
      the webhook (commit_id pinned, bots filtered), submitted comments go
      read-only locally, the verdict is spent on success.
      `manual-forever: writes land on a real PR thread through a real App
      installation; the hermetic suites stop at the octokit boundary.`
- [ ] Author self-review. Fast pass:
      `manual-forever: needs a draft PR you author plus a SECOND GitHub
      account for the non-author arm; two real identities against one
      installation.`
      - the own-draft state renders for the author (chip "Self-review, your
        draft", submit and receipt hidden, flags read-only, mark-ready CTA)
        and the same PR is a plain reviewer view for a non-author, no
        "mode" wording anywhere;
      - the soft gate lists current-head flags (zero flags: skipped;
        historical revision: chip stays, CTA disabled, no gate);
      - mark-ready flips the PR non-draft on GitHub and the surface
        converges to the reviewer view; `converted_to_draft` returns it
        WITHOUT regenerating;
      - post-now on an own-draft inline comment posts to GitHub (commit_id
        pinned) and renders as a "Yours" thread; the reviewer composer stays
        private-until-submit (a "Post" button in the reviewer state is a
        hard regression).
- [ ] Draft generation policy (edits to the `drafts:` block of
      `mergebrief.config.yaml`; restart api AND worker after each change,
      both read the file). `manual-forever: the real draft lifecycle,
      GitHub's own mark-ready button, converted_to_draft, close then
      reopen, only exists on a real PR. The config parsing and refusal arms
      are in the gates index.`
      - no `drafts:` block (or no file): drafts generate on the normal
        window, nothing changed;
      - `drafts: { debounceSeconds: 900 }`: a FRESH draft's first brief
        still arrives on the normal window; a push after that brief shows
        the pending heading "can take up to about 15 minutes" (own-draft
        view only) and the job's `run_at` sits about 15 minutes out (check
        `graphile_worker.jobs`);
      - mark ready (our CTA or GitHub's button) while the damped job is
        pending: exactly ONE job remains, `run_at` about 10 seconds out, the
        brief is fresh when the reviewer arrives;
      - a submitted review on the damped draft re-queues on the NORMAL
        window (reviews never damp);
      - `drafts: { generate: off }`: a new draft push writes the PR row but
        NO generation row and NO job; the PR page still renders conversation
        and meta, the author sees the "off on this instance" empty-state
        copy; mark ready generates the first brief; a review on the draft
        writes its checkpoint but does not enqueue; close then REOPEN the
        draft returns the PR to open;
      - `generate: off` beats the default-on `entryCommentOnDrafts` (no
        brief, no entry comment on the draft);
      - a non-author viewing the same draft sees no policy copy anywhere.

### CLI (`mergebrief`)

- [ ] `npm i -g mergebrief@<tag>` on a clean machine, then `mergebrief auth
      status --json` against the deployment: reachable, the token
      authenticates, `server.version` is the version; `server.latest` names
      the newest release the server knows only while the instance is
      behind, so it is absent on the newest release. Then `pr`, `groups`, `diff --group`,
      `submit` round-trip. Setup: [`../self-host/cli.md`](../self-host/cli.md).
      `manual-forever: a real deployment, a real minted token and real
      review writes; the suite covers the same commands against a spawned
      API process over PGlite.`
- [ ] Agent-driven pass: point an AI coding agent at a briefed PR with only
      the CLI on PATH, a minted token, and the prompt "review this PR with
      mergebrief", no other coaching. Pass = the agent completes the `pr`,
      `groups`, `diff --group`, `submit` round-trip unaided from `--help` and
      `--json` output alone, and never needs a human to interpret an error.
      Anywhere it stalls or misreads output (ambiguous help text, an
      unparseable error, an exit code contradicting the contract table) is
      a CLI usability defect; file it against the CLI, not the agent.
      `manual-forever: the pass condition is whether an unaided agent finds
      the surface legible, a judgement no assertion expresses.`

### Generator backends (live auth + spend)

Recipe with per-adapter checklists and the exact commands:
[`generator-smoke-recipe.md`](./generator-smoke-recipe.md). NEVER wire any
of these into vitest or CI. Every step in this section carries the same
tag, `manual-forever: live provider auth (OAuth keychains, auth.json, API
keys) and real spend; the test-gate ADR keeps live-spend surfaces out of CI
permanently`.

#### Accounts and credentials needed (one per adapter)

| adapter       | needs                                                      | notes                                                                                                            |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `anthropic`   | `ANTHROPIC_API_KEY`                                        | the deploy default; already required by the compose walkthrough                                                  |
| `claude-code` | Claude subscription + `claude /login`                      | interactive OAuth keychain; no API key                                                                           |
| `codex`       | ChatGPT subscription + `codex login`                       | interactive; subject to the plan's usage limits                                                                  |
| `cursor`      | Cursor subscription + `cursor-agent login` (or `CURSOR_API_KEY`) | the origin stamp records the configured model; the recipe's `--adapter cursor` arm                              |
| `openai`      | OpenAI **API** key (platform.openai.com, prepaid)          | a ChatGPT subscription does NOT cover it; a smoke costs cents                                                    |
| `openrouter`  | OpenRouter account + small prepaid credit (about $5 min)   | one key smokes both the structured-outputs slug and the refusal arm                                              |

No account for an adapter: record it as **SKIPPED (no account)** in the
pass record rather than faking coverage; the contract and SSE-fixture
suites still cover its logic, but the live wire stays unverified, and the
release notes say so. (The `openai` `baseUrl` escape hatch is its own
checklist arm, not a substitute for the native smoke.) An OpenRouter key
is the cheapest way to close most of the gap: it natively covers
`openrouter` and also exercises `openai`'s compatible-server arm through
`baseUrl: https://openrouter.ai/api/v1`.

- [ ] Live smoke per adapter you ship (`pnpm -C packages/generators smoke
      -- --adapter …`): the startup check passes, the origin is honest
      (effort echoed or null per adapter; `codex-default` when
      unconfigured), the output is schema-valid, warnings are explainable.
      Adapters: `anthropic`, `claude-code` (needs `claude /login`), `codex`
      (needs `codex login`), `cursor` (needs `cursor-agent login`), `openai`
      (one reasoning and one non-reasoning model; the second must log knob
      discovery and stamp `effort: null`), `openrouter` (one
      structured-outputs slug; one WITHOUT must refuse boot).
- [ ] Every wire schema compiles at the Anthropic API
      (`pnpm -C tools/categorizer smoke:schemas`, `ANTHROPIC_API_KEY` in
      `tools/categorizer/.env`; two tiny requests per variant, cents): every
      variant prints `ok`, compiling as sent and with 8 more required
      fields. `REFUSED` names a variant the API refuses, and `LOW` one that
      is a small field away from refusal. The adapter
      smoke's tiny schema never compiles the Brief's grammar, and CI and
      evals run `claude-code`, which compiles none. Also run it after any
      change to a generation schema.
- [ ] A compose boot with no `mergebrief.config.yaml` (only the required
      `.env` keys) still generates a brief end to end on the `anthropic`
      default.
- [ ] api and worker with `MERGEBRIEF_CONFIG` pointing at a BAD file refuse
      at boot (the compose logs show the per-field issues). The refusals
      are in the gates index; what stays manual is that the containers
      surface them instead of booting degraded.
- [ ] ONE deliberate hung-run kill against a real CLI per release: the
      watchdog fires, a `timeout`-kind error with a redacted stderr tail,
      `pgrep` shows no orphans (the recipe's "deliberate hung-run kill").
- [ ] After a `claude`, `codex` or `cursor-agent` upgrade: re-run that
      adapter's smoke (envelopes are documented but unpromised; also
      re-verify claude's `modelUsage` metric casing against the shim).
- [ ] UI surfacing: a brief generated through a CLI adapter names that
      provider in the header badge and the provider, model and effort in
      the Brief details panel; force a salvage or a mismatch (or reuse one
      seen in the smokes) and confirm the "generation warnings" chip in
      the header and the note it lands on.

### Tracing

The trace path has no browser test; the propagation, payload-link and
graphile tests cover its pieces. `manual-until: a compose-level trace test
against an in-memory collector`.

- [ ] Local: `docker compose -f docker-compose.tracing.yml up -d`,
      `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in `.env`, then
      `pnpm app:host`. A webhook delivery shows in Jaeger
      (`127.0.0.1:16686`) as an api trace with its pg spans, and the
      worker's `process generate` trace links to it. `vite dev` is
      untraced; the web tier traces only from `src/serve.ts`.
- [ ] Deployed, before each pre-release: the [any-OTLP
      recipe](../self-host/observability.md#recipe-any-otlp-backend) into a
      Grafana Cloud free stack (its OTLP endpoint and a `Basic` token). A
      page's document request is one trace across `mergebrief-web` and
      `mergebrief-api` (each later browser call is its own);
      an api log line's `trace_id` finds that trace.
- [ ] Once before the Release: the [Datadog
      recipe](../self-host/observability.md#recipe-datadog) on a 14-day
      trial. Traces arrive under the three service names, and a trace's
      Logs tab lists its lines with no remapping.

### Local dev loop (quick confidence)

- [ ] `pnpm app:host` (Postgres in compose; api, worker and web on the
      host), paste a public PR URL, Generate, the brief renders; the same
      head reuses the cached artifact (no second spend).
      `manual-forever: generates against a live model; real spend.`
- [ ] `pnpm -C tools/categorizer categorize <pr-url>` and `pnpm -C
      tools/categorizer delta <pr-url> <base> <head>` write artifacts under
      `tools/categorizer/out/`. `manual-forever: same, live spend.`
- [ ] The concern view and the busy-header menu keyboard semantics (menu
      focus, Escape returns to the trigger) spot-checked on the generated
      brief. `manual-until: a spec for the concern view and the header
      menu`.

---

## Failure protocol

Fix forward with a PR on `main`. For generation failures, the raw model
output of every failed attempt is dumped as `out/<label>-*.failed.json` in
the generating process's working directory; in the container that is
`/app/apps/worker/out`, which is not a volume, so copy it out before
recreating the service:

```sh
docker compose cp worker:/app/apps/worker/out ./worker-out
```

Start there before re-running anything that spends.
