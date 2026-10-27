# Configuration reference

Every setting MergeBrief reads, in one place. There are four surfaces:

- **Environment variables**, read by the `api`, `web`, `worker` and
  `migrate` processes at boot. Secrets, capacity and addresses live here.
- **The instance config file**, `mergebrief.config.yaml`, located by
  `MERGEBRIEF_CONFIG`. Provider, model, spend and instance policy live here.
- **Repo-local files** under `.mergebrief/` in each repository, read from
  the default branch per generation.
- **The CLI's own environment and `config.json`** on the machine that runs
  `mergebrief`.

Each table below was written from the code that parses the setting. The
how-to pages ([compose.md](./compose.md), [generators.md](./generators.md),
[operations.md](./operations.md), [observability.md](./observability.md))
explain when to change one; this page says what each one accepts.

## How values are read

- **A bad value refuses boot.** A process that reads a variable checks it
  before it does anything else, logs the variable's name and the reason
  (never the value), and exits. `api` and `worker` exit 0 on a config error
  so compose's `restart: on-failure` leaves them down; `web` and `migrate`
  exit 1. The one exception is `MERGEBRIEF_API_ORIGIN`, which `web` checks
  on its first request instead.
- **Empty is not always unset.** Compose passes `${VAR:-}` through as an
  empty string. Most variables treat empty as unset; the exceptions are
  named in the tables and listed in [Empty values](#empty-values). The safe
  habit is the one [compose.md](./compose.md) gives: leave a variable out
  entirely when it does not apply.
- **Booleans** accept `true`, `1`, `yes`, `on` and `false`, `0`, `no`,
  `off`, in any case. Any other token refuses boot.
- **Credentials are named, not inlined, in the config file.** Keys such as
  `generator.apiKeyEnv` and `contextSources[].tokenEnv` hold the NAME of an
  environment variable (uppercase letters, digits and underscores). The
  value stays in the environment.

### Where each process gets its environment

| Process | Started by | Env files it loads | In compose |
| --- | --- | --- | --- |
| `api` | `docker-entrypoint.sh api` | `.env` in its working directory, if present | `env_file: .env`, plus the service's `environment:` block, which wins |
| `worker` | `docker-entrypoint.sh worker` | `.env` in its working directory, if present | `env_file: .env`, plus `environment:` |
| `web` | `docker-entrypoint.sh web` | `.env` in its working directory, if present | no `env_file`: only what the service's `environment:` block sets |
| `migrate` | `docker compose run --rm api migrate` | `apps/api/.env`, then the workspace root `.env` | the `api` service's environment |

A file never overwrites a variable already set in the process environment.
In the image the working directories hold no `.env`, so compose's
`env_file` and `environment:` are the whole input.

## Environment variables

Columns: **Read by** names every process that parses the variable, so a bad
value refuses boot in each of them unless the row says otherwise. **Required** means boot refuses without
it.

### GitHub App and sign-in

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `GITHUB_APP_ID` | api, worker | none | yes | The App's numeric id, digits only. |
| `GITHUB_APP_PRIVATE_KEY` | api, worker | none | one of the pair | The App's PEM private key, inline. Exactly one of this and `GITHUB_APP_PRIVATE_KEY_PATH` may be set; both, neither, or an empty value refuses boot. |
| `GITHUB_APP_PRIVATE_KEY_PATH` | api, worker | none | one of the pair | Path to a file holding the PEM. An unreadable or empty file refuses boot. |
| `GITHUB_WEBHOOK_SECRET` | api, worker | none | yes | The HMAC secret GitHub signs deliveries with. At least 32 characters after trimming; the HMAC keys on the value as set. Only `api` verifies deliveries. |
| `GITHUB_OAUTH_CLIENT_ID` | api, worker | none | yes | The App's OAuth client id, for reviewer sign-in. The worker uses it to revoke a dead grant's token at GitHub. |
| `GITHUB_OAUTH_CLIENT_SECRET` | api, worker | none | yes | The App's OAuth client secret. |
| `GITHUB_APP_SLUG` | api, worker | unset | no | The App's URL name, the last segment of `https://github.com/apps/<slug>`: lowercase letters, digits and hyphens. Set, Home links a viewer with no reachable installation to the install page. Empty reads as unset. |
| `MERGEBRIEF_URL_FALLBACK_TOKEN` | api, worker | unset | no | A GitHub token tried after a reviewer's own token is denied on a pasted pull request. It serves only the GitHub account that owns it ([compose.md](./compose.md#hardening-before-real-exposure)). Empty reads as unset. |
| `SESSION_KEY_REF` | api | `SESSION_KEY_V1` | no | The NAME of the variable new GitHub tokens are sealed under: an uppercase letter, then uppercase letters, digits or underscores. Anything else refuses boot. Empty takes the default. |
| `SESSION_KEY_V1` (or the name `SESSION_KEY_REF` gives) | api, worker | none | api: yes | Base64 of exactly 32 bytes (`openssl rand -base64 32`). `api` resolves the variable `SESSION_KEY_REF` names at boot and refuses when it is missing, not base64, or the wrong length. Each stored grant names its own key variable, and both services open it by that name when they need it, so a rotated-out key stays set until no grant names it ([Tokens at rest](./operations.md#tokens-at-rest)). |

### Database

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | api, worker, migrate | none | yes, unless `DATABASE_URL_FILE` is set | A `postgres://` or `postgresql://` URL. A host that is not loopback (`localhost`, `127.0.0.0/8`, `::1`, or a unix socket path) must carry `sslmode=verify-full` or `sslmode=disable`, and `uselibpqcompat=true` only beside `verify-full`; anything else refuses boot ([TLS](./compose.md#tls-verify-full-or-disable-sslmode-in-the-dsn)). A file the DSN names, such as `sslrootcert`, that cannot be read refuses boot naming the path. The default compose file sets its own value. |
| `DATABASE_URL_FILE` | api, worker, migrate | unset | no | Path to a file holding the DSN, trimmed. Wins over `DATABASE_URL` and logs a warning when `DATABASE_URL` is also set and non-empty. An unreadable file refuses boot. Empty reads as unset. |
| `DATABASE_POOL_MAX` | api, worker, migrate | `10` | no | Connections each Postgres pool opens at most: a whole number of at least 2. An `api` opens one pool; a `worker` opens two, its store and its job queue. A request waits up to 10 seconds for a free connection. Empty takes the default. |
| `MERGEBRIEF_AUTO_MIGRATE` | api, worker, migrate | `true` | no | `true` applies pending migrations at boot. `false` makes boot a read-only check that exits 1 when the database is behind ([operations.md](./operations.md#external-database-auto-migratefalse)). `migrate` always applies. **Empty reads as `false`.** |

### Addresses and listeners

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | api, worker, web | compose: `http://localhost:3000` | api, worker: yes | The origin reviewers browse. An absolute `http` or `https` URL with no credentials in it, or `api` and `worker` refuse boot. `api` builds the OAuth callback from it and accepts a state-changing browser request only from its origin; `worker` builds the Entry comment's links from it; `web` adds its hostname to the hosts it serves, and refuses boot on a value that does not parse. Unset or empty in `web` serves `localhost` names and bare IPs only. |
| `MERGEBRIEF_API_HOST` | api | `127.0.0.1` | no | The address the API listens on. Compose sets `0.0.0.0` so `web` can reach it. Empty refuses boot. |
| `MERGEBRIEF_API_PORT` | api | `3001` | no | The API's port, digits only, 0 to 65535. Compose sets `3001`. Empty refuses boot. |
| `MERGEBRIEF_API_ORIGIN` | web | `http://127.0.0.1:3001` | no | Where `web` proxies `/api/*` and sends its server-side reads: an absolute `http` or `https` URL, reduced to its origin. Compose sets `http://api:3001`. Empty takes the default. Checked on the first request, not at boot: a bad value lets `web` start and pass its healthcheck, then fails every proxied and server-rendered request. |
| `MERGEBRIEF_WEB_HOST` | web | `0.0.0.0` | no | The address the web server listens on. Empty refuses boot. |
| `MERGEBRIEF_WEB_PORT` | web | `3000` | no | The web server's port, a whole number from 1 to 65535. Empty refuses boot. |

### Instance config, generation and the worker

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `MERGEBRIEF_CONFIG` | api, worker | unset | no | Path to `mergebrief.config.yaml`. Unset runs the zero-config defaults. A relative path resolves against the workspace root (the nearest directory above the working directory holding `pnpm-workspace.yaml`); an absolute one passes through. Set but empty, unreadable, not YAML, or a root that is not a mapping refuses boot. `api` reads only the `drafts`, `spend` and `operators` blocks; `worker` reads the whole file ([Instance config](#instance-config-mergebriefconfigyaml)). |
| `ANTHROPIC_API_KEY` | worker | none | with the default provider | The key the zero-config `anthropic` provider reads. `generator.apiKeyEnv` names another variable; `OPENAI_API_KEY` and `OPENROUTER_API_KEY` are the defaults for those providers. A provider whose key variable is unset or empty refuses boot. |
| `WORKER_CONCURRENCY` | worker | `1` | no | Jobs one worker process runs at once: a whole number of at least 1 ([Worker slots](./generators.md#worker-slots)). Empty takes the default. |
| `REVISION_NARRATIVE_ENABLED` | worker | `true` | no | Boolean. `false` skips the revision narrative against the previous brief. Empty takes the default. |
| `HUGE_SPAN_RATIO` | worker | `0.65` | no | A number above 0 and at most 1: the share of a pull request's changed lines at which an incremental span falls back to the full brief. Empty takes the default. |
| `NOTION_TOKEN` (or the name `contextSources[].tokenEnv` gives) | worker | none | when a `notion` context source is configured | The Notion integration token. Unset or empty refuses boot while the config lists a `notion` entry ([trackers.md](./trackers.md#notion)). |

### Attachments and the update check

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `MERGEBRIEF_ATTACHMENT_QUOTA_FILES` | api | `10` | no | Files one reviewer may attach per window: a positive whole number. Empty takes the default. |
| `MERGEBRIEF_ATTACHMENT_QUOTA_MB` | api | `30` | no | Megabytes one reviewer may attach per window: a whole number of at least 10, the size limit of one file. Empty takes the default. |
| `MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES` | api | `10` | no | The window's length in minutes: a positive whole number. Empty takes the default. Each `api` replica counts on its own ([attachments.md](./attachments.md#upload-quota)). |
| `MERGEBRIEF_UPDATE_CHECK` | api | `true` | no | Boolean. `false` stops the hourly fetch of `version.json` and with it the version notice ([The update check](./operations.md#the-update-check)). Empty takes the default. |
| `MERGEBRIEF_UPDATE_CHECK_URL` | api | `https://github.com/Idan91/mergebrief/releases/latest/download/version.json` | no | A mirror of `version.json`: an absolute `http` or `https` URL with no credentials in it. Empty refuses boot. |

### Retention and audit

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `PR_RETENTION_DAYS` | api, worker, migrate | unset (keep forever) | no | Days a closed or merged pull request is kept before the worker's daily sweep erases it with its briefs: a whole number of at least 1 ([Retention](./operations.md#retention-what-grows-and-what-does-not-prune-itself)). Empty reads as unset. |
| `AUDIT_RETENTION_DAYS` | api, worker, migrate | unset (keep forever) | no | Days the daily sweep keeps audit rows: a whole number of at least 30. Empty reads as unset. |
| `AUDIT_PRIVATE_WRITES` | api, worker, migrate | `true` | no | Boolean. `false` stops `api` recording writes that stay inside the instance; writes that reach GitHub and every denial are recorded either way. **Empty reads as `false`.** |
| `STORE_DISPLAY_NAMES` | api, worker, migrate | `true` | no | Boolean, parsed and validated; no code reads the parsed value yet, so it changes nothing. An invalid token still refuses boot. **Empty reads as `false`.** |

### Logging and tracing

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `LOG_LEVEL` | api, worker, web, migrate | `info` | no | `error`, `warn`, `info` or `debug`, lowercase. Anything else refuses boot. Empty takes the default. |
| `NODE_ENV` | api, worker, web, migrate | unset | no | `development` switches log output to pino-pretty, which the image does not ship, so the logger cannot start there. In `api`, `production` also turns off `MERGEBRIEF_OUT_DIR`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api, worker, web | unset (tracing off) | no | The OTLP base URL; `/v1/traces` is appended. An `http` or `https` URL, or boot refuses. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | api, worker, web | unset | no | The full traces URL. Wins over the base endpoint. |
| `OTEL_EXPORTER_OTLP_HEADERS` | api, worker, web | unset | no | `key=value,key=value`, values percent-encoded. A malformed entry refuses boot while an endpoint is set. Compose does not pass it to `web`. |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | api, worker, web | unset | no | Same format; wins over `OTEL_EXPORTER_OTLP_HEADERS`. Compose does not pass it to `web`. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | api, worker, web | `http/protobuf` | no | Only `http/protobuf` is accepted; anything else refuses boot while an endpoint is set. Compose does not pass it to `web`. |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | api, worker, web | unset | no | Same rule; wins over `OTEL_EXPORTER_OTLP_PROTOCOL`. Compose does not pass it to `web`. |
| `OTEL_TRACES_EXPORTER` | api, worker, web | `otlp` | no | `otlp`, or `none` to turn tracing off. Anything else refuses boot while an endpoint is set. Compose does not pass it to `web`. |
| `OTEL_SDK_DISABLED` | api, worker, web | unset | no | `true`, in any case, turns tracing off even with an endpoint set. |
| `OTEL_TRACES_SAMPLER` | api, worker, web | `parentbased_always_on` | no | One of `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio`. Anything else refuses boot while an endpoint is set. |
| `OTEL_TRACES_SAMPLER_ARG` | api, worker, web | `1` | no | The ratio for the ratio samplers, a number from 0 to 1. Anything else refuses boot while an endpoint is set. |
| `OTEL_RESOURCE_ATTRIBUTES` | api, worker, web | unset | no | `key=value,key=value`, values percent-encoded, added to every span's resource. |
| `OTEL_SERVICE_NAME` | api, worker, web | `mergebrief-api`, `mergebrief-worker`, `mergebrief-web` | no | Overrides the process's own service name. Leave it unset ([observability.md](./observability.md#tracing)). Compose does not pass it to `web`. |

Every `OTEL_*` variable reads empty as unset. Tracing is off until one of
the two endpoint variables is set, and `OTEL_SDK_DISABLED=true` or
`OTEL_TRACES_EXPORTER=none` turns it off again. While tracing is off, no
other `OTEL_*` variable is checked, so a bad value surfaces only once an
endpoint is set.

In compose, `api` and `worker` get every `OTEL_*` variable in `.env`. `web`
gets only the six its `environment:` block names:
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
`OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`
and `OTEL_SDK_DISABLED`. So `OTEL_SDK_DISABLED=true` is the one switch that
turns tracing off in all three; `OTEL_TRACES_EXPORTER=none` in `.env` turns
it off in `api` and `worker` while `web` keeps exporting, and a non-default
protocol refuses boot in `api` and `worker` but never reaches `web`.

### Set by the image

| Variable | Read by | Value | What it does |
| --- | --- | --- | --- |
| `SERVER_VERSION` | api, worker, migrate | the release version, stamped at image build; `dev` for a source build | The version recorded in `instance_version` and sent in the `MergeBrief-Version` header. Unset or empty means `dev`, which never checks for releases. An override must be printable ASCII without spaces, or boot refuses. |
| `MERGEBRIEF_RUNTIME` | api, worker | `compose-worker` | Marks the shipped image. `worker` refuses the harness CLI providers (`claude-code`, `codex`, `cursor`) under it; a check-only boot names `docker compose run --rm api migrate` as the fix; `api` turns off `MERGEBRIEF_OUT_DIR`. |

### Development only

| Variable | Read by | Default | What it does |
| --- | --- | --- | --- |
| `MERGEBRIEF_OUT_DIR` | api | unset | A directory of locally generated briefs the API serves to a dev checkout. Ignored under `MERGEBRIEF_RUNTIME=compose-worker` or `NODE_ENV=production`; blank reads as unset. |
| `ENABLE_LANGUAGE_SELECTION` | `vite build` of `web` | off | `true` or `1` shows the language picker. Read when the web bundle is built, not at run time, so it has no effect on a pulled image. |

### Compose file variables

`docker-compose.yml` interpolates these from `.env`; no process reads them
under these names.

| Variable | Default | What it does |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `code_review` each | The bundled Postgres's role, password and database, written on its first start only. Compose derives the in-network `DATABASE_URL` for `api` and `worker` from them, with `sslmode=disable` ([compose.md](./compose.md#1-postgres-credentials)). |
| `API_COUNT` | `1` | `api` replicas. `docker compose up --scale api=N` wins for that run. |
| `WORKER_COUNT` | `1` | `worker` replicas. Concurrent generations are `WORKER_COUNT` times `WORKER_CONCURRENCY`. |
| `COMPOSE_FILE` | unset | Compose's own variable. Set it to `docker-compose.external-db.yml` for an external database ([compose.md](./compose.md#external-postgres-managed-database)). |

The default compose file sets `DATABASE_URL`, `PUBLIC_BASE_URL`,
`MERGEBRIEF_API_HOST` and `MERGEBRIEF_API_PORT` in the services'
`environment:` blocks, and a service's `environment:` value wins over the
same variable in `.env`. The external-database file
passes `DATABASE_URL`, `DATABASE_URL_FILE` and `MERGEBRIEF_AUTO_MIGRATE`
through from `.env`.

### Read by the provider SDKs

The Anthropic and OpenAI SDKs inside `worker`, and the OTLP trace exporter
in `api`, `worker` and `web`, read these themselves; MergeBrief does not
parse them. The `OPENAI_*` pair applies to both the `openai` and
`openrouter` providers.

| Variable | Read by | Default | What it does |
| --- | --- | --- | --- |
| `ANTHROPIC_CUSTOM_HEADERS`, `OPENAI_CUSTOM_HEADERS` | worker | unset | `Name: value` lines, one per line, added to every request on the configured host. A line overrides the header of the same name, the API key or organization header included. Whoever sets the worker's environment owns them ([generators.md](./generators.md#the-six-providers)). |
| `ANTHROPIC_LOG`, `OPENAI_LOG` | worker | `warn` | The SDK's own log level: `off`, `error`, `warn`, `info` or `debug`, written to the worker's console outside the structured log. An unknown value logs one warning and keeps `warn`. |
| `OTEL_EXPORTER_OTLP_CERTIFICATE`, `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` | api, worker, web | unset | Path to a PEM root certificate the exporter trusts, for an `https` collector behind a private CA. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`, `OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE` | api, worker, web | unset | Path to a PEM client certificate chain, for a collector that requires mutual TLS. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_CLIENT_KEY`, `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY` | api, worker, web | unset | Path to the PEM private key for that client certificate. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION` | api, worker, web | `none` | `gzip` or `none`. The `TRACES_` form wins. |

The exporter reads its four pairs only while tracing is on, and empty reads
as unset. Paths resolve against the process's working directory, so the
files must be mounted into the container. A file it cannot read, or a
compression value other than `gzip` or `none`, logs a `tracing:` warning
and the exporter carries on without it; boot does not refuse. Compose
passes none of them to `web`.

### Variables that are not read

| Variable | What happens |
| --- | --- |
| `GENERATOR_API_KEY_ENV` | Removed. Set at all, even empty, the worker refuses boot and points at `generator.apiKeyEnv`. |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | Ignored; MergeBrief sets the export timeout itself. |
| `MERGEBRIEF_URL_BOX_TOKEN` | Renamed to `MERGEBRIEF_URL_FALLBACK_TOKEN`. Set and non-empty, `api` and `worker` log one warning naming the new key and ignore it. |
| `MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS` | Removed. Set and non-empty, `api` and `worker` log one warning and ignore it. |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_ADMIN_KEY` | Ignored by the API providers; `generator.baseUrl` is the only way to change the host ([generators.md](./generators.md#the-six-providers)). |

A harness CLI provider, run outside the image, receives only a short list of
the worker's variables: process basics, locale, proxy and CA settings, and
its own login variables ([generators.md](./generators.md#billing-what-subscription-actually-guarantees)).

### Empty values

A variable set to an empty string reads as unset, with these exceptions:

- **Refuses boot:** `MERGEBRIEF_CONFIG`, `MERGEBRIEF_API_HOST`,
  `MERGEBRIEF_API_PORT`, `MERGEBRIEF_WEB_HOST`, `MERGEBRIEF_WEB_PORT`,
  `MERGEBRIEF_UPDATE_CHECK_URL`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_APP_PRIVATE_KEY_PATH`, `GENERATOR_API_KEY_ENV`, and every
  required variable.
- **Reads as `false`:** `MERGEBRIEF_AUTO_MIGRATE`, `AUDIT_PRIVATE_WRITES`,
  `STORE_DISPLAY_NAMES`.

## Instance config (`mergebrief.config.yaml`)

`MERGEBRIEF_CONFIG` locates it. No file runs the defaults below; an empty
file does the same. The image carries no config file, so mount it into
`api` and `worker` ([The config file](./generators.md#the-config-file)).
Edits apply on restart. A credential is never a value here: the file names
the variable that holds it.

### Root keys

| Key | Read by | Default when absent | What it holds |
| --- | --- | --- | --- |
| `generator` | worker | `provider: anthropic` | The generation backend. |
| `drafts` | api; worker validates | `generate: on`, no extra debounce | Draft pull request policy. |
| `spend` | worker; api reads it too | `maxGenerationsPerDay: 300` | The daily generation cap. |
| `operators` | api; worker validates | nobody | The GitHub user ids of the instance's Operators. |
| `contextSources` | worker | built-in sources only | Ticket sources that need a credential. |
| `trackers` | worker | none: GitHub issues only | The boards every repository reads tickets from. |
| `linkFetch` | worker | `mode: public` | Which links in a PR description the worker may fetch. |
| `x-*` | nobody | | Any root key starting with `x-` is ignored. |

Any other root key refuses boot in `worker`. `api` reads only `drafts`,
`spend` and `operators`, so it ignores the rest of the file and needs no
provider key. Every block rejects keys it does not define.

### `generator`

`provider` picks the entry; the other keys depend on it.

| Key | Providers | Default | Accepts |
| --- | --- | --- | --- |
| `provider` | all | required in the block; `anthropic` when the `generator` block is absent | `anthropic`, `claude-code`, `codex`, `cursor`, `openai`, `openrouter`. |
| `model` | all | `anthropic`, `claude-code`: `claude-opus-4-8`; `codex`, `cursor`: the CLI's configured default | A non-empty model id. Required for `openai` and `openrouter` (an OpenRouter slug such as `anthropic/claude-opus-4.8`). For `cursor`, an id from `cursor-agent --list-models`; an id with `[` refuses boot. |
| `effort` | all | `medium` | `low`, `medium` or `high`. |
| `full-regeneration` | all | `never` | `never` (each revision anchors to the previous brief), `on-model-swap` (a fresh brief when the provider or model changed), `always` (every revision from scratch). |
| `apiKeyEnv` | `anthropic`, `openai`, `openrouter` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | The NAME of the variable holding the key. A value that is not an uppercase variable name refuses boot. |
| `baseUrl` | `anthropic`, `openai` | the provider's own host | A URL. `anthropic` takes the gateway's host root; a path ending in `/v1` refuses boot. `openai` takes the `/v1` root of a gateway or compatible server, and turns the `/models` check at boot into a warning. |
| `providerRouting` | `openrouter` | none | A mapping passed to OpenRouter under `provider`; `require_parameters: true` is always forced. |
| `referer`, `title` | `openrouter` | none | Non-empty strings sent as attribution headers. |
| `command` | `claude-code`, `codex`, `cursor` | `claude`, `codex`, `cursor-agent` | The CLI binary, a path or a name on `PATH`. |
| `timeouts.hardMs` | `claude-code`, `codex`, `cursor` | `900000` (15 minutes) | Positive whole milliseconds: the wall-clock cap on one run. |
| `timeouts.inactivityMs` | `claude-code`, `codex`, `cursor` | `180000` (3 minutes); `cursor`: `hardMs` | Positive whole milliseconds without output before the run is stopped. |
| `timeouts.killGraceMs` | `claude-code`, `codex`, `cursor` | `5000` | Positive whole milliseconds between the stop signal and the kill. |

The harness providers are refused in the shipped image
([generators.md](./generators.md#harness-clis-are-host-process-only-in-v1-deliberately)).

### `drafts`, `spend`, `operators`

| Key | Default | Accepts |
| --- | --- | --- |
| `drafts.generate` | `on` | `on`, `off`, `true` or `false`. `off` holds a draft's first brief until it is marked ready ([repo-config.md](./repo-config.md#related-instance-block-drafts-operator-side)). |
| `drafts.debounceSeconds` | unset (the normal window) | A positive number of seconds: the debounce for a draft's regenerations. |
| `spend.maxGenerationsPerDay` | `300` | A positive whole number, or `unlimited` for no cap ([Daily generation cap](./generators.md#daily-generation-cap)). |
| `operators` | empty list | A list of up to 100 GitHub user ids, positive whole numbers, never logins. A bare `operators:` with no list refuses boot ([Operators](./generators.md#operators)). |

### `contextSources`, `trackers`

| Key | Default | Accepts |
| --- | --- | --- |
| `contextSources` | empty list | A list with at most one entry per `type`. URLs and GitHub issues are built in and need no entry. |
| `contextSources[].type` | | `notion`. |
| `contextSources[].tokenEnv` | `NOTION_TOKEN` | The NAME of the variable holding the Notion integration token. |
| `trackers` | none | A list of 1 to 8 entries, at most one `github` entry, and no `keyPrefix` on two boards (compared case-insensitively). A repository's own `trackers:` replaces this list ([trackers.md](./trackers.md)). |
| `trackers[].kind` | | `notion` or `github`. A `notion` entry refuses boot unless `contextSources` carries a `notion` entry whose token is set. |
| `trackers[].keyPrefix` | | `notion` only, required: a letter followed by up to 19 letters, digits or underscores. |
| `trackers[].databaseId` | | `notion` only, required: the database or data source id, 32 hex characters with or without dashes. |
| `trackers[].issuesRepo` | the pull request's repository | `github` only, optional: `owner/name`, where a bare `#N` resolves. `.` and `..` are refused as either part. |
| `trackers[].siblingRepos` | `false` | `github` only, instance config only: `true` lets issue references resolve in every repository the installation covers, not only the pull request's repository and its `issuesRepo` ([trackers.md](./trackers.md#credential-and-reach)). Anything but `true` or `false` refuses boot. |

### `linkFetch`

The worker fetches up to five links from a PR description as context
([trackers.md](./trackers.md#links-in-the-description)). This block narrows
which ones. It does not touch the primary ticket, which the tracker reads.

| Key | Default | Accepts |
| --- | --- | --- |
| `linkFetch.mode` | `public` | `public`: any link that passes the address and port checks. `off`: no link is fetched. `allowlist`: only links whose host is listed in `hosts`. |
| `linkFetch.hosts` | | `allowlist` only, and required there: exact lowercase host names such as `docs.example.com`, with no scheme, port, path or wildcard. Write an international name in its `xn--` form. Each subdomain needs its own entry. A listed host still passes every address and port check. |
| `linkFetch.maxTotalChars` | `40000` | A whole number above zero: the most linked-page text one prompt carries. Links fill it in the order the description lists them. The link that crosses it is cut, and later links are left out. Each page is also cut at 20,000 characters on its own. The primary ticket has its own limit and does not count. |

```yaml
linkFetch:
  mode: allowlist
  hosts:
    - docs.example.com
    - wiki.example.com
```

The address checks refuse private, loopback, link-local and reserved
ranges, but they cannot tell an internal service on a routable address
from the public internet: a service on a public IPv4 address or a cloud
IPv6 range answers like any website, and the text it returns reaches the
prompt and can be quoted in the brief. If the worker can reach such
services, restrict its egress at the network: a network policy, security
group or firewall rule that lets the worker reach only GitHub, the model
provider, your ticket trackers and the hosts you want linked. Link fetches
ignore `HTTP_PROXY` and `NODE_USE_ENV_PROXY`, so a forward proxy works here
only as a gateway the network routes the worker through. `linkFetch` with
`off` or `allowlist` is the in-app control; the network policy is the one
that holds.

## Repo-local files (`.mergebrief/`)

A repository configures its own briefs with files on its default branch,
read fresh per generation. An invalid or over-budget file is dropped whole
and the brief says so; it never stops the instance.
[repo-config.md](./repo-config.md) is the full reference;
[`docs/repo-config/`](../repo-config/authoring.md) holds the authoring guide
and a template for `instructions.md`.

| File | Size limit | Keys |
| --- | --- | --- |
| `instructions.md` | 16 KB | Free text within the documented instruction classes. |
| `settings.yaml` | 4 KB | `version: 1` (required), `entryCommentOnDrafts` (default `true`), `tracker` or `trackers` (one of the two; same entry shape as the instance `trackers`), `trustedBots` (up to 32 GitHub logins). |
| `policy.yaml` | 32 KB | `version: 1` (required), `attributes` (required; up to 20 custom risk attributes, each with `criteria` and optional `implication` and `paths`), `deEmphasize` (optional; never a floor attribute). |

## CLI

The `mergebrief` CLI reads its own environment on the machine that runs it.
It never reads the server's variables.

### Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `MERGEBRIEF_PROFILE` | unset | Picks the profile, like `--profile`; the flag wins. A name with no configured profile is a usage error. `auth login` writes to it, or to `default` when unset. |
| `MERGEBRIEF_TOKEN` | unset | Replaces the resolved profile's stored token; it never changes which profile resolves. |
| `MERGEBRIEF_NO_VERSION_WARNING` | unset | Set to any value, even empty, it silences the update line and the major-version warning, and the CLI stops asking npm ([Versions](./cli.md#versions)). |
| `XDG_CONFIG_HOME` | `~/.config` | The CLI keeps `mergebrief/config.json` under it. |
| `XDG_CACHE_HOME` | `~/.cache` | The CLI keeps `mergebrief/update-check.json` under it. |
| `PAGER` | unset | `diff` on a terminal pipes through it. |
| `npm_command` | set by npm | `exec`, as under `npx`, makes the update hints suggest `npx mergebrief@x.y.z` instead of `npm i -g`. |

### `config.json`

`auth login` writes `<XDG_CONFIG_HOME>/mergebrief/config.json` with
owner-only permissions. A file that is not valid JSON, or that breaks this
shape, fails every command that reads it.

| Key | Default | What it holds |
| --- | --- | --- |
| `defaultProfile` | the first profile logged into | The profile used when nothing else picks one. With no default and exactly one profile, that one is used. |
| `profiles.<name>.baseUrl` | | The deployment's URL. Required. |
| `profiles.<name>.token` | | The API token, stored in plain text. `MERGEBRIEF_TOKEN` overrides it. |
| `profiles.<name>.owners` | | GitHub owners whose clones pick this profile, matched on the `origin` remote. |
| `profiles.<name>.headers` | | Extra headers sent on every request, for a proxy in front of the API ([cli.md](./cli.md#idp--sso-proxies-exempt-api)). |

Profile resolution runs `--profile` or `MERGEBRIEF_PROFILE`, then an
`owners` match, then the default profile ([Profiles](./cli.md#profiles-multiple-deployments)).
