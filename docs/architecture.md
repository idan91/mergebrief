# Architecture

How MergeBrief is built: the processes, the packages and the edges between
them, the job queue, the GitHub integration, the read-path authorization,
and versioning. Nouns are the glossary's (`CONTEXT.md`); operations live in
`docs/self-host/`.

## Process topology

One image, three long-lived processes, one stateful dependency. The image's
entrypoint takes one word: `api`, `web` or `worker` starts a service,
`migrate` applies pending migrations and exits (`docker-entrypoint.sh`,
`docker-compose.yml`).

```
GitHub ──webhook──▶ web :3000 ──/api/*──▶ api :3001 ──▶ Postgres ◀── worker
                     │  pages, SSR          │  HTTP, auth,     data + queue   │ generation,
                     │  proxy               │  webhooks        (graphile)      │ sweeps
reviewer ───────────┘                       ▲
CLI ──Bearer token──────────────────────────┘
```

- **web** (`apps/web`, TanStack Start) serves the app and SSR. Its server entry
  (`apps/web/src/server.ts`) proxies every `/api/*` request byte-for-byte to the
  API process named by `MERGEBRIEF_API_ORIGIN`, so the bytes GitHub signed reach
  the webhook route unchanged, and answers everything else from the page
  router. HTML documents go out `no-store` because they embed per-viewer data.
- **api** (`apps/api`, Hono) owns HTTP: the GitHub webhook (`POST
  /api/webhooks/github`), GitHub OAuth sign-in and sessions, CLI Bearer tokens,
  every product read and write, and `/api/version`. It writes rows and
  enqueues jobs. It never calls a model.
- **worker** (`apps/worker`) drains the Postgres job queue: Brief generation per
  pushed head, lease takeovers, and the scheduled sweeps (audit rows, expired
  sessions, closed pull requests past retention).
- **Postgres** is the only dependency: data, queue and locks in one database.
  The queue is graphile-worker, so an enqueue commits in the same transaction as
  the rows it belongs to. `docker-compose.external-db.yml`, an overlay on the
  default compose file, swaps the bundled server for your own.
- **CLI** (`apps/cli`, the `mergebrief` npm package) is a thin HTTP client. It
  sends a Bearer token to the same `/api/*` routes and parses answers with
  `packages/contract`.

The two GitHub identities: the App's installation token (reads diffs, posts the
Entry comment) and the reviewer's OAuth token (every read on the reviewer's
behalf, and the review they submit as themselves). See `CONTEXT.md`, "Reviewer
GitHub binding".

## Package layers

`apps/` holds members that run as their own process or ship as their own
binary. `packages/` holds code apps share. `tools/` holds repo-local scripts
that are never deployed and never imported by app or package source.

| Member                  | Owns                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/types`        | Type helpers (`ValueOf`, `Result`, `Brand`), closed vocabularies as `as const` maps, the job payload shapes. Zero dependencies.       |
| `packages/logging`      | The pino boundary, redaction by path, OpenTelemetry spans and trace context.                                                         |
| `packages/i18n`         | The catalog every user-facing string comes from, with its locales.                                                                   |
| `packages/generators`   | The `Generator` port and the provider adapters (Anthropic, OpenAI, OpenRouter, Codex, Claude Code, Cursor), plus the instance policy. |
| `packages/contract`     | The HTTP agreement: wire error codes, the operation table, response shapes. No handler, no middleware, no database.                  |
| `packages/brief-core`   | The Brief domain: output schema and vocabulary, taxonomy prompt, diff parsing, anchoring, delta and revision logic, pr-stack.         |
| `packages/persistence`  | Drizzle schema and migrations, the row-scoped stores, the queue enqueue, the PGlite test harness.                                     |
| `packages/github`       | App and OAuth auth, the GitHub client bindings, webhook signature check and event parsing.                                           |
| `packages/repo-config`  | The `.mergebrief/` repo-local config: schemas, validation, where a value came from.                                                  |
| `apps/api`              | Routes, the policy gate, sessions and tokens, the webhook ingest.                                                                    |
| `apps/worker`           | The generate task and its takeover, the Entry comment lifecycle, the sweeps.                                                         |
| `apps/web`              | The Brief page, Home and Inbox, the SSR server with the API proxy.                                                                   |
| `apps/cli`              | Profiles, commands, the version nag.                                                                                                 |
| `tools/*`               | `release` (tags, version stamps, `version.json`), `categorizer` (the eval harness), `baselines`, `ingest-briefs`, `oxlint-plugin-house`. |

Import edges, from the bottom up:

- `types` imports no workspace package.
- `logging`, `i18n` and `generators` import only `types`.
- `contract` imports only `types`: `apps/web` reaches it through an isomorphic
  module, so a `persistence` import would pull drizzle into the browser bundle.
- `brief-core` sits on `generators` and `types`; `persistence` on `brief-core`,
  `logging` and `types`; `github` on `brief-core`, `logging`, `persistence` and
  `types`; `repo-config` on `brief-core`, `generators` and `types`.
- No app imports another app, tests included; apps talk over HTTP or the job
  queue. `apps/web` never imports `apps/api`: it shares shapes through
  `contract` and calls over HTTP.
- No app or package source imports a tool.

dependency-cruiser (`.dependency-cruiser.cjs`) holds every edge at error with
no baseline. A member may import only the workspace packages its own
`package.json` declares, and the rules above are named there
(`types-has-no-workspace-dependencies`, `foundation-packages-import-only-types`,
`contract-imports-no-runtime`, `no-app-imports-another-app`,
`no-package-imports-an-app`, `no-source-imports-a-tool`).

## The queue contract

Three task ids cross from `persistence` to the worker, all in
`packages/types/src/jobs.ts` (`QueueTasks`), beside the payload shapes:

| Task                  | Enqueued by                                                  | Job key                                | Payload                                                                                     |
| --------------------- | ------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `generate`            | The webhook ingest and the URL paste, through `persistence`. | `generate:{pull_request_id}`           | `installation_id` or `owner_user_id` + `grant_id`, with `pull_request_id` and `head_sha`.   |
| `recover-generation`  | Every Claim, in the claim's own transaction.                 | `recover-generation:{pull_request_id}:{head_sha}` | The same payload.                                                                 |
| `sync-entry`          | A run ahead of a write that ends it failed, a terminal post that failed transiently, lost its comment swap or stood down on an unread head, a sync that lost its own swap, and the webhook on a close or merge. | `sync-entry:{pull_request_id}:{head_sha}` | The installation payload. Ten attempts, so graphile's backoff outlasts a GitHub outage. |

- **Debounce by job key.** The ingest upserts the `pull_request` and
  `generation` rows and enqueues `generate` on the same transaction with
  `job_key_mode = preserve_run_at` (`packages/persistence/src/stores/ingest.ts`).
  The first push fixes `run_at` (60 seconds out by default); later pushes only
  swap the payload head. A draft marked ready re-arms the window instead
  (`replace`). A job already locked by a running worker gets its key detached
  and a fresh job queued, so a push during a run is never lost.
- **Retries.** `max_attempts` is 3. The worker sorts failures into two kinds.
  A permanent one (404, a deterministic generation failure, a row outside the
  job's scope, an invalid artifact body) marks the Generation `failed` and ends
  the job. A transient one (429, 5xx, network) marks the row and rethrows, so
  graphile retries with backoff. A newer head aborts the run as `superseded`
  and spends no attempt.
- **Claims.** Each attempt claims the Generation row with a run id and a
  two-minute lease, renewed while the run polls the head. The `recover-generation`
  job fires once the lease could have lapsed and takes the head over if it did
  (the glossary's Takeover). A head takes at most three claims between
  triggers; the daily generation cap counts started runs instance-wide.
- **Scheduled sweeps** (`sweep-audit`, `sweep-sessions`, `sweep-pull-requests`,
  `sweep-webhook-deliveries`, `sweep-generation-parts`) are graphile cron entries the worker registers
  for itself. Nothing enqueues them, and they run instance-wide rather than in
  one scope.

Payload shapes change additively: a queued job outlives the release that wrote
it, so the worker's parser takes a new field as optional.

## GitHub integration

The App needs five permissions (`docs/self-host/github-app.md`) and parses four
webhook events (`packages/github/src/webhook/events.ts`):

- `pull_request`: `opened`, `synchronize`, `reopened`, `ready_for_review` and `review_requested` queue a generation; `edited` queues one only when it moved the base; `closed` writes the state and queues nothing; `converted_to_draft`, `labeled`, `unlabeled`, `review_request_removed` and an `edited` that changed only the title write the state and queue a job only for a head trigger conditions hold, so the worker checks it again.
- `pull_request_review` (`submitted`): advances the reviewer's Checkpoint when
  the repository is private (not internal), or otherwise when the review's
  `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR`, or else when one
  bounded read of the reviewer's repository permission answers `write` or
  `admin`. Then it triggers a generation so the delta from that checkpoint can
  be pre-warmed. Any other reviewer gets no checkpoint and so costs no delta.
- `installation` (`deleted`) purges every row of that Installation;
  `installation_repositories` (`removed`) purges the removed repositories.

The webhook route (`apps/api/src/routes/webhook.ts`) verifies the HMAC over the
raw body before parsing anything, takes the Installation from the signed
payload, upserts and enqueues, and answers 200 without calling GitHub or a
model. Redelivery is idempotent through natural-key upserts and the job key,
and a pull request or review signature the route processed in the last 72
hours is skipped.

**The Entry comment.** One branded comment per pull request carries the deep
link to the Brief. On each settled head the worker deletes its previous comment
and posts a fresh one, which keeps it at the bottom of the thread and fires one
notification per settled head, never per push (`apps/worker/src/task/entry-comment/`).
A large run edits its generating comment in place once grouping counts its
parts, and leaves it as it is when it cannot read the head; an edit notifies
nobody.
Drafts get the comment too, unless the repository sets
`entryCommentOnDrafts: false` in `.mergebrief/`; the opt-out never stops the
Brief computing.

**Two sources.** A pull request enters MergeBrief one of two ways
(`PullRequestSources` in `packages/types/src/pull-requests.ts`):

- **Installation**: reported by the App's webhooks, belonging to the
  Installation the repository is installed under. The worker reads through the
  installation token and owns the Entry comment.
- **URL**: a reviewer pasted the pull request's URL on Home (`POST
  /api/generate`). The row belongs to that reviewer, no webhook reports on it,
  the worker reads through the reviewer's own token (the job carries a grant
  reference, never token material), and it never writes to GitHub. A Live read
  on Inbox load and Brief open refreshes its facts. Owning the row is not
  exclusive: another reviewer who can read the repository opens the same
  stored brief (see step 3 below).

## Read-path authorization

Every store call runs in exactly one row scope, and no store can mix the two.
A request reaches its scope in steps:

1. The session layer binds the principal: a browser cookie session or a CLI
   Bearer token, each backed by the reviewer's GitHub OAuth credential.
2. For a route naming a repository, the repo gate first proves read access on
   the reviewer's own token, then asks the installation resolver
   (`apps/api/src/routes/installation-resolver.ts`) which of the reviewer's
   reachable Installations holds that repository. When one does, the request
   acts in that installation scope; otherwise it acts in no Installation.
3. For a route naming one pull request, the row resolver
   (`apps/api/src/access/pull-request.ts`) looks in that installation scope
   first. With no row there, it falls back to URL rows for that pull request:
   the reader's own if they pasted it, else the oldest one any reviewer pasted
   on this instance (`resolveUrlBoxOwner`, `packages/persistence/src/stores/url-box.ts`).
   A stored brief is shared with anyone GitHub lets read the repository; URL
   rows are not private to the reviewer who pasted them. A reader admitted only
   through the operator token sees just their own URL rows.
4. The policy gate (`apps/api/src/product-operations/`) runs the declared
   checks in a fixed order: session, origin, repo access, token scope,
   human-only, operator-only, push access, Installation required, stored pull
   request required. A denial on the reviewer's credential collapses to 404 so
   existence never leaks.

In `packages/persistence`, every store factory is bound to one context, either
`{ installationId }` or `{ ownerUserId }` (`stores/scope-context.ts`), and
resolves it once into a `RowScope` (`stores/scope.ts`) that stamps every write
and filters every read. On `pull_request` exactly one of `installation_id` and
`owner_user_id` is set, paired with `source` by a CHECK constraint; child rows in
the URL scope carry a NULL `installation_id` and isolate through a semi-join on
their parent. A write that names a row outside the caller's scope throws
`ScopeViolationError`. The API answers it 404 and the worker fails the job
without a retry. The Inbox list is the one read that spans scopes: the
reviewer's reachable Installations plus their own URL rows, never another
reviewer's.

The worker gets its scope from the validated job payload and from nothing
else.

## Stored documents

Nine columns hold a JSON document: each artifact body (`brief`, `delta`,
`revision_narrative`, `comparison_marks`, `chunk_layout`, `generation_part`),
`hunk_span.spans`, and `repo_config` on `brief` and `generation`. They are `text`,
not `jsonb`.

Each document is written as a unit and read whole, no query reads inside one, and
the API serves the stored text as it is. Any value SQL needs has a column of its
own. Against that, `jsonb` costs about 20% more storage on these documents and
loses their exact bytes, and its driver handling would add a parse and a serialize
to every read. Indexing does not decide it either: an expression index on
`(body::jsonb ->> 'field')` works on a `text` column.

Two safeguards hold the type honest. Every column carries an `IS JSON` CHECK, so
Postgres refuses anything else. Every write passes through the `jsonDocument`
column type, which replaces NUL and lone surrogates, the two things a `jsonb` cast
refuses. The migration that added the checks moved existing rows to the same
shape, so a cast reads every stored row.

The rule for what comes next:

- A new query on a value inside a document gives that value its own column.
- Where a column does not fit, it adds an expression index on the cast.
- Should searching arbitrary fields inside briefs become a product feature, these
  columns move to `jsonb`, because fields nobody can plan for are what `jsonb` and
  GIN indexes exist for.

## Versioning

One git tag `vX.Y.Z` is the version of everything a release ships; the
repository itself carries no version (`dev` from a source build, `0.0.0` in
the CLI manifest). The API reports `SERVER_VERSION` on `GET /api/version` and
in the `MergeBrief-Version` header of every authenticated answer; the CLI
compares and warns on Skew.

| Question                                                                                                                                  | Where it is answered                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The words (Release, Instance, Image, Expand and Contract step, Breaking release, Skew, Dev build, Version notice)                          | `CONTEXT.md`                                                                   |
| How an operator learns of a release, upgrades, rolls back, turns the check off                                                            | `docs/self-host/operations.md`                                                 |
| What the CLI prints when versions differ                                                                                                  | `docs/self-host/cli.md`                                                        |
| The rules each member holds (anonymous update check, the version header, `instance_version`, the migration lint, the stamp and prune)     | the `AGENTS.md` of `apps/api`, `packages/persistence`, `apps/cli`, `tools/release` |
| Consumer-visible API changes by version                                                                                                   | `docs/api-changelog.md`                                                        |

## Where to go next

- Running it: [compose](self-host/compose.md),
  [GitHub App](self-host/github-app.md),
  [generators](self-host/generators.md),
  [operations](self-host/operations.md),
  [observability](self-host/observability.md), [CLI](self-host/cli.md).
- The vocabulary every name above comes from: [`CONTEXT.md`](../CONTEXT.md).
- Contributing, starting with the review taxonomy:
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Per-member invariants: each app's and package's `AGENTS.md`.
