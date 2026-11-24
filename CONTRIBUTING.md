# Contributing

The most valuable thing you can contribute to MergeBrief is not code. It's review vocabulary.

MergeBrief's taxonomy is the shared, versioned vocabulary of *what kinds of change exist*
(Categories, Concerns) and *what factual attributes make a chunk worth attention*
(Risk Surface). The engine's prompt and output schema are built from code maps that mirror
it: every token you register shapes what the tool can recognize in every PR anyone reviews with it. That
vocabulary lives in plain markdown in this repo, and sharpening it is the main
contribution surface.

If you have reviewed enough PRs to know that a factual pattern such as `removes-validation`
or `widens-trust-boundary` reliably deserves a second look, you already have something to
contribute here.

> **Playbook items are not accepted.** The per-Category checklist layer is parked: no
> product surface consumes it.

## Where everything lives

The vocabulary is split across files with a strict division of labor:

| File | Role |
|---|---|
| [`docs/vocabulary/labeling-schema.md`](docs/vocabulary/labeling-schema.md) | The authoritative **index** of valid tokens on every axis. A token not registered here is not valid, full stop. |
| [`CONTEXT.md`](./CONTEXT.md) | The **glossary**: what each concept means, what terms are deliberately avoided. |
| [`docs/vocabulary/risk-surface.md`](docs/vocabulary/risk-surface.md) | The per-attribute detail for **Risk Surface**: detection notes and reviewer implications. |

Always edit in that order: register the token in the index first, then write the deep
content. Never invent a token inline anywhere else.

## The schema

Three axes, three attach points. (Full glossary in [`CONTEXT.md`](./CONTEXT.md).)

- **Category**: the *intent* of a Change-group (`bugfix`, `lib-bump`, `schema-change`, …).
  One dominant per group, optional secondaries.
- **Concern**: the *artifact* a chunk touches (`implementation`, `test`, `doc`, `spec`,
  `config`, `generated`). Independent of Category.
- **Risk Surface**: zero or more *factual attributes* on a chunk (`no-tests`,
  `mutates-state`, `new-dependency`, …), in three buckets: about the code, about the change,
  about the blast radius. Facts a reviewer can check in seconds. Never verdicts. Severity,
  when it matters, emerges from combinations, and the reviewer makes that call.

All three vocabularies are **closed sets**. The engine's prompt and output schema are
built from code maps that mirror them, so an unregistered token cannot appear in a Brief. That closedness is
the point: it's what makes the same kind of change recognizable across every PR. Expansion
is deliberate, never casual.

### Risk-Surface attribute format

Each attribute entry in `risk-surface.md` carries:

- a **name** (kebab-case, factual, no severity words: `touches-auth`, never `dangerous-auth`),
- its **bucket** (code / change / blast radius),
- a **Detect** note: how a labeler or the engine recognizes it, as mechanically as possible,
- a **Reviewer implication**: what a reviewer should do differently because the attribute
  fires. If firing wouldn't change reviewer behavior, the attribute carries no information.

## How to contribute

### Add a Risk-Surface attribute (the best first contribution)

The bar (from `risk-surface.md`, "When to Add a New Attribute"):

1. The same observable pattern appears in **at least two real PRs**; cite them in your PR
   description.
2. No existing attribute already covers it.
3. It has a clear reviewer implication: the attribute would change what a reviewer does.

Then: register the token in `labeling-schema.md` (correct bucket), write the full entry in
`risk-surface.md`, and keep the name factual. If detection needs repo context the engine
doesn't have (registries, sibling files), expect it to be **parked** rather than accepted;
see the "Parked candidates" section of `risk-surface.md` for two worked examples of that
outcome and why.

### Sharpen an existing entry

Better detection notes, a sharper reviewer implication, or evidence that an attribute is
dead weight: all welcome, same evidence bar.

### Add a Category

The rarest change, and the highest bar, because every Category dilutes the recognizability of the
others. Be ready to show that real Change-groups exist whose intent no current Category
expresses (and that the gap isn't actually a Concern, the classic mistake: `test-only` and
`config-only` looked like Categories and were not). Register in `labeling-schema.md` and
describe in `CONTEXT.md` in the same PR. (While the playbook layer is parked, no checklist
ships with it.)

### Deprecate a token

The library stays sharp by shedding, too. A token that never fires across 10+ PRs, or always
co-fires with another (redundant), should be dropped. Bring the evidence; remove it from the
index and the deep file together.

## Keeping docs and code in lockstep

The markdown is the source of truth; the code mirrors it. A PR that changes *tokens* (adds,
renames, or removes one) must update the mirrors in the same PR:

- `packages/brief-core/src/types.ts`: the closed Concern, Role and Risk Surface maps the
  output schema validates against.
- `packages/types/src/reviews.ts`: the closed Category map. A database CHECK in
  `packages/persistence` reads it, so a Category change also needs a migration.
- `packages/brief-core/src/generation/prompt/sections.ts` and `prompt/features.ts`: the description
  maps interpolated into the prompt.
- `packages/i18n/src/locales/en.json`: the `brief.category.*` and `brief.risk.*` labels the web
  app shows. Its label maps are keyed by the code maps, so a missing label fails typecheck.
- `packages/repo-config/src/constants.ts`: `FLOOR_ATTRIBUTES` and `PARKED_ATTRIBUTE_CANDIDATES`,
  when the token is a floor attribute or a parked candidate.

Token changes touch the generation surface, so [the eval harness](#the-eval-harness)
applies. Verify the change with
[the gates a pull request must pass](#gates-a-pull-request-must-pass).

Docs-only PRs need no build step. Yes, the mirror step is manual for now; generating the
code from the markdown is a welcome future contribution.

## Ground rules

- **No verdicts, anywhere.** No severity grades, no "critical", no scores, no "this is
  probably a bug". Attributes are facts. This is the product's critical rule and it
  applies to contributed content too.
- **Register first.** The index in `labeling-schema.md` gates validity. Deep content for an
  unregistered token will be bounced back.
- **`uncertain` is a valid output.** Don't design tokens that force a judgment the
  evidence can't support.
- **Terminology matters.** `CONTEXT.md` records the words this project uses and the ones it
  deliberately avoids. Match it; propose changes to it explicitly rather than drifting.

## Governance

One maintainer, stated plainly: **final call on every contribution (vocabulary, code,
docs) rests with the maintainer.** What you can rely on in exchange:

- **Reasons, always.** Every accept, reject, or park gets a short written reason in the
  PR thread, tied to the published bars above (evidence rule, deprecation rule, the
  Concern-vs-Category check). No silent closes.
- **"Parked" is a real outcome.** Good ideas that need something the project doesn't
  have yet (usually repo context the engine can't see) are parked with the reason
  recorded, not rejected; see the worked examples in `risk-surface.md`.
- **Token changes wait on a maintainer-run check.** Vocabulary PRs touch the generation
  surface, so they're applied only after the maintainer runs the eval harness (it needs API
  spend and keys that fork PRs can't have). That step is on the maintainer, not you.

There are no auto-accept windows, votes, or response-time promises. Disputes are argued
in the PR or issue: convincing the maintainer is the process.

## How a pull request lands

Development happens in this repository, so your pull request is merged here:

1. **Review happens on the pull request.** Discussion, change requests and the accept or
   reject reason all stay on it.
2. **CI must be green.** The `required-checks-passed` check gates every merge.
3. **Every pull request is squash-merged**, the maintainer's included, so `main` holds one
   commit per pull request.

A merged change ships in the next release, which is a tag on `main`.

### Issues and pull request titles

Work reported from outside the project is a GitHub Issue. A contributor's pull request
says `Fixes #n` when it closes one, and nothing otherwise. A maintainer's pull request
carries a `[BRIEF-n]` ticket id in its title and adds `Fixes #n` only when it closes an
outside issue.

## Translations

The UI ships English-only today; every other locale is community-contributed. A locale
PR touches two files, `packages/i18n/src/locales/<id>.json` plus one registry row, and the
package's test suite is the review bar (mechanical checks hard-fail; completeness only
reports, so partial locales ship and fall back to English). The full walkthrough lives in
[`packages/i18n/README.md`](./packages/i18n/README.md). Machine translation is fine as a
declared, human-reviewed starting point. Right-to-left locales are not yet supported, so
open an issue before starting one.

## Code contributions

Bug fixes and features are welcome as pull requests. Run
[the gates](#gates-a-pull-request-must-pass) before opening one. [`docs/dev/architecture.md`](docs/dev/architecture.md) maps the code: package layers and import edges, the job queue, the GitHub integration, read-path scopes and stored documents. For anything architectural, open an issue to discuss first; several tempting features
are [non-goals](#what-mergebrief-will-not-do), and a PR won't change that.

A vulnerability never goes in a public issue or pull request. Report it privately as
[`SECURITY.md`](./SECURITY.md) describes.

### What MergeBrief will not do

- **No verdicts.** No severity scores, approvals or pass and fail marks. A flag is a fact
  the reviewer can check.
- **No bug hunting.** It does not present a model's guesses as findings.
- **No AI-written review comments.** The reviewer writes; the tool organizes.
- **No telemetry.** An instance reports nothing about itself. The one outbound check is
  the update check, which the instance config turns off.
- **No hosted version.** MergeBrief is self-hosted only.

## Development setup

### Tools

- **Node**, at the version `.nvmrc` names. CI reads the same file, and
  `engines` in the root `package.json` states the range the tooling accepts.
- **pnpm**, at the version the root `package.json` pins in `packageManager`.
  This is a pnpm workspace: `apps/*`, `packages/*` and `tools/*`, each with
  its own scripts. Run a member's script with `pnpm -C <member> <script>`,
  for example `pnpm -C apps/api test`.
- **Docker**, for the local Postgres and for the end-to-end suite.

### Install and run

```bash
pnpm install
cp .env.example .env
cp mergebrief.config.example.yaml mergebrief.config.yaml
```

Fill in `.env`: a dev GitHub App's credentials, `SESSION_KEY_V1`, a provider key, and a host
`DATABASE_URL` for the compose Postgres. In `mergebrief.config.yaml`, put your GitHub user
id under `operators` (`gh api user --jq .id`); nobody can sign in until it is listed. Then:

- `pnpm app:host` starts the compose Postgres and runs the api, the worker
  and the web app on your machine with `.env` loaded. This is the full
  loop: briefs generate.
- `pnpm dev` runs only the api and the web app. Nothing generates under it.
- [Local webhook loop](#local-webhook-loop) adds a tunnel so real GitHub
  webhooks reach your machine.

### Environment in a source checkout

The image reads only what compose passes it ([configuration reference](./docs/self-host/configuration.md)). From a checkout (`pnpm dev`, `pnpm app:host`, `pnpm app:host:prod`), the processes read files instead:

- `api` and `worker` load `.env` in their working directory, then the workspace root's `.env` (the nearest directory above holding `pnpm-workspace.yaml`), each if present. A file never overwrites a variable already set, so the shell wins, then the nearer file, then the root's; the files merge variable by variable. `migrate` loads `apps/api/.env`, then the root's.
- `web` reads only `.env` in its own working directory, never the root's, and `vite dev` reads `PUBLIC_BASE_URL` from the shell.
- Copy `.env.example` to the repo root `.env`, and also set the host `DATABASE_URL` the example shows, since nothing derives it there. `pnpm app:host` sources that file into the shell for all three processes.
- `api` and `worker` read `mergebrief.config.yaml` at the workspace root, with nothing to set. `MERGEBRIEF_CONFIG` names a file kept elsewhere: a relative path resolves against the workspace root, never the process's working directory (the worker runs from `apps/worker`, the api from `apps/api`), and an absolute one passes through. Set but empty, or unreadable, refuses boot. The categorizer CLIs never read `MERGEBRIEF_CONFIG`; they take `--config <path>`.

Two variables only matter in a checkout:

| Variable | Read by | What it does |
| --- | --- | --- |
| `MERGEBRIEF_OUT_DIR` | api | A directory of locally generated briefs the API serves to a signed-in session: absolute, or relative to the checkout root. Ignored under `MERGEBRIEF_RUNTIME=compose-worker` or `NODE_ENV=production`; blank reads as unset. |
| `ENABLE_LANGUAGE_SELECTION` | `vite build` of `web` | `true` or `1` shows the language picker. Read when the web bundle is built, so it has no effect on a pulled image. Every `ENABLE_*` variable is inlined into the client bundle, so it holds a toggle and never a secret. |

To trace a local run, start Jaeger alone with `docker compose -f docker-compose.tracing.yml up -d`, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in the root `.env`, and run `pnpm app:host:prod`. `pnpm app:host` serves the web tier through `vite dev`, which loads no tracing; the web tier traces only from `src/serve.ts`. Traces show at `http://127.0.0.1:16686`.

The subscription CLI providers (`claude-code`, `codex`, `cursor`) run only as host processes: [their notes](./docs/dev/harness-cli-providers.md) cover isolation, billing and the live adapter smoke.

### Local webhook loop

How to run the webhook receiver end-to-end on your machine and watch a real GitHub
`pull_request` event turn into a `pull_request` row + a queued `generate` job. This is also
the **fixture-capture** step: the real payloads you replay here are what the webhook parser's
test shapes are checked against, so grab a few while you have the tunnel open.

> Prereq: a **dev** GitHub App registered and installed on a test repo. Start the tunnel in
> [step 4](#4-open-a-public-tunnel) first, then register the App with its URL by following
> [`docs/self-host/github-app.md`](./docs/self-host/github-app.md). Use the App's dev credentials
> here; never paste production secrets into a local `.env`.

#### 1. Start Postgres

```sh
docker compose up -d postgres
```

This brings up the loopback-only Postgres from `docker-compose.yml`
(`postgres://mergebrief:mergebrief@127.0.0.1:5432/mergebrief`).

#### 2. Configure `.env`

The credentials belong to the API process, not the web tier. Copy `.env.example` to `.env`
at the repo root and fill in the dev-App values. **Placeholders below; never commit real
values.**

The API loads `apps/api/.env` first and the root `.env` second. The two merge variable by
variable, and the first value wins. So `apps/api/.env` overrides a variable, but it cannot
hide one: whatever it leaves out still comes from the root file. That bites where two
variables exclude each other. A root file with an inline `GITHUB_APP_PRIVATE_KEY` and an
`apps/api/.env` with `GITHUB_APP_PRIVATE_KEY_PATH` sets both, and boot refuses; a root
`DATABASE_URL_FILE` wins over any `DATABASE_URL`. If the root file holds another
deployment's values, keep the dev values in the same form it uses, or move that file aside.

```sh
# Database (matches docker-compose.yml)
DATABASE_URL=postgres://mergebrief:mergebrief@127.0.0.1:5432/mergebrief

# GitHub App (dev registration)
GITHUB_APP_ID=123456
# Exactly ONE of the next two: the inline PEM, or an ABSOLUTE path to the .pem file.
# A relative path resolves against each process's own directory, not this file's.
GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/dev-app.private-key.pem
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<output-of-openssl-rand-hex-32>
GITHUB_OAUTH_CLIENT_ID=Iv1.replace-me
GITHUB_OAUTH_CLIENT_SECRET=replace-me
GITHUB_APP_SLUG=your-app-slug

# The public origin: your ngrok URL once the tunnel is up (step 4)
PUBLIC_BASE_URL=http://localhost:3000
# openssl rand -base64 32
SESSION_KEY_V1=<your-base64-32-byte-key>
```

The API's composition root (`apps/api/src/main.ts`) reads these at BOOT, not on the first
request: it parses every config block, resolves the session key, migrates, and only then
listens. A missing or invalid var stops the process with a `field: reason` line instead of
serving a broken webhook, so if `pnpm dev` shows the api pane exiting immediately, that
line is why.

The web tier needs none of this, and it never reads the root `.env`. Under `vite dev` it
reads `MERGEBRIEF_API_ORIGIN` and `LOG_LEVEL` from `apps/web/.env` when that file exists,
and serves on port 3000 whatever `MERGEBRIEF_WEB_HOST` and `MERGEBRIEF_WEB_PORT` say.
`PUBLIC_BASE_URL` matters there only to vite's host guard, which reads it from the ambient
environment when the dev server boots, before that file loads: export it in the shell. (The
production web server, `src/serve.ts`, does read it from the file.)

The dev-only `MERGEBRIEF_OUT_DIR` serves local briefs only to a signed-in session, so the
tunnel does not expose it to a cookieless visitor; leave it unset and Home lists rows alone.
Fill the directory with either command:

```sh
pnpm -C apps/web perf:fixture --out <dir>                    # synthetic, free
pnpm -C tools/categorizer categorize --out <dir> <pr-url>    # real, costs a generation
```

#### 3. Run the app

```sh
pnpm dev            # api on http://127.0.0.1:3001, web app on http://localhost:3000
```

Two processes now. The webhook route lives on the API (`POST /api/webhooks/github`), and the
web tier's server entry (`apps/web/src/server.ts`) proxies `/api/*` to it, streaming the raw
body so the HMAC still verifies over the bytes GitHub signed. Point the tunnel at the web
origin as before: nothing about the public URL changes.

Do not judge load time on a dev server. A large brief opens 2 to 3x slower there than in
production: React's development build records every render for its performance track, and
Vite serves about 1,150 unbundled modules after a 7 to 10 s cold start. `pnpm app:host` runs
the dev web tier with hot reload; `pnpm app:host:prod` runs the same api and worker beside a
production build of the web tier on 127.0.0.1. The web `start` script sets `NODE_ENV=production`,
so the server render loads React's production build, as the image does. That is the one to time:

```sh
pnpm app:host:prod  # postgres, root .env, builds apps/web, then api :3001, worker, web 127.0.0.1:3000
```

Then open the brief in Chrome with DevTools' Network panel and read the
`/api/repos/<id>/pulls/<n>/diff` request's start and end, and the Performance panel's long tasks
after it lands. With the api already running, this restarts only the web tier:

```sh
pnpm -C apps/web build && MERGEBRIEF_WEB_HOST=127.0.0.1 pnpm -C apps/web start
```

#### 4. Open a public tunnel

```sh
ngrok http 3000
```

GitHub rejects `localhost`, so it must reach you through a public URL. ngrok (not
`gh webhook forward`, which forwards webhooks only) keeps the OAuth callback and the webhook on
one origin, so `PUBLIC_BASE_URL` stays a single value. Use that URL as the origin in the App's
three URLs ([`docs/self-host/github-app.md`](./docs/self-host/github-app.md#before-you-start)).

Set the dev App's **Webhook URL** to:

```
https://<your-ngrok-subdomain>.ngrok-free.app/api/webhooks/github
```

(Free ngrok URLs change on restart; expect to re-paste. The **Webhook secret** in the App
settings must equal `GITHUB_WEBHOOK_SECRET`, or every delivery fails the HMAC check with 401.)

#### 5. Fire an event

Open, push to, reopen, or mark-ready a PR on the installed repo. GitHub sends a
`pull_request` delivery; the handler verifies the HMAC over the raw body, upserts the PR, and
enqueues one debounced `generate` job, all fast, before returning 200.

#### 6. Verify the write path

```sh
docker compose exec postgres psql -U mergebrief -d mergebrief \
  -c 'select repo_slug, pr_number, state from pull_request order by updated_at desc limit 5;' \
  -c 'select task_identifier, key from graphile_worker.jobs order by created_at desc limit 5;'
```

Expect a `pull_request` row for your PR and a `graphile_worker.jobs` row with
`task_identifier = generate` and `key = generate:<pull_request_id>`.

The queue also **drains**: run the worker (`pnpm -C apps/worker start`
with the same env, or the compose `worker` service; see
[`docs/self-host/compose.md`](./docs/self-host/compose.md)) and the job disappears after the
debounce, the `generation` row walks `pending → running → succeeded`, and the Brief lands in
the `brief` table. Without a worker running, the row sits in the queue, which is still correct for
webhook-only debugging.

#### 7. Inspect / replay deliveries

ngrok's local inspector at **http://127.0.0.1:4040** shows every delivery and lets you
**replay** one: re-fire the exact same signed payload at your handler while debugging, instead
of opening PRs repeatedly. This is where you **save real payloads as fixtures** for re-verifying the
webhook parser (the parser tests deliberately don't import these, but capturing them keeps the
inline test shapes honest against what GitHub actually sends).

### Gates a pull request must pass

Judge each by its exit code, not its output.

- **`pnpm lint`** runs, in one chain that stops at the first failure:
  oxlint (type-aware), dependency-cruiser, knip, `prettier --check`, the web
  stylesheet lint, and five repository checks: `check:catalog` (the CLI's
  operation map against the API's operation table), `check:config`,
  `check:migrations`, `check:releases` and `check:baselines`. `pnpm format`
  fixes formatting.
- **`check:baselines`** compares your working tree with its merge base
  against `main`. In a clone with no local `main`, set
  `MERGEBRIEF_BASELINE_BASE=origin/main`; a base it cannot resolve fails
  the gate.
- **`pnpm -C <member> typecheck`** and **`pnpm -C <member> test`** for each
  app, package or tool you touched. Root `pnpm test` runs only
  `tools/categorizer`; `pnpm -r typecheck` and `pnpm -r test` run every
  member.
- **Coverage floors** ride inside each member's `test`: its vitest config
  commits a lines threshold, and a drop below it fails. The standard is 75%;
  `apps/api` holds 85%. Never lower a floor to absorb a drop.
- **`pnpm -C apps/web test:e2e`** when you touch the web app or anything it
  calls. Playwright's global setup starts its own Postgres container, so
  Docker must be running; install the browser once with
  `pnpm -C apps/web exec playwright install chromium`.
- **`pnpm -C apps/web build`** when you touch web code that runs on both
  server and client. Only the build catches a client import of server-only
  code.
- **`pnpm -C apps/cli build`** and **`pnpm -C apps/cli docs:check`** when
  you touch the CLI. `pnpm -C apps/cli docs:appendix` rewrites the appendix
  `docs:check` compares. `pnpm --dir apps/cli link-dev` puts your build on
  `PATH` as `mergebrief`. It runs whatever was last built, so rebuild after
  switching branches, and never build it from a pull request you are reviewing:
  the linked command would run that code with your token.
- **Generated files** are committed, and CI fails on any drift. A change
  under `apps/web/src/routes/` regenerates `routeTree.gen.ts` through
  `pnpm -C apps/web build`; a change under `packages/persistence/src/schema/`
  needs `pnpm -C packages/persistence generate`. Commit what they write.
- **`pnpm audit --prod --audit-level=high`** when you add or bump a
  dependency.

The real-Postgres suites in `apps/api`, `apps/worker` and
`packages/persistence` skip locally unless `MERGEBRIEF_TEST_POSTGRES_URL`
points at a throwaway database; CI runs them.

### The eval harness

A change to the generation surface, such as the prompt, the output schema,
its validators, or the vocabulary maps above, is checked against the eval
harness before it lands. Do not run it yourself: it spends API credit on
keys a fork does not have. Under a `### Eval` heading in your pull
request, say which eval cases your change could move and why, and the
maintainer runs them. If none can move, write one line that starts
`Eval-harness gate:` with the reason instead. The Eval presence check
looks for one of the two.

## License and the DCO

Contributions land under the repository license, `FSL-1.1-ALv2` (see `LICENSE`).
By opening a pull request you certify the Developer Certificate of Origin for its
commits: that you may contribute the change under that license. No contributor
license agreement, no sign-off trailer.
