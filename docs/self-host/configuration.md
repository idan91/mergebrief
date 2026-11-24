# Configuration reference: .env and mergebrief.config.yaml

Every setting MergeBrief reads, in one place. There are four surfaces:

- **Environment variables**, read by the `api`, `web`, `worker` and `migrate` processes at boot. Secrets, capacity and addresses live here.
- **The instance config file**, `mergebrief.config.yaml`, read from the workspace root or from the path `MERGEBRIEF_CONFIG` gives. Provider, model, spend and instance policy live here.
- **Repo-local files** under `.mergebrief/` in each repository, read from the default branch per generation.
- **The CLI's own environment and `config.json`** on the machine that runs `mergebrief`.

This page says what each setting accepts. The how-to pages ([compose.md](./compose.md), [generators.md](./generators.md), [upgrade.md](./upgrade.md), [secrets.md](./secrets.md), [data-and-scaling.md](./data-and-scaling.md), [observability.md](./observability.md)) say when to change one.

## Apply a change

Run these in the folder that holds `docker-compose.yml`. What applies a change depends on the file you changed:

| You changed | Run | Why |
| --- | --- | --- |
| `.env` | `docker compose up -d` | It recreates each service whose environment changed. `docker compose restart` keeps the environment the container was created with, so the old value stays. |
| `mergebrief.config.yaml` | `docker compose restart` and the services that read the block, from the table below | Compose mounts the file, so a restarted process reads it again. A bad value refuses that service's boot. |
| A repository's `.mergebrief/` files | Nothing | They are read from the default branch per generation, so a change applies from the next generation after it merges ([Configure your repository](../repo-config/README.md)). |

| Block in `mergebrief.config.yaml` | Restart |
| --- | --- |
| `generator`, `contextSources`, `trackers`, `triggerConditions`, `linkFetch`, `retention` | `docker compose restart worker` |
| `drafts`, `operators`, `allowed`, `attachments`, `audit`, `updateCheck` | `docker compose restart api` |
| `spend` | `docker compose restart api worker` |

`docker compose restart api worker` is always safe. After changing both files, run `docker compose up -d` first, then the restart the config change needs: `up -d` leaves a service alone when its environment did not change.

**Check:** `docker compose ps -a` shows `api` and `web` as `healthy` and `worker` as `Up`. A service at `Exited (0)` refused the change, and the last line of its log names the variable or key ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)).

## Which value wins

- **Compose's `environment:` over `.env`.** For `api` and `worker`, a variable the default compose file sets under `environment:` wins over the same name in `.env`: `DATABASE_URL`, `PUBLIC_BASE_URL`, `MERGEBRIEF_API_HOST`, `MERGEBRIEF_API_PORT` and `MERGEBRIEF_CONFIG` ([What compose passes to each service](#what-compose-passes-to-each-service)). `PUBLIC_BASE_URL` still comes from `.env`, because compose interpolates it into that block.
- **The config file's path is fixed under compose.** `docker-compose.yml` sets `MERGEBRIEF_CONFIG=/app/mergebrief.config.yaml` and mounts the file beside it there, so `MERGEBRIEF_CONFIG` in `.env` never reaches a container. To use a file elsewhere, change the mount's source in `docker-compose.override.yml` ([The config file](./generators.md#the-config-file)).
- **`DATABASE_URL_FILE` over `DATABASE_URL`,** with a warning at boot when both are set.
- **A variable that moved into the config file refuses boot** while it is still set, or logs a warning, naming its replacement; the old value is never read ([Renamed and removed variables](./upgrade.md#renamed-and-removed-variables)).
- **A repository's file over the instance's, per setting.** A repository's `triggerConditions` merge over the instance's per kind, and its `trackers` list replaces the instance's whole. The provider, model, spend cap and sign-in lists are the instance's alone ([What a repository controls](./repo-config.md#what-a-repository-controls-and-what-you-keep)).

## How values are read

- **A bad value refuses boot.** A process that reads a variable checks it before it does anything else, logs the variable's name and the reason, and exits. A secret's value is never logged; a few variables that hold no secret, such as `LOG_LEVEL`, quote the value they refused. `api` and `worker` exit 0 on a config error so compose's `restart: on-failure` leaves them down; `web` and `migrate` exit 1, so `web` restarts until the value is fixed. The one exception is `MERGEBRIEF_API_ORIGIN`, which `web` checks on its first request instead.
- **Empty is not always unset.** Compose passes `${VAR:-}` through as an empty string. Most variables treat empty as unset; the exceptions are named in the tables and listed in [Empty values](#empty-values). The safe habit is the one [compose.md](./compose.md) gives: leave a variable out entirely when it does not apply.
- **Booleans** differ by variable. `MERGEBRIEF_AUTO_MIGRATE` accepts `true`, `1`, `yes`, `on` and `false`, `0`, `no`, `off`, in any case; any other token refuses boot. `OTEL_SDK_DISABLED` is on only for `true`, in any case; any other value leaves tracing on. The build-time `ENABLE_*` variables are on for `true` or `1`.
- **Credentials are named, not inlined, in the config file.** Keys such as `generator.apiKeyEnv` and `contextSources[].tokenEnv` hold the NAME of an environment variable (uppercase letters, digits and underscores). The value stays in the environment.
- **A multi-line value goes in single quotes.** Compose reads a single-quoted value in `.env` as written, line breaks included, and expands no `$` inside it. The App's private key is the usual case: paste the whole `.pem` file.

  ```dotenv
  GITHUB_APP_PRIVATE_KEY='-----BEGIN RSA PRIVATE KEY-----
  MIIEpAIBAAKCAQEA...
  -----END RSA PRIVATE KEY-----'
  ```

### Where each process gets its environment

| Process | Started by | In compose |
| --- | --- | --- |
| `api` | `docker-entrypoint.sh api` | `env_file: .env`, plus the service's `environment:` block, which wins |
| `worker` | `docker-entrypoint.sh worker` | `env_file: .env`, plus `environment:` |
| `web` | `docker-entrypoint.sh web` | no `env_file`: only what the service's `environment:` block sets |
| `migrate` | `docker compose run --rm api migrate` | the `api` service's environment |

The image holds no `.env` file, so compose's `env_file` and `environment:` are the whole input. Fill in the `.env` beside the compose file, from `.env.example` ([What compose passes to each service](#what-compose-passes-to-each-service)).

A source checkout reads `.env` files instead ([CONTRIBUTING.md](../../CONTRIBUTING.md#environment-in-a-source-checkout)).

## Environment variables

Columns: **Read by** names every process that parses the variable, so a bad value refuses boot in each of them unless the row says otherwise. **Required** means boot refuses without it.

### GitHub App and sign-in

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `GITHUB_APP_ID` | api, worker | none | yes | The App's numeric id, digits only. |
| `GITHUB_APP_PRIVATE_KEY` | api, worker | none | one of the pair | The App's PEM private key, inline. Exactly one of this and `GITHUB_APP_PRIVATE_KEY_PATH` may be set; both, neither, or an empty value refuses boot. Quote a multi-line value in `.env`. |
| `GITHUB_APP_PRIVATE_KEY_PATH` | api, worker | none | one of the pair | Path to a file holding the PEM. Under compose, mount the file into `api` and `worker` at this path. An unreadable or empty file refuses boot. |
| `GITHUB_WEBHOOK_SECRET` | api, worker | none | yes | The HMAC secret GitHub signs deliveries with. At least 32 characters after trimming; the HMAC keys on the value as set. Only `api` verifies deliveries. |
| `GITHUB_OAUTH_CLIENT_ID` | api, worker | none | yes | The App's OAuth client id, for reviewer sign-in. The worker uses it to revoke a dead grant's token at GitHub. |
| `GITHUB_OAUTH_CLIENT_SECRET` | api, worker | none | yes | The App's OAuth client secret. |
| `GITHUB_APP_SLUG` | api, worker | unset | no | The App's URL name, the last segment of `https://github.com/apps/<slug>`: lowercase letters, digits and hyphens. Set, Home links a viewer with no reachable installation to the install page; unset, that line carries no link. Empty reads as unset. |
| `MERGEBRIEF_URL_FALLBACK_TOKEN` | api, worker | unset | no | A GitHub token (fine-grained, Contents and Pull requests read) tried after a reviewer's own token is denied on a pasted pull request. A sign-in token is scoped to the App's installations, so it cannot read a private repository the App is not installed on; a public repository needs no such token. It serves only the GitHub account that owns it ([compose.md](./compose.md#hardening-before-real-exposure)). Empty reads as unset. |
| `SESSION_KEY_REF` | api | `SESSION_KEY_V1` | no | The NAME of the variable new GitHub tokens are sealed under: an uppercase letter, then uppercase letters, digits or underscores. Anything else refuses boot. Empty takes the default. |
| `SESSION_KEY_V1` (or the name `SESSION_KEY_REF` gives) | api, worker | none | api: yes | Base64 of exactly 32 bytes (`openssl rand -base64 32`). `api` resolves the variable `SESSION_KEY_REF` names at boot and refuses when it is missing, not base64, or the wrong length. Each stored grant names its own key variable, and both services open it by that name when they need it (the worker for pasted pull requests and the hourly sweep's GitHub revokes), so a rotated-out key stays set until no grant names it ([Tokens at rest](./secrets.md#how-github-tokens-are-stored)). |
| `SESSION_KEY_V2`, and any later `SESSION_KEY_V<n>` | api, worker | none | api: when `SESSION_KEY_REF` names it | A rotated session key, in the same format as `SESSION_KEY_V1`. Nothing reads it until `SESSION_KEY_REF` names it; from then on new tokens are sealed under it, and it stays set while any stored grant names it. The numbering is a convention, not a rule: any name `SESSION_KEY_REF` accepts works the same way. Rotate under a new name, never by changing a value in place ([Tokens at rest](./secrets.md#how-github-tokens-are-stored)). |

### Database

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | api, worker, migrate | none | yes, unless `DATABASE_URL_FILE` is set | A `postgres://` or `postgresql://` URL. A host that is not loopback (`localhost`, `127.0.0.0/8`, `::1`, or a unix socket path) must carry `sslmode=verify-full` or `sslmode=disable`, and `uselibpqcompat=true` only beside `verify-full`; anything else refuses boot ([TLS](./compose.md#tls-verify-full-or-disable-sslmode-in-the-dsn)). A file the DSN names, such as `sslrootcert`, that cannot be read refuses boot naming the path. The default compose file sets its own value, so there this is ignored; `pnpm app:host` and an external database need it. |
| `DATABASE_URL_FILE` | api, worker, migrate | unset | no | Path to a file holding the DSN, trimmed, for a compose `secrets:` mount. Wins over `DATABASE_URL` and logs a warning when `DATABASE_URL` is also set and non-empty. An unreadable file refuses boot. Empty reads as unset. |
| `DATABASE_POOL_MAX` | api, worker, migrate | `10` | no | Connections each Postgres pool opens at most: a whole number of at least 2. An `api` opens one pool; a `worker` opens two at this size, its store and its job queue, plus the large pool's job queue at `WORKER_LARGE_CONCURRENCY` + 2. A request waits up to 10 seconds for a free connection, then fails. Keep `api` replicas x this value + `worker` count x (2 x this value + `WORKER_LARGE_CONCURRENCY` + 2) under Postgres `max_connections` ([data-and-scaling.md](./data-and-scaling.md#run-more-than-one-api)). Empty takes the default. |
| `MERGEBRIEF_AUTO_MIGRATE` | api, worker, migrate | `true` | no | `true` applies pending migrations at boot. `false` makes boot a read-only check that exits 1 when the database is behind; apply the migrations with `docker compose run --rm api migrate`, or `pnpm -C apps/api migrate` from a checkout ([upgrade.md](./upgrade.md#upgrade-with-a-restricted-database-role)). `migrate` always applies. **Empty reads as `false`.** |

### Addresses and listeners

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | api, worker, web | compose: `http://localhost:3000` | api, worker: yes | The origin reviewers browse, matching the GitHub App's OAuth callback origin. An absolute `http` or `https` URL with no credentials in it, or `api` and `worker` refuse boot. Write the origin alone, with no trailing slash and no path: `api` appends `/api/auth/github/callback` to the value as written, so `https://brief.example.com/` sends GitHub a callback with `//` that does not match the App's. MergeBrief serves from the root of its host; a subpath is unsupported. `api` builds the OAuth callback from it and accepts a state-changing browser request only from its origin; `worker` builds the Entry comment's links from it; `web` adds its hostname to the hosts it serves, builds the share image's absolute URL from it, and refuses boot on a value that does not parse. Unset or empty in `web` serves `localhost` names and bare IPs only. |
| `MERGEBRIEF_API_HOST` | api | `127.0.0.1` | no | The address the API listens on. Compose sets `0.0.0.0` so `web` can reach it. Empty refuses boot. |
| `MERGEBRIEF_API_PORT` | api | `3001` | no | The API's port, digits only, 0 to 65535. Compose sets `3001`. Empty refuses boot. |
| `MERGEBRIEF_API_ORIGIN` | web | `http://127.0.0.1:3001` | no | Where `web` proxies `/api/*` and sends its server-side reads: an absolute `http` or `https` URL, reduced to its origin. Compose sets `http://api:3001`. Empty takes the default. Checked on the first request, not at boot: a bad value lets `web` start and pass its healthcheck, then fails every proxied and server-rendered request. |
| `MERGEBRIEF_WEB_HOST` | web | `0.0.0.0` | no | The address the web server listens on. `web` reads no `.env`: set it under the service's `environment:` in the override file. Empty refuses boot. |
| `MERGEBRIEF_WEB_PORT` | web | `3000` | no | The web server's port, a whole number from 1 to 65535. Set it the same way as `MERGEBRIEF_WEB_HOST`, and move the service's port mapping and healthcheck with it. Empty refuses boot. |

### Instance config, generation and the worker

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `MERGEBRIEF_CONFIG` | api, worker | `mergebrief.config.yaml` at the workspace root, when that file exists; `/app/mergebrief.config.yaml` under compose | no | Path to `mergebrief.config.yaml`. `docker-compose.yml` sets it to the file it mounts, so a value in `.env` reaches host processes only. Unset, a process reads the workspace root's `mergebrief.config.yaml`, and runs the zero-config defaults when there is none. A relative path resolves against the workspace root (the nearest directory above the working directory holding `pnpm-workspace.yaml`); an absolute one passes through. Set but empty, unreadable, not YAML, or a root that is not a mapping refuses boot. `api` reads only the `drafts`, `spend`, `operators`, `allowed`, `attachments`, `audit` and `updateCheck` blocks; `worker` reads the whole file ([Instance config](#instance-config-mergebriefconfigyaml)). |
| `ANTHROPIC_API_KEY` | worker | none | with the default provider | The key the zero-config `anthropic` provider reads. `generator.apiKeyEnv` names another variable. A provider whose key variable is unset or empty refuses boot. |
| `OPENAI_API_KEY` | worker | none | with `provider: openai` | The `openai` provider's default key variable; same rules. |
| `OPENROUTER_API_KEY` | worker | none | with `provider: openrouter` | The `openrouter` provider's default key variable; same rules. |
| `WORKER_CONCURRENCY` | worker | `1` | no | Jobs one worker process runs at once: a whole number of at least 1 ([Worker slots](./generators.md#worker-slots)). Empty takes the default. |
| `WORKER_LARGE_CONCURRENCY` | worker | `1` | no | Slots of the large pool, which runs the multi-call briefs: a whole number of at least 1 ([The large pool](./generators.md#the-large-pool)). Empty takes the default. |
| `NOTION_TOKEN` (or the name `contextSources[].tokenEnv` gives) | worker | none | when a `notion` context source is configured | The Notion integration token. Unset or empty refuses boot while the config lists a `notion` entry ([trackers.md](./trackers.md#connect-notion)). |
| `JIRA_EMAIL` (or the name `contextSources[].emailEnv` gives) | worker | none | when a `jira` context source is configured | The email of the Atlassian account that owns the Jira API token. Unset or empty refuses boot while the config lists a `jira` entry ([trackers.md](./trackers.md#connect-jira)). |
| `JIRA_API_TOKEN` (or the name `contextSources[].tokenEnv` gives) | worker | none | when a `jira` context source is configured | The Jira API token, scoped to `read:jira-work`. Same rules. |

### Logging and tracing

| Variable | Read by | Default | Required | Accepts and does |
| --- | --- | --- | --- | --- |
| `LOG_LEVEL` | api, worker, web, migrate | `info` | no | `error`, `warn`, `info` or `debug`, lowercase. Anything else refuses boot. Empty takes the default. Compose does not pass it to `web`: set it under the service's `environment:` in the override file. |
| `NODE_ENV` | api, worker, web, migrate | `production` in the image; unset in a source checkout | no | `production` makes `web` render pages with the production builds of React and its router; anything else renders with their development builds, which cost up to 1.6x the CPU per page on a large brief. `development` switches log output to pino-pretty, which the image does not ship, so the logger cannot start there. In `api`, `production` also turns off the dev-only `MERGEBRIEF_OUT_DIR` ([CONTRIBUTING.md](../../CONTRIBUTING.md#environment-in-a-source-checkout)). |
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

Every `OTEL_*` variable reads empty as unset. Tracing is off until one of the two endpoint variables is set, and `OTEL_SDK_DISABLED=true` or `OTEL_TRACES_EXPORTER=none` turns it off again. While tracing is off, no other `OTEL_*` variable is checked, so a bad value surfaces only once an endpoint is set.

In compose, `api` and `worker` get every `OTEL_*` variable in `.env`. `web` gets only the six its `environment:` block names: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` and `OTEL_SDK_DISABLED`. So `OTEL_SDK_DISABLED=true` is the one switch that turns tracing off in all three; `OTEL_TRACES_EXPORTER=none` in `.env` turns it off in `api` and `worker` while `web` keeps exporting, and a non-default protocol refuses boot in `api` and `worker` but never reaches `web`.

### Set by the image

| Variable | Read by | Value | What it does |
| --- | --- | --- | --- |
| `SERVER_VERSION` | api, worker, migrate | the release version, stamped at image build; `dev` for a source build | The version recorded in `instance_version` and sent in the `MergeBrief-Version` header. Unset or empty means `dev`, which never checks for releases. An override must be printable ASCII without spaces, or boot refuses. |
| `MERGEBRIEF_RUNTIME` | api, worker | `compose-worker` | Marks the shipped image. `worker` refuses the harness CLI providers (`claude-code`, `codex`, `cursor`) under it; a check-only boot names `docker compose run --rm api migrate` as the fix; `api` turns off `MERGEBRIEF_OUT_DIR`. |

### Source checkout only

These do nothing in the shipped image. They matter only when you run MergeBrief's processes on the host or build it yourself.

| Variable | What it does |
| --- | --- |
| `MERGEBRIEF_OUT_DIR` | A folder of locally generated briefs `api` serves to a signed-in session. Off under `MERGEBRIEF_RUNTIME=compose-worker` or `NODE_ENV=production` ([CONTRIBUTING.md](../../CONTRIBUTING.md#environment-in-a-source-checkout)). |
| `CURSOR_API_KEY`, and the login variables of the other CLI providers | Read by the `claude-code`, `codex` and `cursor` providers, which run only as host processes ([Subscription CLI providers: contributor notes](../dev/harness-cli-providers.md#environment-a-cli-receives)). |
| `ENABLE_LANGUAGE_SELECTION` and any other `ENABLE_*` | Read when the web bundle is built, so a pulled image ignores them ([CONTRIBUTING.md](../../CONTRIBUTING.md#environment-in-a-source-checkout)). |

### Compose file variables

`docker-compose.yml` interpolates these from `.env`; no process reads them under these names.

| Variable | Default | What it does |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `mergebrief` each | The bundled Postgres's role, password and database, written on its first start only. Compose derives the in-network `DATABASE_URL` for `api` and `worker` from them, with `sslmode=disable` ([compose.md](./compose.md#1-postgres-credentials)). While the connection string carries the password `mergebrief` and the host is not loopback, `api` and `worker` warn at every boot: `the database password is the one docker-compose.yml ships`. The bundled `postgres` service counts, since its host is `postgres`. |
| `API_COUNT` | `1` | `api` replicas. `docker compose up --scale api=N` wins for that run. Every replica serves every request, with the caveats in [data-and-scaling.md](./data-and-scaling.md#run-more-than-one-api). |
| `WORKER_COUNT` | `1` | `worker` replicas. `docker compose up --scale worker=N` wins for that run. Concurrent generations are `WORKER_COUNT` times the sum of `WORKER_CONCURRENCY` and `WORKER_LARGE_CONCURRENCY`. |
| `COMPOSE_FILE` | unset | Compose's own variable. Set it to `docker-compose.yml:docker-compose.external-db.yml` for an external database, and append `:docker-compose.override.yml` once you have an override file, since setting it turns off the automatic load ([compose.md](./compose.md#external-postgres-managed-database)). |

### What compose passes to each service

A service's `environment:` value wins over the same variable in `.env`.

| Service | From `.env` | Set by the default compose file |
| --- | --- | --- |
| `postgres` | nothing directly | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, interpolated from `.env` |
| `api` | every variable (`env_file`) | `DATABASE_URL` (derived), `PUBLIC_BASE_URL`, `MERGEBRIEF_API_HOST=0.0.0.0`, `MERGEBRIEF_API_PORT=3001`, `MERGEBRIEF_CONFIG=/app/mergebrief.config.yaml` |
| `worker` | every variable (`env_file`) | `DATABASE_URL` (derived), `PUBLIC_BASE_URL`, `MERGEBRIEF_CONFIG=/app/mergebrief.config.yaml` |
| `web` | nothing (no `env_file`) | `PUBLIC_BASE_URL`, `MERGEBRIEF_API_ORIGIN=http://api:3001`, and the six `OTEL_*` variables named [above](#logging-and-tracing), interpolated from `.env` |

`docker-compose.external-db.yml`, layered on the default file, removes the `postgres` service and derives nothing: `api` and `worker` take `DATABASE_URL`, `DATABASE_URL_FILE` and `MERGEBRIEF_AUTO_MIGRATE` from the shell running compose when set there, else from `.env`. With or without the overlay `DATABASE_URL_FILE` wins over `DATABASE_URL`, so setting it under the default file moves the services off the bundled database.

### Read by the provider SDKs

The Anthropic and OpenAI SDKs inside `worker`, and the OTLP trace exporter in `api`, `worker` and `web`, read these themselves; MergeBrief does not parse them. The `OPENAI_*` pair applies to both the `openai` and `openrouter` providers.

| Variable | Read by | Default | What it does |
| --- | --- | --- | --- |
| `ANTHROPIC_CUSTOM_HEADERS`, `OPENAI_CUSTOM_HEADERS` | worker | unset | `Name: value` lines, one per line, added to every request on the configured host. A line overrides the header of the same name, the API key or organization header included. Whoever sets the worker's environment owns them ([generators.md](./generators.md#route-through-a-gateway-or-your-own-server)). |
| `ANTHROPIC_LOG`, `OPENAI_LOG` | worker | ignored | The provider SDKs' own log level. The worker pins it to `warn` and ignores both variables: at `debug` an SDK prints each request body in full, the pull request's code included, to the console and outside the structured log. |
| `OTEL_EXPORTER_OTLP_CERTIFICATE`, `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` | api, worker, web | unset | Path to a PEM root certificate the exporter trusts, for an `https` collector behind a private CA. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`, `OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE` | api, worker, web | unset | Path to a PEM client certificate chain, for a collector that requires mutual TLS. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_CLIENT_KEY`, `OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY` | api, worker, web | unset | Path to the PEM private key for that client certificate. The `TRACES_` form wins. |
| `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION` | api, worker, web | `none` | `gzip` or `none`. The `TRACES_` form wins. |

The exporter reads its four pairs only while tracing is on, and empty reads as unset. Paths resolve against the process's working directory, so the files must be mounted into the container. A file it cannot read, or a compression value other than `gzip` or `none`, logs a `tracing:` warning and the exporter carries on without it; boot does not refuse. Compose passes none of them to `web`.

### Variables MergeBrief ignores

| Variable | What happens |
| --- | --- |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | Ignored; MergeBrief sets the export timeout itself. |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_ADMIN_KEY` | Ignored by the API providers; `generator.baseUrl` is the only way to change the host ([generators.md](./generators.md#route-through-a-gateway-or-your-own-server)). |

A variable an older release read, renamed or moved into `mergebrief.config.yaml`, refuses boot or logs a warning naming its replacement ([Renamed and removed variables](./upgrade.md#renamed-and-removed-variables)).

### Empty values

A variable set to an empty string reads as unset, with these exceptions:

- **Refuses boot:** `MERGEBRIEF_CONFIG`, `MERGEBRIEF_API_HOST`, `MERGEBRIEF_API_PORT`, `MERGEBRIEF_WEB_HOST`, `MERGEBRIEF_WEB_PORT`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GENERATOR_API_KEY_ENV`, and every required variable.
- **Reads as `false`:** `MERGEBRIEF_AUTO_MIGRATE`.

## Instance config (`mergebrief.config.yaml`)

A process reads `mergebrief.config.yaml` from its workspace root, or the file `MERGEBRIEF_CONFIG` names. No file runs the defaults below; an empty file does the same. Those defaults name no Operator, so nobody can sign in until the file lists one. The image carries no config file: `docker-compose.yml` mounts the one beside it into `api` and `worker` ([The config file](./generators.md#the-config-file)). Edits apply when the services that read the block restart ([Apply a change](#apply-a-change)). A credential is never a value here: the file names the variable that holds it.

### Root keys

| Key | Read by | Default when absent | What it holds |
| --- | --- | --- | --- |
| `generator` | worker | `provider: anthropic` | The generation backend. |
| `drafts` | api; worker validates | no extra debounce | Draft pull request debounce. |
| `spend` | worker; api reads it too | `maxGenerationsPerDay: 300` | The daily generation cap. |
| `operators` | api; worker validates | nobody, so nobody can sign in | The GitHub user ids of the instance's Operators. |
| `allowed` | api; worker validates | Operators alone | Who else may sign in and start a brief. |
| `contextSources` | worker | built-in sources only | Ticket trackers that need a deployment credential. |
| `trackers` | worker | none: GitHub issues only | The boards and Jira projects every repository reads tickets from. |
| `triggerConditions` | worker | none | Conditions every push must meet before it generates; a repository's own block merges over them per kind. |
| `linkFetch` | worker | `mode: public` | Which links in a PR description the worker may fetch. |
| `retention` | worker | keep forever | How long the daily sweeps keep audit rows and closed pull requests. |
| `audit` | api; worker validates | `privateWrites: true` | Whether writes that stay inside the instance are recorded. |
| `attachments` | api; worker validates | 10 files or 30 MB per 10 minutes, 100 MB of media | What one reviewer may upload, and the largest media file the API streams. |
| `updateCheck` | api; worker validates | `enabled: true`, the project's own release file | Whether `api` fetches the release manifest, and from where. |
| `x-*` | nobody | | Any root key starting with `x-` is ignored. |

Any other root key refuses boot in `worker`. `api` reads only `drafts`, `spend`, `operators`, `allowed`, `attachments`, `audit` and `updateCheck`, so it ignores the rest of the file and needs no provider key. Every block rejects keys it does not define.

### `generator`

`provider` picks the entry; the other keys depend on it.

| Key | Providers | Default | Accepts |
| --- | --- | --- | --- |
| `provider` | all | required in the block; `anthropic` when the `generator` block is absent | `anthropic`, `claude-code`, `codex`, `cursor`, `openai`, `openrouter`. |
| `model` | all | `anthropic`, `claude-code`: `claude-opus-5-5`; `codex`, `cursor`: the CLI's configured default | A non-empty model id. Required for `openai` and `openrouter` (an OpenRouter slug such as `anthropic/claude-sonnet-5.5`). For `cursor`, an id from `cursor-agent --list-models`; an id with `[` refuses boot. Where each provider lists its ids: [Model names by provider](./generators.md#model-names-by-provider). |
| `effort` | all | `medium` | `low`, `medium` or `high`. |
| `fullRegeneration` | all | `never` | `never` (each revision anchors to the previous brief), `on-model-swap` (a fresh brief when the provider or model changed), `always` (every revision from scratch). |
| `forceMultiCall` | all | `false` | `true` runs every brief as a multi-call run (a grouping call over an outline, then detail calls per batch of hunks), the path a diff over 400k input tokens or 120 hunks takes on its own. A diagnostic switch; it costs more calls per brief. |
| `detailConcurrency` | all | `8` | A whole number of at least 1: the detail calls a multi-call run keeps in flight at once. Lower it for a provider rate limit ([the large pool](./generators.md#the-large-pool)). |
| `revisionNarrative` | all | `true` | `false` skips the revision narrative against the previous brief. |
| `hugeSpanRatio` | all | `0.65` | A number above 0 and at most 1: the share of a pull request's changed lines at which an incremental span falls back to the full brief ([the 300-file span limit](./generators.md#the-300-file-span-limit)). |
| `apiKeyEnv` | `anthropic`, `openai`, `openrouter` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | The NAME of the variable holding the key. A value that is not an uppercase variable name refuses boot. |
| `baseUrl` | `anthropic`, `openai` | the provider's own host | A URL. `anthropic` takes the gateway's host root; a path ending in `/v1` refuses boot. `openai` takes the `/v1` root of a gateway or compatible server, and turns the `/models` check at boot into a warning. A plain `http://` URL to any host but the worker's own logs one warning at boot, because the key and the pull request's code then travel unencrypted. |
| `providerRouting` | `openrouter` | none | A mapping passed to OpenRouter under `provider`; `require_parameters: true` is always forced. `data_collection: deny` is sent unless the mapping names its own value ([generators.md](./generators.md#openrouter)). |
| `referer`, `title` | `openrouter` | none | Non-empty strings sent as attribution headers. |
| `command` | `claude-code`, `codex`, `cursor` | `claude`, `codex`, `cursor-agent` | The CLI binary, a path or a name on `PATH`. |
| `timeouts.hardMs` | `claude-code`, `codex`, `cursor` | `900000` (15 minutes) | Positive whole milliseconds: the wall-clock cap on one run. |
| `timeouts.inactivityMs` | `claude-code`, `codex`, `cursor` | `180000` (3 minutes); `cursor`: `hardMs` | Positive whole milliseconds without output before the run is stopped. |
| `timeouts.killGraceMs` | `claude-code`, `codex`, `cursor` | `5000` | Positive whole milliseconds between the stop signal and the kill. |

The harness providers are refused in the shipped image ([generators.md](./generators.md#subscription-cli-providers)).

### `drafts`, `spend`, `operators`, `allowed`

| Key | Default | Accepts |
| --- | --- | --- |
| `drafts.generate` | removed | Refuses boot. Hold drafts with `triggerConditions.readyForReview: on` ([Hold drafts until they are ready for review](../repo-config/trigger-conditions.md#hold-drafts-until-they-are-ready-for-review)). |
| `drafts.debounceSeconds` | unset (the normal window) | A positive number of seconds: the debounce for a draft's regenerations. |
| `spend.maxGenerationsPerDay` | `300` | A positive whole number, or `unlimited` for no cap ([Cap daily generation spend](./spend-cap.md)). |
| `operators` | empty list | A list of up to 100 GitHub user ids, positive whole numbers, never logins. A bare `operators:` with no list refuses boot ([Who can sign in](./security-model.md#who-can-sign-in)). |
| `allowed.users` | empty list | Up to 1000 GitHub user ids who may sign in and start a brief ([Who can sign in](./security-model.md#who-can-sign-in)). |
| `allowed.accounts` | empty list | Up to 1000 org or personal account ids whose installations count. The block must name `users` or `accounts`; a bare `allowed:` refuses boot. |

### `triggerConditions`

The same block a repository writes in its `settings.yaml`, with the same kinds ([Trigger conditions](../repo-config/trigger-conditions.md)), except `paths`, which only a repository sets. A repository's block merges over this one per kind: a kind it sets replaces this one, a kind it leaves out is inherited, and `off` drops one kind or the whole block. Only `worker` reads it, and a bad block refuses `worker` boot.

### `contextSources`, `trackers`

| Key | Default | Accepts |
| --- | --- | --- |
| `contextSources` | empty list | A list with at most one entry per `type`. URLs and GitHub issues are built in and need no entry. |
| `contextSources[].type` | | `notion` or `jira`. |
| `contextSources[].tokenEnv` | `NOTION_TOKEN`; `JIRA_API_TOKEN` for `jira` | The NAME of the variable holding the Notion integration token, or the Jira API token. |
| `contextSources[].emailEnv` | `JIRA_EMAIL` | `jira` only: the NAME of the variable holding the email of the account that owns the token. |
| `contextSources[].site` | | `jira` only, required: the Jira Cloud site host alone, one label before `.atlassian.net` (`acme.atlassian.net`), with no scheme, path or port. One deployment reads one site. |
| `contextSources[].linkHosts` | none | `jira` only, optional: up to 4 bare host names, such as a custom domain, whose issue links count as the site's. An `atlassian.net` host or a host listed twice refuses boot. |
| `trackers` | none | A list of 1 to 8 entries, at most one `github` entry and one `jira` entry, and no prefix on two trackers: a `keyPrefix` or Jira project key appears once (compared case-insensitively). A repository's own `trackers:` replaces this list ([trackers.md](./trackers.md)). |
| `trackers[].kind` | | `notion`, `jira` or `github`. A `notion` or `jira` entry refuses boot unless `contextSources` carries an entry of the same type whose variables are set. |
| `trackers[].keyPrefix` | | `notion` only, required: a letter followed by up to 19 letters, digits or underscores. |
| `trackers[].databaseId` | | `notion` only, required: the database or data source id, 32 hex characters with or without dashes. |
| `trackers[].projectKeys` | | `jira` only, required: 1 to 50 Jira project keys, each a letter followed by letters or digits, 2 to 255 characters in all ([trackers.md](./trackers.md#connect-jira)). |
| `trackers[].issuesRepo` | the pull request's repository | `github` only, optional: `owner/name`, where a bare `#N` resolves. `.` and `..` are refused as either part. |
| `trackers[].siblingRepos` | `false` | `github` only, instance config only: `true` lets issue references resolve in every repository the installation covers, not only the pull request's repository and its `issuesRepo`. An issue in another repository is still read only when that repository is at least as widely visible as the pull request's ([trackers.md](./trackers.md#credential-and-reach)). Anything but `true` or `false` refuses boot. |

### `retention`, `audit`

| Key | Default | Accepts |
| --- | --- | --- |
| `retention.pullRequestDays` | unset (keep forever) | Days a closed or merged pull request is kept before the worker's daily sweep erases it with its briefs: a whole number of at least 1 ([Retention](./data-and-scaling.md#prune-closed-pull-requests)). |
| `retention.auditDays` | unset (keep forever) | Days the daily sweep keeps audit rows: a whole number of at least 30. |
| `audit.privateWrites` | `true` | `false` stops `api` recording writes that stay inside the instance; writes that reach GitHub and every denial are recorded either way. |

To stop recording private writes:

```yaml
# mergebrief.config.yaml
audit:
  privateWrites: false
```

```sh
docker compose restart api
```

**Check:** archive a pull request on Home, which is a write that stays inside the instance, then read the newest private-write row. Its `occurred_at` is older than the archive:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select occurred_at, operation from audit_log
  where classification = '\''private-write'\''
  order by occurred_at desc limit 1;"'
```

With `privateWrites: true`, the same query shows an `archive-pull` row from that moment. The audit log's columns are in [Query the audit log](./data-and-scaling.md#query-the-audit-log).

### `attachments`

| Key | Default | Accepts |
| --- | --- | --- |
| `attachments.quotaFiles` | `10` | Files one reviewer may attach per window: a positive whole number. |
| `attachments.quotaMb` | `30` | Megabytes one reviewer may attach per window: a whole number of at least 10, the size limit of one file. `api` refuses a smaller one. |
| `attachments.quotaWindowMinutes` | `10` | The window's length in minutes: a positive whole number. Each `api` replica counts on its own ([attachments.md](./attachments.md#limit-uploads-per-reviewer)). |
| `attachments.mediaMaxMb` | `100` | The largest video or image, in megabytes, the API streams: a positive whole number, judged on the file's full size; a larger one answers `413 media-too-large`, and the page shows "could not load" with an Open on GitHub link ([attachments.md](./attachments.md#limit-the-size-of-images-and-videos-shown)). |

### `updateCheck`

| Key | Default | Accepts |
| --- | --- | --- |
| `updateCheck.enabled` | `true` | `false` stops the hourly fetch of `version.json` and with it the version notice ([The update check](./upgrade.md#turn-off-or-mirror-the-update-check)). Anything but `true` or `false` refuses boot. |
| `updateCheck.url` | `https://github.com/idan91/mergebrief/releases/latest/download/version.json` | A mirror of `version.json`: an absolute `http` or `https` URL with no credentials in it. `api` refuses any other value; `worker` checks only that it is text. |

### `linkFetch`

The worker fetches up to five links from a PR description as context ([trackers.md](./trackers.md#links-in-the-description)). This block narrows which ones. It does not touch the primary ticket, which the tracker reads.

| Key | Default | Accepts |
| --- | --- | --- |
| `linkFetch.mode` | `public` | `public`: any link that passes the address and port checks. `off`: no link is fetched. `allowlist`: only links whose host is listed in `hosts`. |
| `linkFetch.hosts` | | `allowlist` only, and required there: exact lowercase host names such as `docs.example.com`, with no scheme, port, path or wildcard. Write an international name in its `xn--` form. Each subdomain needs its own entry. A listed host still passes every address and port check. |
| `linkFetch.maxTotalChars` | `40000` | A whole number above zero: the most linked-page text one prompt carries. Links fill it in the order the description lists them. The link that crosses it is cut, and later links are left out. Each page is also cut at 20,000 characters on its own, an HTML page after its comments, `head`, scripts, styles, templates and `noscript` blocks are dropped. The primary ticket has its own limit and does not count. |

To fetch links from your own documentation hosts only:

```yaml
# mergebrief.config.yaml
linkFetch:
  mode: allowlist
  hosts:
    - docs.example.com
    - wiki.example.com
```

```sh
docker compose restart worker
```

**Check:** the worker's start line ends with the mode:

```sh
docker compose logs worker | grep 'listening for generate jobs' | tail -n 1
```

It ends `link fetch allowlist`. While the mode is `public`, the worker also logs a warning at boot that it fetches any public link.

The address checks refuse private, loopback, link-local and reserved ranges, but they cannot tell an internal service on a routable address from the public internet: a service on a public IPv4 address or a cloud IPv6 range answers like any website, and the text it returns reaches the prompt and can be quoted in the brief. If the worker can reach such services, restrict its egress at the network: a network policy, security group or firewall rule that lets the worker reach only GitHub, the model provider, your ticket trackers and the hosts you want linked. Link fetches ignore `HTTP_PROXY` and `NODE_USE_ENV_PROXY`, so a forward proxy works here only as a gateway the network routes the worker through. `linkFetch` with `off` or `allowlist` is the in-app control; the network policy is the one that holds.

## Repo-local files (`.mergebrief/`)

A repository configures its own briefs with files on its default branch, read fresh per generation. An invalid or over-budget file is dropped whole and the brief says so; it never stops the instance. [Configure your repository](../repo-config/README.md) is the code owner's guide, with a template for `instructions.md`; [repo-config.md](./repo-config.md) covers the operator's side.

| File | What it sets | Keys and limits |
| --- | --- | --- |
| `settings.yaml` | Trigger conditions, the Entry comment on drafts, trackers, trusted bots | [Settings](../repo-config/settings.md#keys) |
| `policy.yaml` | Custom risk attributes and quieted built-in ones | [Risk policy](../repo-config/policy.md) |
| `instructions.md` | Free text to the model | [Instructions](../repo-config/instructions.md) |

Each file's size limit is in [The three files](../repo-config/README.md#the-three-files).

## CLI

The `mergebrief` CLI reads its own environment on the machine that runs it. It never reads the server's variables.

### Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `MERGEBRIEF_PROFILE` | unset | Picks the profile, like `--profile`; the flag wins. A name with no configured profile is a usage error. When it is unset, `auth login` writes to the default profile, and refuses if the current repo's owner routes to a different one. |
| `MERGEBRIEF_TOKEN` | unset | Replaces the resolved profile's stored token; it never changes which profile resolves. A command that sends a request refuses it when the current repo's owner routes away from the default profile, until `--profile` or `MERGEBRIEF_PROFILE` names the instance. |
| `MERGEBRIEF_NO_VERSION_WARNING` | unset | Set to any value, even empty, it silences the update line and the major-version warning, and the CLI stops asking npm ([Versions](../use/cli.md#versions)). |
| `XDG_CONFIG_HOME` | `~/.config` | The CLI keeps `mergebrief/config.json` under it. |
| `XDG_CACHE_HOME` | `~/.cache` | The CLI keeps `mergebrief/update-check.json`, and per profile its repo list and the highest revision read on each pull request, under it. |
| `PAGER` | unset | `diff` on a terminal pipes through it, with control and invisible characters escaped and no color. |
| `NO_COLOR` | unset | Non-empty, `diff` on a terminal prints no color. Control and invisible characters stay escaped. |
| `TERM` | set by the terminal | `dumb` prints no color, as `NO_COLOR` does. |
| `npm_command` | set by npm | `exec`, as under `npx`, makes the update hints suggest `npx mergebrief@x.y.z` instead of `npm i -g`. |

### `config.json`

`auth login` writes `<XDG_CONFIG_HOME>/mergebrief/config.json` with owner-only permissions. A file that is not valid JSON, or that breaks this shape, fails every command that reads it.

| Key | Default | What it holds |
| --- | --- | --- |
| `defaultProfile` | the first profile logged into | The profile used when nothing else picks one. With no default and exactly one profile, that one is used. |
| `profiles.<name>.baseUrl` | | The deployment's URL. Required. When the profile holds a token, a plain `http://` URL to any host but this machine prints a warning after each successful command, because the token then travels unencrypted. |
| `profiles.<name>.token` | | The API token, stored in plain text. `MERGEBRIEF_TOKEN` overrides it. |
| `profiles.<name>.owners` | | GitHub owners whose clones pick this profile, matched on the `origin` remote. |
| `profiles.<name>.headers` | | Extra headers sent on every request, for a proxy in front of the API ([cli.md](../use/cli.md#behind-an-identity-aware-proxy)). |

Profile resolution runs `--profile` or `MERGEBRIEF_PROFILE`, then an `owners` match, then the default profile ([Profiles](../use/cli.md#several-instances-profiles)).
