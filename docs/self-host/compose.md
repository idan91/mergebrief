# Self-hosting with docker compose

This page takes you from an empty folder to a running instance that briefs a real pull request. Compose starts four services from one release: Postgres, the api, the web tier in front of it, and the worker that generates briefs. You need what [Prerequisites](./README.md#prerequisites) lists.

On a cloud VM, follow the [cloud deployment guide](./cloud-deployment.md) instead: it runs the same steps with the VM, HTTPS and database around them.

## Get the release files

```sh
mkdir mergebrief && cd mergebrief
curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/latest/download/docker-compose.yml
curl -fsSLo .env.example https://github.com/idan91/mergebrief/releases/latest/download/env.example
curl -fsSLo mergebrief.config.example.yaml https://github.com/idan91/mergebrief/releases/latest/download/mergebrief.config.example.yaml
```

These fetch the newest release. For another one, replace `latest/download` with `download/vX.Y.Z`; the [releases page](https://github.com/idan91/mergebrief/releases) lists them.

**Check:** `ls` shows the three files. `grep 'image:' docker-compose.yml` shows the release's exact tag, such as `ghcr.io/idan91/mergebrief:1.4.0`.

## Put HTTPS in front on a server

Skip this step on your own machine: start the tunnel instead ([Try it locally through a tunnel](#try-it-locally-through-a-tunnel)). On a cloud VM, the [cloud deployment guide](./cloud-deployment.md#2-install-docker-and-https) covers this step.

On a server, GitHub's webhooks and sign-in need an `https://` domain before you register the App. Nothing in the stack speaks TLS, so put a reverse proxy in front of `web`, which listens on `127.0.0.1:3000`. Caddy gets and renews a Let's Encrypt certificate on its own:

1. Point your domain's DNS A record at the server, and open ports 80 and 443 in its firewall.
2. Install Caddy as a system service from its [install instructions](https://caddyserver.com/docs/install).
3. Replace `/etc/caddy/Caddyfile` with:

   ```caddyfile
   brief.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

4. Reload Caddy:

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

**Check:** `curl -sI https://brief.example.com` prints a status line with `502` and no certificate error. The `502` is Caddy with no `web` behind it yet; it goes away once the stack runs. Your origin is `https://brief.example.com`.

Before anyone else uses the instance, also read [Terminate TLS at a reverse proxy](#2-terminate-tls-at-a-reverse-proxy) for the headers and settings a proxy needs.

## Register the GitHub App

Decide the origin reviewers will browse first:

- On a server, your `https://` domain from [Put HTTPS in front on a server](#put-https-in-front-on-a-server).
- On your own machine, a tunnel's URL. Start it now: [Try it locally through a tunnel](#try-it-locally-through-a-tunnel).

Then follow [github-app.md](./github-app.md) through [Install the App](./github-app.md#install-the-app). Come back with the App ID, Client ID, client secret, private key file and webhook secret.

## Fill in `.env`

```sh
cp .env.example .env
chmod 600 .env
```

Open `.env` and replace each placeholder. The required block of the file then reads like this:

```dotenv
# From the App's General tab
GITHUB_APP_ID=123456
# The whole .pem file, BEGIN and END lines included, inside single quotes
GITHUB_APP_PRIVATE_KEY='-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----'
# The value you gave the App's webhook Secret field
GITHUB_WEBHOOK_SECRET=<openssl rand -hex 32 output>
GITHUB_OAUTH_CLIENT_ID=<Client ID>
GITHUB_OAUTH_CLIENT_SECRET=<client secret>

# Seals reviewers' GitHub tokens at rest. Back it up with the database.
SESSION_KEY_V1=<openssl rand -base64 32 output>

# The origin reviewers browse, the same one the App's URLs start with
PUBLIC_BASE_URL=https://brief.example.com

# Your model provider key
ANTHROPIC_API_KEY=<your key>

# Uncomment and set before the first start
POSTGRES_PASSWORD=<openssl rand -hex 24 output>
```

- **`POSTGRES_PASSWORD`**: set it before the first `up`. Postgres stores it only when it first creates its volume, so changing it later in `.env` alone breaks the connection ([Postgres credentials](#1-postgres-credentials)).
- **Another provider** (`openai`, `openrouter`): set its key instead, and name the provider in `mergebrief.config.yaml` ([generators.md](./generators.md#the-config-file)).
- **Leave out what does not apply.** Delete or comment a line rather than leaving it empty: some variables read empty differently from unset. Every variable is in [configuration.md](./configuration.md).

### Use a key file instead of the inline key

To keep the private key out of `.env`, mount the `.pem` file into `api` and `worker`:

1. Delete the `GITHUB_APP_PRIVATE_KEY=` line from `.env`. Boot refuses while both forms are set, and the copied `.env` has the inline placeholder.
2. Put the key in a `secrets` folder beside the compose file:

   ```sh
   mkdir -p secrets && chmod 700 secrets
   cp ~/Downloads/<app-name>.<date>.private-key.pem secrets/github-app.pem
   ```

   On a server, the key downloaded to your own computer. Copy it over from there instead of the `cp` line, using your server's login and folder:

   ```sh
   scp ~/Downloads/<app-name>.<date>.private-key.pem <user>@<server>:~/mergebrief/secrets/github-app.pem
   ```

3. Make it readable by the containers' user, UID 1000:

   ```sh
   sudo chown 1000:1000 secrets/github-app.pem
   sudo chmod 400 secrets/github-app.pem
   ```

4. Create `docker-compose.override.yml` beside `docker-compose.yml`. If you have one, merge these entries into it:

   ```yaml
   services:
     api:
       secrets:
         - github-app.pem
     worker:
       secrets:
         - github-app.pem
   secrets:
     github-app.pem:
       file: ./secrets/github-app.pem
   ```

5. Add the path to `.env`:

   ```dotenv
   GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/github-app.pem
   ```

## List who may sign in

An instance starts closed: nobody can sign in, and no repository's pushes start a brief, until `mergebrief.config.yaml` names them.

```sh
cp mergebrief.config.example.yaml mergebrief.config.yaml
chmod 644 mergebrief.config.yaml
gh api users/<your-login> --jq .id
```

Without `gh`, read the number in your avatar's URL, `https://avatars.githubusercontent.com/u/<id>`. Replace the placeholder under `operators` with that id:

```yaml
operators:
  - 583231
```

That covers you and repositories on your own account. For an organization the App is installed on, add its id too:

```sh
gh api orgs/<org> --jq .id
```

```yaml
allowed:
  accounts:
    - 12345678
```

Ids, never logins. `allowed.users` adds single people, such as an outside reviewer ([Who can sign in](./security-model.md#who-can-sign-in)).

The file must exist and stay readable by UID 1000, which is what the `chmod 644` is for. It holds variable names, never keys. Edits apply when `api` and `worker` restart.

## Start the stack

```sh
docker compose up -d --wait
```

The first run pulls the images. `--wait` returns once Postgres, `api` and `web` report healthy; `api` applies the database migrations before it does.

**Check:**

```sh
docker compose ps -a
```

`postgres`, `api` and `web` show `healthy`; `worker` shows `Up`. A service at `Exited (0)` refused its configuration: `docker compose logs api worker` ends with the variable or key it rejected ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)). Fix it and run `up -d --wait` again.

## Check it end to end

1. **The web tier reaches the api and the database.**

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz
   ```

   It prints `200`. A `503` means the api or the database is down: read `docker compose logs api`.

2. **GitHub's deliveries arrive.** In the App's settings, open **Advanced**, redeliver the newest delivery under **Recent Deliveries**, and confirm it answers `200` ([Check the App](./github-app.md#check-the-app)).
3. **You can sign in.** Open your `PUBLIC_BASE_URL` and sign in with GitHub.
4. **A pull request gets a brief.** Open a pull request on a repository the App is installed on, or push a commit to an open one. Watch the worker:

   ```sh
   docker compose logs -f worker
   ```

   About a minute after the push, the App comments on the pull request: **Brief is generating for this push…**. When the brief is ready, the comment changes to **Read the brief for this push**. Follow that link: the brief opens in MergeBrief.

You're done when that link opens the brief. From now on every push to an open pull request gets its brief in the background, debounced and under the instance's [daily generation cap](./spend-cap.md).

If something stops short:

| You see | Go to |
| --- | --- |
| The delivery answers `401` | [Webhook deliveries answer 401](./troubleshooting.md#webhook-deliveries-answer-401) |
| Sign-in fails or does not stick | [Sign-in does not stick](./troubleshooting.md#sign-in-does-not-stick) |
| The delivery answers `200` and no comment or brief appears | [No brief appears](./troubleshooting.md#no-brief-appears) |
| The brief opens but the pull request has no comment | [No Entry comment appears](./troubleshooting.md#no-entry-comment-appears) |
| The pull request shows "Brief available on demand" | Its author is not on the repository's team ([Who triggers a brief](./github-app.md#who-triggers-a-brief)) |

Before anyone else uses the instance, work through [Hardening before real exposure](#hardening-before-real-exposure).

## Try it locally through a tunnel

GitHub delivers webhooks only to a public URL. On your own machine, a tunnel gives `localhost:3000` one. These steps use [ngrok](https://ngrok.com); any tunnel that forwards HTTPS to a local port works.

1. Sign up at ngrok, install it, and connect it to your account once, with the authtoken from ngrok's dashboard:

   ```sh
   ngrok config add-authtoken <your-authtoken>
   ```

2. Start the tunnel before you register the App, and keep it running:

   ```sh
   ngrok http 3000
   ```

3. Copy the `https://` forwarding URL it prints, such as `https://abc123.ngrok-free.app`.
4. Use it as the origin when you [register the App](./github-app.md#before-you-start), and as `PUBLIC_BASE_URL` in `.env`.
5. Start the stack and run [Check it end to end](#check-it-end-to-end) against that URL.

On ngrok's free plan, a browser opening the URL first sees ngrok's warning page: click **Visit Site** to continue. GitHub's webhook deliveries do not get that page.

A free ngrok URL changes each time ngrok restarts. When it does, put the new URL in `PUBLIC_BASE_URL`, in the App's **Homepage URL**, **Callback URL** and **Webhook URL**, then run `docker compose up -d` to recreate the services with it. ngrok's inspector at `http://127.0.0.1:4040` lists every delivery and can replay one.

While the tunnel is up, the instance is on the internet: stop it when you are not testing ([A tunnel is production exposure](#4-a-tunnel-is-production-exposure)).


## Start on boot

A reboot leaves the stack down: `restart: on-failure` brings `api`, `web` and `worker` back after a nonzero exit, not when Docker starts, and `postgres` has no restart policy. Do not switch to `unless-stopped`: a configuration error exits 0 so the service stays down, and that policy would restart it into the same error forever.

A systemd unit runs `docker compose up` once at boot. Write it from the instance folder, so `WorkingDirectory` gets that folder's path: compose names the project after the folder, and any other folder would start a second, empty stack. `COMPOSE_FILE` in `.env` still applies, so an external database needs no change.

```sh
sudo tee /etc/systemd/system/mergebrief.service > /dev/null <<EOF
[Unit]
Description=MergeBrief
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PWD
ExecStart=/usr/bin/docker compose up -d --wait
ExecStop=/usr/bin/docker compose stop
TimeoutStopSec=240

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable docker mergebrief
```

**Check:** `systemctl cat mergebrief | grep WorkingDirectory` shows the instance folder. Then `sudo reboot`, reconnect, and run `docker compose ps -a` in that folder: `api` and `web` read `healthy`, `worker` reads `Up`, and so does `postgres` on the bundled database.

- **`worker` has no health check**, so a `worker` that exits a moment after it starts leaves the unit active, with webhooks answering and no brief appearing. `docker compose ps -a` catches it ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)). An error in `api` or `web` shows as failed in `systemctl status mergebrief`. The unit has no `Restart=`.
- **`TimeoutStopSec`** covers the stop grace periods in `docker-compose.yml`, so systemd does not cut a drain at shutdown.
- **To keep an instance down across reboots**, run `sudo systemctl disable mergebrief`. A plain `docker compose stop` lasts only until the next boot.
- **Deliveries GitHub sent while the stack was down** are resent by the worker, up to 20 every 15 minutes, starting within about 30 minutes. To do it sooner, redeliver them from the App's **Advanced** tab, within 3 days.

## What runs

| Service | What it does | Port |
| --- | --- | --- |
| `postgres` | Store, job queue and locks, in one Postgres 17 | `127.0.0.1:5432` |
| `api` | Webhooks, sign-in and every read; holds the credentials and the database | compose network only |
| `web` | The web app; proxies `/api/*` to `api` and holds no credentials | `127.0.0.1:3000` |
| `worker` | Generates briefs from the job queue | none |

- **Ports bind to loopback only.** Put a reverse proxy, or a tunnel for a trial, in front of `web` for anything reachable from outside. `web` reaches `api` at `http://api:3001`, a name that covers every api replica ([Run more than one api](./data-and-scaling.md#run-more-than-one-api)).
- **Restarts.** `api`, `web` and `worker` restart after a nonzero exit (`restart: on-failure`). A configuration error in `api` or `worker` exits 0 and stays down, so it does not restart-loop; `web` exits 1 on a bad value and restarts until it is fixed. `postgres` has no restart policy. None of them start again after a reboot by themselves ([Start on boot](#start-on-boot)).
- **How a push becomes a brief:** [How MergeBrief works](../architecture.md).
- **Migrations run at boot** in `api` and `worker`, under one Postgres advisory lock: one process applies them and the others wait. A process waiting past 5 minutes exits 1, logging a `migration lock:` warning every 30 seconds until then. A restricted database role can turn this off ([below](#restricted-database-roles-mergebrief_auto_migratefalse)).

### Moving a host port

`docker-compose.yml` fixes the host side of both published ports, and an upgrade replaces that file, so a move goes in `docker-compose.override.yml`. Compose appends an override's `ports:` to the list it merges into, which leaves the old port bound too; the `!override` tag replaces the list:

```yaml
# docker-compose.override.yml
services:
  web:
    ports: !override
      - "127.0.0.1:3461:3000"
  postgres:
    ports: !override
      - "127.0.0.1:5433:5432"
```

`!override` needs Docker Compose 2.24.4 or newer. Change only the host port, the number after `127.0.0.1`, and list only the services you move. On an external database leave out `postgres`, since the overlay removed it and naming it again fails every compose command, and add the override to `COMPOSE_FILE` ([below](#external-postgres-managed-database)).

**Check:** each moved service lists one published port. Avoid `docker compose config` for this: it prints the resolved environment, secrets included.

```sh
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'
```

With no proxy in front, moving `web` moves the origin reviewers browse: set `PUBLIC_BASE_URL=http://localhost:3461` and change the App's callback URL to match. Behind a proxy, `PUBLIC_BASE_URL` stays the public origin and the proxy's upstream moves instead.

## What the host holds

One folder, with no checkout of the repository and no build:

- **`docker-compose.yml`**, a release asset. It pins that release's exact image, such as `ghcr.io/idan91/mergebrief:1.4.0`, and an upgrade replaces it, so never edit it. Never point it at the moving `latest` tag either: the next pull would upgrade the instance without the [upgrade steps](./upgrade.md#upgrade-on-the-bundled-database).
- **`.env`**, your settings and secrets, started from the release's `env.example`.
- **`mergebrief.config.yaml`**, the instance config, started from the release's `mergebrief.config.example.yaml`. Compose mounts it read-only into `api` and `worker` and sets `MERGEBRIEF_CONFIG` for both.
- **`docker-compose.override.yml`**, optional, for your own edits: [ports](#moving-a-host-port), volumes, secrets, resource limits. Compose merges it in on its own (through `COMPOSE_FILE` on an external database), and an upgrade never touches it.

`api`, `web` and `worker` run the same image, `ghcr.io/idan91/mergebrief:X.Y.Z`, with different commands, for `linux/amd64` and `linux/arm64`; a fourth command, `migrate`, applies pending migrations and exits. Postgres runs the official `postgres:17-alpine`. Running `docker compose build` from a checkout of the repository builds a `dev` image instead, which is for working on MergeBrief, not for running it ([CONTRIBUTING.md](../../CONTRIBUTING.md#development-setup)).

Tracing is off until `.env` names an OTLP endpoint ([observability.md](./observability.md#tracing)).

## Where a setting goes

| Put it in | What goes there |
| --- | --- |
| `.env` | Secrets and credentials, the database connection, `PUBLIC_BASE_URL`, and capacity: `WORKER_COUNT`, `WORKER_CONCURRENCY`, `WORKER_LARGE_CONCURRENCY`, `API_COUNT` |
| `mergebrief.config.yaml` | Who may sign in (`operators`, `allowed`), the provider and model (`generator`), and the daily generation cap (`spend.maxGenerationsPerDay`) |
| A repository's `.mergebrief/` folder | That repository's own settings, set by its code owners ([Configure your repository](../repo-config/README.md)) |

A value lives in one place only: the config file never holds a key, and `.env` never holds policy. `docker compose up --scale worker=N` overrides `WORKER_COUNT` for that run, and `DATABASE_URL_FILE` wins over `DATABASE_URL`.

## External Postgres (managed database)

`api`, `web` and `worker` from compose, the database from a managed provider (Neon, Supabase, RDS) or any Postgres 16 or newer that you run. Step-by-step setups for RDS, Neon and Supabase are in the [cloud deployment guide](./cloud-deployment.md#5b-external-database-rds-neon-or-supabase).

The release ships an overlay, `docker-compose.external-db.yml`, that removes the bundled `postgres` service and hands `api` and `worker` your `DATABASE_URL`. It is not a compose file by itself. Fetch it beside the default file and name both in `.env`, in this order, so every plain `docker compose` command reads them:

```sh
curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/latest/download/docker-compose.external-db.yml
```

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.external-db.yml
DATABASE_URL=postgres://app:<password>@db.provider.example:5432/mergebrief?sslmode=verify-full
```

Then `docker compose up -d --wait`.

- **`COMPOSE_FILE` turns off the automatic override file.** Once you have `docker-compose.override.yml`, append it: `COMPOSE_FILE=docker-compose.yml:docker-compose.external-db.yml:docker-compose.override.yml`. Every file listed must exist, or each compose command fails.
- **Use a direct or session-mode connection, never a transaction pooler.** The worker's `LISTEN`/`NOTIFY` and the migrations' advisory lock need one database session. On Neon, take the host without `-pooler`; on Supabase, the direct host or the Session pooler on port 5432, not port 6543. A lock on the wrong session shows as a `migration lock:` warning, then an exit 1, naming the pooler.
- **Backups are the provider's.** The `docker compose exec postgres` backup in [backup-restore.md](./backup-restore.md#back-up-the-bundled-database) has nothing to run in; use the provider's snapshots.

### TLS: verify-full or disable (`sslmode` in the DSN)

A `DATABASE_URL` whose host is not loopback boots only on `sslmode=verify-full` or `sslmode=disable`:

| DSN parameter | Meaning |
| --- | --- |
| `sslmode=verify-full&sslrootcert=/path/ca.pem` | TLS, certificate verified against that CA, hostname checked. Use this when the provider issues from its own CA |
| `sslmode=verify-full` | TLS, verified against Node's bundled Mozilla roots, not the OS store. Works when the provider's chain ends in a public CA |
| `sslmode=disable` | Plaintext, for a private network only |

Boot refuses `require`, `prefer`, `verify-ca`, `no-verify` and any other value, and `uselibpqcompat=true` beside anything but `verify-full`, because libpq tools read `require` as "encrypt but do not verify". A DSN copied from a provider dashboard with `sslmode=require` refuses boot: change it to `verify-full`.

For a provider CA (RDS, Supabase), download its bundle to `./secrets/provider-ca.pem`, mount it into `api` and `worker` (the `volumes:` entries in the example below), and point the DSN at the mounted path:

```dotenv
DATABASE_URL=postgres://app:<password>@db.xxx.rds.amazonaws.com:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

A missing or unreadable `sslrootcert` file refuses boot, naming the path.

### The DSN as a secret file (`DATABASE_URL_FILE`)

An env var shows in `docker inspect`; a compose secret does not. To keep the DSN in a file:

1. Put the DSN on one line in `./secrets/database-url`, readable by UID 1000 (`sudo chown 1000:1000 secrets/database-url && sudo chmod 400 secrets/database-url`).
2. Hand it to `api` and `worker` in `docker-compose.override.yml`:

   ```yaml
   services:
     api:
       secrets:
         - database-url
       volumes:
         - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
     worker:
       secrets:
         - database-url
       volumes:
         - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
   secrets:
     database-url:
       file: ./secrets/database-url
   ```

   Drop the `volumes:` entries when the provider's CA is publicly trusted.

3. Set `DATABASE_URL_FILE=/run/secrets/database-url` in `.env` in place of `DATABASE_URL`.

Surrounding whitespace in the file is trimmed. If both variables are set, the file wins and boot logs a warning naming the shadowed `DATABASE_URL`.

### Restricted database roles (`MERGEBRIEF_AUTO_MIGRATE=false`)

Migrating at boot needs DDL. If your runtime role is read and write only, set `MERGEBRIEF_AUTO_MIGRATE=false`: boot then only checks that the database matches the release's migrations, and exits 1 naming the pending count when it is behind. You apply them yourself with `docker compose run --rm api migrate` and a DDL-capable DSN ([upgrade.md](./upgrade.md#upgrade-with-a-restricted-database-role)).

## Other platforms

Compose, with the bundled or an external Postgres, is the one supported way to run MergeBrief. The image runs under another orchestrator in principle, but that is untested. If you do, start `ghcr.io/idan91/mergebrief:X.Y.Z` as the three services `docker-compose.yml` defines, with its commands and environment, pin the exact tag, and roll out [one release at a time](./upgrade.md#how-migrations-run).

## Check what the worker is doing

`api` and `web` each answer `GET /healthz` (static liveness, which the compose health checks use) and `GET /readyz`. `api`'s `/readyz` runs one `SELECT 1`; `web`'s answers with `api`'s, so from outside an unreachable api and an unreachable database look the same. Logs are JSON on stdout, rotated at `10m` times 3 per service; events, correlation and alerting are in [observability.md](./observability.md).

```sh
docker compose ps -a              # api and web healthy, worker up
docker compose logs -f worker     # job pickup and generation progress
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select kind, status, phase, error_code from generation order by updated_at desc limit 5;"'
```

- **`generation.status`** walks `pending`, `running`, `succeeded`. `superseded` means a newer push replaced the run. `failed` carries a sanitized reason in `error_code`. `capped` means the instance hit its [daily generation cap](./spend-cap.md). `held` means a [trigger condition](../repo-config/trigger-conditions.md) is unmet; the head generates once every condition passes, or on a Generate click. `awaiting-trigger` means the run waits until someone with push access approves the pull request's runs.
- **A configuration error** stops `api` or `worker` at boot, and `docker compose logs api` or `logs worker` names the rejected variable. `curl -i localhost:3000/api/version` answering `401` means both tiers are up and the api parsed its environment; `503` means the api is down.
- **Two Postgres lines are expected once on a first boot:** `ERROR:  relation "graphile_worker.migrations" does not exist` (the job queue probing an empty database) and `FATAL:  the database system is shutting down` (the image restarting after it initializes). Either one repeating is not normal: read `docker compose logs api worker`.
- **Retries.** The worker retries transient failures with backoff. A permanent condition, such as GitHub's "diff too large", is recorded as `failed` without a retry.
- **`up` fails looking for a Dockerfile:** the image pull was denied or the registry was unreachable, and Compose fell back to building from source, which a release folder cannot do. Run `docker compose pull` and read its error.

## Hardening before real exposure

The defaults suit a loopback-only, single-operator machine. Before you point a domain at an instance, or leave a tunnel up, work through this section.

`MERGEBRIEF_URL_FALLBACK_TOKEN` is optional, and most instances leave it unset. It is a GitHub token MergeBrief tries when a reviewer pastes a private pull request from a repository the App is not installed on ([configuration.md](./configuration.md#github-app-and-sign-in)). If you set it, it serves only the GitHub account that owns it, so make it on your own account, never a bot's. GitHub refusing it logs `url-fallback-token.owner.fail` with the fix. Once a brief is open on the token, diff and file reads are limited to the commits MergeBrief recorded for that pull request, but any file at one of those commits is readable.

### 1. Postgres credentials

Set `POSTGRES_PASSWORD`, and optionally `POSTGRES_USER` and `POSTGRES_DB`, in `.env` before the first boot. `api` and `worker` derive their `DATABASE_URL` from them.

```sh
openssl rand -hex 24        # use the output as it is
```

> [!WARNING]
> Postgres writes the role only when it first initializes the `postgres_data` volume. Changing `.env` afterwards leaves the old password in place and the services fail to connect. Fixing that means an `ALTER ROLE` inside the container, or deleting the volume and every brief in it ([secrets.md](./secrets.md#change-the-postgres-password)).

Use hex as it is: the value is also put into a connection string that is percent-decoded, so a password with `@ : / ? #` or a `%` authenticates as a different string than the role was created with. The `mergebrief` default exists only for a loopback-only machine. Leave port 5432 on loopback; nothing outside the compose network needs it.

### 2. Terminate TLS at a reverse proxy

Nothing in the stack speaks TLS: a proxy in front of `web` does ([Put HTTPS in front on a server](#put-https-in-front-on-a-server)). Set `PUBLIC_BASE_URL=https://brief.example.com` in `.env` and run `docker compose up -d` to recreate the services that read it. It must match the App's callback and webhook origin. It is also the one origin a signed-in browser may send writes from: a POST with another `Origin` answers 403, so the value must be the origin reviewers browse, scheme and port included.

- **Sign-in cookies are `__Host-` cookies with `Secure`.** A browser keeps them over `https://`, or `http://localhost`, and drops them over plain `http://` on any other hostname, so sign-in does not stick there.
- **`web` serves only `PUBLIC_BASE_URL`'s hostname,** `localhost`, `*.localhost` and bare IP addresses, and answers any other `Host` with 403. Forward the original `Host`, and keep `X-Request-Id` if you correlate logs.
- **The app sets its own security headers** (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy: frame-ancestors 'none'`). Add `Strict-Transport-Security` at the proxy, which owns TLS.
- **Leave compression off at the proxy** (`encode`, `gzip`). The app compresses only answers its own pages or a cookieless client asked for, so a request another site starts cannot measure a private brief by its size; a proxy would compress those too.

### 3. The webhook secret is the only gate on the webhook route

`POST /api/webhooks/github` takes no session or token: each delivery is accepted or refused on its HMAC-SHA256 signature over `GITHUB_WEBHOOK_SECRET` alone, and a refusal logs `webhook.verify.fail`. A guessable secret lets anyone queue generations on your provider key.

- Generate it (`openssl rand -hex 32`), never invent it. Boot refuses one under 32 characters after trimming.
- Use a different secret per instance. To rotate, change it in the App's settings and in `.env` together, then run `docker compose up -d`; `docker compose restart` keeps the old value. A sustained `webhook.verify.fail` rate after a rotation means one side did not move ([secrets.md](./secrets.md#rotate-the-webhook-secret)).
- Keep it in `.env` or your secret store, never in the config file or on a command line.
- The app has a 1 MB body cap and no rate limit: add one at your proxy.

#### Rate-limit the webhook route at your proxy

A proxy limit sheds a flood of forged deliveries before it reaches `api`. Scope it to the webhook path and size it for GitHub's bursts: closing or labelling many pull requests at once sends one delivery each, from a small pool of GitHub addresses. GitHub never retries a failed delivery itself; the worker asks it to resend what failed within three days ([troubleshooting.md](./troubleshooting.md#other-webhook-answers)), and you can redeliver from the App's **Advanced** tab.

nginx:

```nginx
# in the http {} block
limit_req_zone $binary_remote_addr zone=github_webhook:10m rate=10r/s;

server {
    # ...listen, TLS, and your `location /` proxying to 127.0.0.1:3000...

    location = /api/webhooks/github {
        limit_req zone=github_webhook burst=100 nodelay;
        limit_req_status 429;
        proxy_set_header Host $host;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

`burst=100 nodelay` lets 100 through at once and refills at 10 a second; without `limit_req_status`, nginx refuses with 503. Behind another load balancer, key the zone on the real client address (`set_real_ip_from`, `real_ip_header`).

Core Caddy has no rate limiter. The third-party [`caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit) module adds one, built into a custom binary:

```sh
xcaddy build --with github.com/mholt/caddy-ratelimit
```

```caddyfile
brief.example.com {
    rate_limit {
        zone github_webhook {
            match {
                path /api/webhooks/github
            }
            key    {remote_host}
            events 600
            window 1m
        }
    }
    reverse_proxy 127.0.0.1:3000
}
```

A refused request gets 429 with `Retry-After`. Behind another load balancer, key on `{client_ip}` with Caddy's `trusted_proxies` set.

### 4. A tunnel is production exposure

While a tunnel is up, the instance is on the internet with whatever secrets it has. Stop tunnels when you are not testing, and use a domain and the proxy above for anything long-lived.

Upgrades are in [upgrade.md](./upgrade.md), backups and restores in [backup-restore.md](./backup-restore.md).
