# Troubleshooting

Find what you see in [the index](#find-your-symptom), then confirm the cause with the log line or status the entry names before you change anything.

Three habits apply to every fix below:

- **Read the last log line first.** `docker compose ps -a` shows what is down (without `-a` a stopped container is not listed), and `docker compose logs <service>` shows why. A process that refuses boot names the variable and the reason, never the value.
- **Apply `.env` edits with `docker compose up -d`.** It recreates the services with the new environment; `docker compose restart` keeps the old one.
- **Some causes log only at `debug`.** Set `LOG_LEVEL=debug` in `.env`, run `docker compose up -d`, reproduce, then set it back.

## Find your symptom

### The stack won't start, keeps restarting, or is down

| You see | Go to |
| --- | --- |
| `up` fails with a Dockerfile-not-found error, or before anything starts | [The stack does not start](#the-stack-does-not-start) |
| `api`, `worker` or `web` shows `Exited (0)` | [A service exits with code 0](#a-service-exits-with-code-0) |
| A service shows `Restarting (1)`, or its uptime keeps resetting | [A service keeps restarting](#a-service-keeps-restarting) |
| `docker compose up -d --wait` sits at `Waiting`, or ends with `dependency failed to start` | [`up --wait` stops at the api](#up---wait-stops-at-the-api) |
| `sorry, too many clients already` in a log | [Postgres refuses connections](#postgres-refuses-connections) |
| Everything worked, then the api lost its Neon database | [The Neon compute is suspended](#the-neon-compute-is-suspended) |
| Your proxy answers 502, or `/readyz` answers 503 | [The stack does not start](#the-stack-does-not-start) |
| The stack is down after a host reboot | [Start on boot](./compose.md#start-on-boot) |
| `db.version.ahead` in the api or worker log | [The database was recorded by a newer version](#the-database-was-recorded-by-a-newer-version) |

### You can't sign in

| You see | Go to |
| --- | --- |
| Signing in returns to the signed-out Home, with "Signing in didn't complete. Try again." | [Sign-in does not stick](#sign-in-does-not-stick) |
| "This GitHub account isn't allowed on this instance. Ask whoever runs it for access." | [A person is refused a brief or sign-in](#a-person-is-refused-a-brief-or-sign-in) |
| Sign-in fails on `http://` with a real hostname | [The browser refuses the `__Host-` cookie](#the-browser-refuses-the-__host--cookie) |
| GitHub reports a `redirect_uri` mismatch | [Sign-in does not stick](#sign-in-does-not-stick) |
| Every page answers 403 `forbidden host` | [Every request answers 403 forbidden host](#every-request-answers-403-forbidden-host) |
| Reads work, but posting, submitting or signing out answers 403 | [Writes answer 403 forbidden](#writes-answer-403-forbidden) |
| Every GitHub-backed request answers 500 | [Requests answer 500 after a key change](#requests-answer-500-after-a-key-change) |

### Webhooks

| You see | Go to |
| --- | --- |
| Deliveries answer 401 | [Webhook deliveries answer 401](#webhook-deliveries-answer-401) |
| Deliveries answer 400, 403, 413, 500 or 502 | [Other webhook answers](#other-webhook-answers) |
| `webhook reconcile: GitHub did not list deliveries` in the worker log | [The worker cannot list webhook deliveries](#the-worker-cannot-list-webhook-deliveries) |

### No brief, or a failed one

| You see | Go to |
| --- | --- |
| A delivery answers 200 but no brief appears | [No brief appears](#no-brief-appears) |
| "Brief available on demand", or "No brief for this push yet" | [No brief appears](#no-brief-appears) |
| "Brief generation failed", or an Entry comment reading "No brief for `<sha>`: generation failed." | [A brief failed](#a-brief-failed) |
| The brief opens but the pull request has no Entry comment | [No Entry comment appears](#no-entry-comment-appears) |
| An amber warnings block, "Some brief text is longer than the length guidance", an unread ticket, or "too large to compare" | [The brief shows warnings](#the-brief-shows-warnings) |
| `url-fallback-token.owner.fail` in the api or worker log | [GitHub refused the URL fallback token](#github-refused-the-url-fallback-token) |
| No version notice, and `update.check.fail` in the api log | [The update check fails](#the-update-check-fails) |

## The stack does not start

| You see | Cause | Fix |
| --- | --- | --- |
| `up` fails with a Dockerfile-not-found error | The image pull was denied or the registry was unreachable, and Compose fell back to building from source, which a release folder cannot do. | Run `docker compose pull` and read its error. |
| Compose rejects the `env_file` entries before anything starts | Docker Compose is older than v2.24.0, which added the `path` and `required` form the shipped files use. | Upgrade Docker Compose to v2.24.4 or newer ([Prerequisites](./README.md#prerequisites)). |
| Every compose command fails before anything starts, after you set `COMPOSE_FILE` | A file `COMPOSE_FILE` lists does not exist. | Fetch the file, or remove it from the list ([compose.md](./compose.md#external-postgres-managed-database)). |
| `api` and `worker` cannot connect to Postgres after you changed `POSTGRES_PASSWORD` | Postgres writes the role on its first start only. | Set the old value back, or change the role inside the container ([Change the Postgres password](./secrets.md#change-the-postgres-password)). |
| Boot is refused naming `sslmode` | A non-loopback `DATABASE_URL` carries neither `sslmode=verify-full` nor `sslmode=disable`. A provider's `sslmode=require` lands here. | Change it to `verify-full` ([compose.md](./compose.md#tls-verify-full-or-disable-sslmode-in-the-dsn)). |
| `api` or `worker` logs `unable to verify the first certificate` | The CA the DSN's `sslrootcert` names did not sign the database's certificate: a bundle for another region or provider. | Mount the provider's CA at the path the DSN names ([Store the connection string](./cloud-deployment.md#store-the-connection-string)). On RDS, use the bundle for the database's region. |
| `DATABASE_URL_FILE: cannot read file`, or `GITHUB_APP_PRIVATE_KEY_PATH: could not read the private key file` | The mounted file is missing, or UID 1000, the image's user, cannot read it. | Check the mount in `docker-compose.override.yml`, then `sudo chown 1000:1000` the file ([Store the connection string](./cloud-deployment.md#store-the-connection-string)). |
| `api` or `worker` exits 1 with `migration lock: still held` | Another process held the migration lock for the whole 5 minutes: a long migration, or a `DATABASE_URL` that reaches a transaction pooler. | A long migration finishes and the restart finds it done, so run `docker compose up -d --wait` again. If it repeats, use a direct or session-mode connection ([compose.md](./compose.md#external-postgres-managed-database)). |
| `api` or `worker` exits 1 naming a pending migration count | `MERGEBRIEF_AUTO_MIGRATE=false` and the database is behind the release. | Apply the migrations ([Upgrade with a restricted database role](./upgrade.md#upgrade-with-a-restricted-database-role)). |
| `api` or `worker` times out connecting to an external database | An IP allowlist without the host's address, a host without IPv6 reaching an IPv6-only endpoint, or a private endpoint the host cannot route to. | Check the provider's allowlist and endpoint. On RDS, check that **Connected compute resources** lists the instance ([cloud guide](./cloud-deployment.md#e2-private-rds-from-ec2)). |
| `CREATE DATABASE` answers `must be able to SET ROLE` on RDS | The admin role is not a member of the app role. | Run the `GRANT` in [the cloud guide](./cloud-deployment.md#e2-private-rds-from-ec2) first. |
| Your proxy answers 502 | The proxy cannot reach `web` on `127.0.0.1:3000`: `web` is not up, or the proxy's upstream names another port. | On the host, `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz`. No answer: read `docker compose ps -a` and `docker compose logs web`. A `200`: fix the proxy's upstream. |
| `http://localhost:3000/readyz` answers 503 | `web` is up but cannot reach the api, or the api cannot reach the database. | Read `docker compose logs api`. `curl -i localhost:3000/api/version` answering 401 means `web` and `api` are both up, so the database is the gap. |

## A service exits with code 0

`api` and `worker` exit 0 on a configuration error, so compose's `restart: on-failure` leaves them down instead of restarting into the same error. A transient fault, such as a Postgres boot race, exits 1 and restarts ([A service keeps restarting](#a-service-keeps-restarting)). The `worker` has no HTTP surface, so `docker compose ps -a` showing `Exited (0)` is the only sign, and webhooks keep answering 200 while no brief appears.

Read the last line of `docker compose logs worker`:

| Last line starts with | Cause | Fix |
| --- | --- | --- |
| `worker composition: invalid configuration` | A worker variable is missing or malformed; the line names it. | Fix it in `.env`, then `docker compose up -d`. |
| `worker composition: invalid GitHub configuration` | A GitHub App variable is missing or malformed. | Same. |
| `worker composition: invalid generator configuration` | The provider block refused, for example a missing key or a CLI provider in the shipped image ([generators.md](./generators.md#harness-clis-are-host-process-only-in-v1-deliberately)). | Fix the `generator:` block or its key variable. If the line says `config file: not readable (EACCES)`, UID 1000 cannot read the mounted file: `chmod 644 mergebrief.config.yaml`. |
| `worker composition: invalid tracker configuration` or `worker composition: trackers` | A tracker in the instance config cannot be read, such as a `notion` entry whose token is unset ([trackers.md](./trackers.md#notion)), a `jira` entry whose `JIRA_EMAIL` or `JIRA_API_TOKEN` is unset, or a `jira` entry whose `site` is not a Jira site (the line says `no Jira site answers at`) ([trackers.md](./trackers.md#jira)). | Set the token or email, fix `site`, or remove the entry. |
| `worker composition: invalid tracing configuration` | An `OTEL_*` value is invalid while an endpoint is set ([observability.md](./observability.md#tracing)). | Fix the value, or unset the endpoint. |
| `worker composition: invalid logging configuration` | `LOG_LEVEL` is not `error`, `warn`, `info` or `debug`. | Fix or remove the variable. |
| `worker: stopped` | A plain stop, such as a host reboot. | `docker compose up -d`. To bring it back on its own after a reboot, see [Start on boot](./compose.md#start-on-boot). |

`api` follows the same rule; its lines start with `api composition:`. [generators.md](./generators.md#when-something-degrades) has the same triage from the generation side.

## A service keeps restarting

**You see:** `docker compose ps -a` shows `Restarting (1)`, or the service's uptime starts over each time you look.

**Cause:** the service exits 1, and `restart: on-failure` starts it again. That is meant for faults a restart can outlast, so it loops until the cause clears. Read the last lines of `docker compose logs <service>`:

| Last line | Cause | Fix |
| --- | --- | --- |
| `api composition failed` or `worker: boot failed`, with an `err` naming a connection error | The database is unreachable, refused the connection, or is full. | Read the `err`: [Postgres refuses connections](#postgres-refuses-connections), [The Neon compute is suspended](#the-neon-compute-is-suspended), or the external-database rows in [The stack does not start](#the-stack-does-not-start). |
| `api composition: database schema is N migration(s) behind`, or `worker: boot failed` saying the same | `MERGEBRIEF_AUTO_MIGRATE=false` and the release's migrations are not applied. | [Upgrade with a restricted database role](./upgrade.md#upgrade-with-a-restricted-database-role). |
| `migration lock: still held after 300s` | A long migration, or a transaction pooler in `DATABASE_URL`. | See the `migration lock` row in [The stack does not start](#the-stack-does-not-start). |
| `web boot refused`, with a `reason` | `web` exits 1 on a bad value, unlike `api` and `worker`, so it restarts until fixed. Its values come from `docker-compose.yml`: `PUBLIC_BASE_URL` and the `OTEL_*` variables in `.env`. | Fix the value the `reason` names, then `docker compose up -d`. |

## `up --wait` stops at the api

**You see:** `docker compose up -d --wait` shows `Container <project>-api-1 Waiting` for minutes, or ends with `dependency failed to start: container <project>-api-1 exited (0)` or `... is unhealthy`.

**Cause:** `web` starts only once `api` is healthy, and `api` does not listen until its migrations finish. The api's health check allows a 5-minute start period for that, so `--wait` waits through it:

- **Still `Waiting`:** a long migration, or another process holding the migration lock. `docker compose logs api` shows `migration lock: another process is migrating, waiting`, then a `migration lock:` warning every 30 seconds. Let it finish; it exits 1 after 5 minutes if the lock never frees.
- **`exited (0)`:** a configuration error ([A service exits with code 0](#a-service-exits-with-code-0)).
- **`is unhealthy`:** the api keeps failing at boot ([A service keeps restarting](#a-service-keeps-restarting)).

**Fix:** fix what the log names, then run `docker compose up -d --wait` again.

## Postgres refuses connections

**You see:** `sorry, too many clients already`, or `remaining connection slots are reserved`, inside an `err` in `docker compose logs api worker`. On the bundled database, `docker compose logs postgres` shows the same text after `FATAL:`. At boot the service restarts; while running, requests answer 500 and jobs fail and retry.

**Cause:** the pools of every api and worker, plus migrations, `psql` sessions and backups, ask for more connections than Postgres's `max_connections`. Each worker opens more than twice the connections an api does, so adding workers is the usual trigger. A managed provider also reserves some connections and may cap them by plan.

**Fix:** compute the budget and fit it under the limit, by lowering `DATABASE_POOL_MAX` or raising the limit ([Size the connection budget](./data-and-scaling.md#size-the-connection-budget)), then `docker compose up -d --wait`.

## The Neon compute is suspended

**You see:** an instance on Neon that worked stops reaching its database: `/readyz` answers 503, `api` and `worker` log connection errors, and a restart keeps failing.

**Cause:** the project used up its compute allowance. On Neon's Free plan the worker polls its queue every 2 seconds, so the compute is not expected to scale to zero, and once the month's allowance runs out Neon suspends it until the next billing period ([the cloud guide's Neon section](./cloud-deployment.md#h2e3-neon)).

**Fix:** check the project's compute and usage in the Neon console. Move to a paid plan, or wait for the next period. Once the compute answers, `api` recovers on its own, and a `worker` stuck restarting comes back with `docker compose up -d`.

## The database was recorded by a newer version

**You see:** `api` or `worker` logs `warn` `database was last recorded by a newer version`, with `evt: db.version.ahead`, `db` and `running`.

**Cause:** this release booted against a database a newer release last recorded. After a [rollback](./upgrade.md#roll-back), that is expected: one line from whichever service records its version first, or one from each. The services keep running.

**Fix:** nothing after a one-release rollback. Without a rollback, check `docker compose exec api printenv SERVER_VERSION`: a stale `docker-compose.yml`, or a second instance pointed at the same database, would also log it. Two instances must never share a database.

## A person is refused a brief or sign-in

"This GitHub account isn't allowed on this instance" means the account is not an Operator, is not in `allowed.users`, and is in no installation on a listed account ([who may start a brief](./generators.md#who-may-start-a-brief)). An instance with no config file refuses everyone, you included, and the api logs `the instance config names nobody` when it starts. Find the id with `gh api users/<login> --jq .id`, or in the api log's refusal line, and add it under `operators` or `allowed.users`, or list its organization under `allowed.accounts`, then restart the api. Never take an id from someone else's link or message without checking whose it is. Under compose the file is the `mergebrief.config.yaml` beside `docker-compose.yml`; on the host it is the one at the repo root, unless `MERGEBRIEF_CONFIG` names another.

## Sign-in does not stick

The reviewer clicks Sign in with GitHub, approves, and lands on the signed-out Home again, usually with "Signing in didn't complete. Try again." and `?error=sign-in-failed` in the address bar.

| Cause | What the api logs | Fix |
| --- | --- | --- |
| The browser is on another origin than `PUBLIC_BASE_URL`, such as `http://localhost:3000` or the server's IP while `PUBLIC_BASE_URL` names your domain. GitHub sends the browser back to `PUBLIC_BASE_URL`, where the sign-in cookie set on the first origin does not exist. | `debug`: `sign-in refused: the state is missing or does not match` | Browse the `PUBLIC_BASE_URL` origin, or set `PUBLIC_BASE_URL` to the origin reviewers browse and update the App's callback URL to match. |
| Plain `http://` on a real hostname. | `debug`: the same line | See [the next entry](#the-browser-refuses-the-__host--cookie). |
| **Expire user authorization tokens** is unchecked in the App settings, so GitHub returns no refresh token. Every sign-in fails. | `debug`: `sign-in refused: GitHub rejected the code` | Check the setting ([github-app.md](./github-app.md#reviewer-sign-in)). |
| One user only: GitHub refused that user's code, for example because their primary email is unverified. | `debug`: the same line | The user fixes it on GitHub and signs in again. |
| GitHub refused the App's OAuth client id or secret. | `error`: `sign-in refused: GitHub refused the App's OAuth credentials`, with `kind` set to GitHub's error token | Fix `GITHUB_OAUTH_CLIENT_ID` or `GITHUB_OAUTH_CLIENT_SECRET`, then `docker compose up -d`. |
| GitHub did not answer the user read after the code exchange. Home says "GitHub couldn't be reached. Try signing in again in a moment." | `warn`: `sign-in failed: GitHub did not answer the user read` | Try again; check GitHub's status if it persists. |
| GitHub reports a `redirect_uri` mismatch. | | The App's callback URL must be `<PUBLIC_BASE_URL>/api/auth/github/callback` ([github-app.md](./github-app.md#set-the-callback-url-and-sign-in-options)). |

A user who cancels on GitHub's consent page lands on Home with no message; the api logs `sign-in cancelled on GitHub` at `debug`.

## The browser refuses the `__Host-` cookie

**You see:** sign-in never completes when reviewers browse `http://brief.example.com`, with the symptoms of the entry above. It works on `http://localhost`.

**Cause:** every MergeBrief cookie is `__Host-` prefixed and `Secure`. A browser drops such a cookie on plain `http://` for any hostname other than `localhost`, so the sign-in state cookie never reaches the callback, and the session cookie would not either.

**Fix:** terminate TLS at a reverse proxy, set `PUBLIC_BASE_URL=https://brief.example.com`, and run `docker compose up -d` ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).

## Every request answers 403 forbidden host

**You see:** every page and every `/api` call answers 403 with `{"error":"forbidden host"}`. Neither log has a line for it: `web` refuses the request before it logs or proxies anything.

**Cause:** the request's `Host` header is not `PUBLIC_BASE_URL`'s hostname, `localhost`, a `*.localhost` name or a bare IP address. Usually `PUBLIC_BASE_URL` still names another domain, or a proxy forwards a host the instance does not know.

**Fix:** set `PUBLIC_BASE_URL` to the origin reviewers browse and run `docker compose up -d`, or have the proxy forward the original `Host` ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).

## Writes answer 403 forbidden

**You see:** reads work, but posting a comment, submitting a review or signing out answers 403 with `"code":"forbidden"`. The api logs `warn` `cookie mutation refused: origin is not this instance` with `secFetchSite` and `originPresent`, and its `api.access` line carries `decision: "403-cross-origin"`.

**Cause:** a signed-in browser request that changes state passes when it carries `Sec-Fetch-Site: same-origin`, or an `Origin` equal to `PUBLIC_BASE_URL`'s origin, scheme and port included. This request carried neither. A browser that sends `Sec-Fetch-Site` passes whatever `PUBLIC_BASE_URL` says, so the refusal shows up when that header is missing, because the browser does not send it or a proxy strips it, and `PUBLIC_BASE_URL` is not the exact origin in the address bar. The two log fields tell you which header was missing.

**Fix:** set `PUBLIC_BASE_URL` to the exact origin reviewers browse, for example `https://brief.example.com` rather than `http://` or a different port, and run `docker compose up -d`. Let your proxy pass `Sec-Fetch-Site` and `Origin` through.

## Requests answer 500 after a key change

**You see:** every request that needs GitHub answers 500, and the api logs `token.decrypt.fail` at `error`. Sessions are kept.

**Cause:** the session key no longer opens the stored GitHub tokens, usually because a `SESSION_KEY_*` variable changed or was removed.

**Fix:** set the key back and run `docker compose up -d` ([If the session key changed or was lost](./secrets.md#if-the-session-key-changed-or-was-lost)).

## Webhook deliveries answer 401

**You see:** the App's **Advanced** tab lists deliveries answered 401 with `{"error":"invalid signature","code":"invalid-signature"}`. The api logs `warn` `webhook signature verification failed` with `evt: webhook.verify.fail` and the `deliveryId` from that tab. Nothing was written.

**Cause:** the signature over the delivery's exact bytes does not match `GITHUB_WEBHOOK_SECRET` as the api holds it. One of these:

- The App's webhook secret and `.env` differ. The HMAC uses the value exactly as set, so a stray character counts.
- `.env` changed but the api still runs the old value, after `docker compose restart` instead of `docker compose up -d`.
- The App has no webhook secret, so GitHub sends no signature at all.
- Something in front of the api rewrites the request body.

**Fix:** set one secret on both sides ([Rotate the webhook secret](./secrets.md#rotate-the-webhook-secret)), then redeliver from the **Advanced** tab. Single 401s from unknown senders are internet scanners; a sustained rate after a rotation means one side did not move.

## Other webhook answers

| Status | Meaning | Fix |
| --- | --- | --- |
| 403 `forbidden host` | The webhook URL's host is not one `web` serves. | [Every request answers 403 forbidden host](#every-request-answers-403-forbidden-host). |
| 400 | The delivery was signed but its body did not parse as an event MergeBrief handles. | Nothing was written. |
| 413 | The body is over the 1 MB cap. | Nothing was read past the cap or written. |
| 500 | An unexpected failure; the api logs `webhook.dispatch.fail` at `error`. | Read that line, then redeliver. |
| 502 | An uninstall or removed-repositories event GitHub could not confirm in time. Nothing was purged. | Redeliver. |

GitHub never retries a failed delivery on its own, so the worker asks it to: every 15 minutes it resends up to 20 of what failed in the last three days, waiting longer after each attempt and stopping after five. A 400 or 413 is never resent, nor is a revoked authorization, and a push or review stays back once its installation had a later uninstall or removed repositories. You can also redeliver from the App's **Advanced** tab. GitHub also refuses a `localhost` or private webhook URL at registration ([github-app.md](./github-app.md#set-the-webhook)).

## The worker cannot list webhook deliveries

**You see:** the worker logs `warn` `webhook reconcile: GitHub did not list deliveries` with a `code` field, at most once every 15 minutes. The line has no `evt`. The worker keeps running, and no failed delivery is resent while the line repeats.

**Cause:** the resend pass reads the App's delivery log from GitHub, signed with `GITHUB_APP_ID` and the App's private key, and the read failed. `code` says how:

- `unauthorized`, `forbidden` or `not-found`: GitHub refused the App's credentials. Usually `GITHUB_APP_ID` is mistyped, or the private key belongs to another App.
- `request-failed`: the request did not complete, GitHub answered with another status, or the answer could not be read. A private key that is not a valid PEM also lands here, because the request is never signed.
- `rate-limited`: GitHub throttled the App.

**Fix:** for a credentials code, copy the App id and a current private key from the App's settings into `.env` ([configuration.md](./configuration.md#github-app-and-sign-in)), then run `docker compose up -d`. A single `request-failed` or `rate-limited` line needs nothing: each pass reads the last three days again, so the next one catches up. If it repeats, check the host's route to `api.github.com`.

## No brief appears

Open the pull request in MergeBrief: the brief page says where the push stands.

| The brief page says | Cause | Fix |
| --- | --- | --- |
| "No brief for this pull request yet" and "The next push (or a submitted review) is briefed as usual in a repository where the App is installed." | No job was queued. The worker is down, the account is not listed, or the delivery never arrived. | Check `docker compose ps -a` for a worker at `Exited (0)` ([A service exits with code 0](#a-service-exits-with-code-0)). If the api logs `webhook: ignored a delivery from an account this instance does not list`, add the logged id under [`allowed.accounts`](./generators.md#who-may-start-a-brief) and restart the api. Otherwise check **Recent Deliveries** on the App's **Advanced** tab. Then push again, or redeliver. |
| "Brief available on demand" | The author is not on the repository's team, so the first brief waits for someone with push access. | That person clicks **Generate brief**. Later pushes generate as usual ([Who triggers a brief](./github-app.md#who-triggers-a-brief)). |
| "No brief for this push yet", with a "Waiting on" or "Needs a change first" list | A [trigger condition](../repo-config/trigger-conditions.md) holds the push, such as a draft under `readyForReview`. The worker logs `generation.hold` with the condition `kinds`. | It generates by itself once every condition passes. To generate now, click **Generate brief**. |
| "Can't check CI until this installation accepts MergeBrief's Checks and Commit statuses permissions", or the same for a bot | A `bots` or `ci` condition needs a permission the installation has not accepted. | Set the permissions and accept them on each installation ([github-app.md](./github-app.md#accept-the-checks-and-commit-statuses-permissions)), then push or click **Generate brief**. |
| "Holding briefly in case more commits land." | The debounce, about 60 seconds after a push. | Wait. |
| "Other briefs are generating. This one starts when a slot frees up." | Every worker slot is busy. | Wait, or add slots ([Add worker capacity](./data-and-scaling.md#add-worker-capacity)). |
| "Daily generation cap reached." | The instance hit `spend.maxGenerationsPerDay`. The worker logs `spend.cap.trip`. | Raise the cap, or wait for the reset at 00:00 UTC and push again ([generators.md](./generators.md#daily-generation-cap)). |
| "Too few runs were left to brief this pull request." or "This pull request is too large for this instance's daily cap." | A pull request briefed in parts needs more runs than the day has left, or than the cap allows at all. | Wait for the reset, or raise the cap ([The large pool](./generators.md#the-large-pool)). |
| "Generation for this push stopped: its queued job used every attempt." | The job's retries ran out. The worker logs `job.retries.exhausted`. | Read the worker's earlier `job.fail` lines for that push to find the cause, fix it, then push again or regenerate. |
| "Brief generation failed" | The run failed. | [A brief failed](#a-brief-failed). |

## A brief failed

**You see:** the brief page shows "Brief generation failed" with a reason, a count such as "2 attempts so far.", and often a **Regenerate brief** button for anyone with push access. On GitHub, the Entry comment reads "No brief for `<sha>`: generation failed." and links to the push in MergeBrief.

Every failure also logs `job.fail` in the worker, with the message `generate: permanent failure` or `generate: failed (...)`. A failure at the model provider adds `provider.error` with `provider`, and `status` or `kind` ([observability.md](./observability.md#event-vocabulary)). Find the reason the page shows:

| The page says | Cause | Fix |
| --- | --- | --- |
| "The model provider rejected the configured credentials." | The provider refused the key: `provider.error` with `status` 401 or 403. | Put a valid key in the variable the `generator:` block reads, `ANTHROPIC_API_KEY` by default, run `docker compose up -d`, then **Regenerate brief**. |
| "The model provider's rate limit was hit." | The provider answered 429 through every retry. | **Regenerate brief** later. If it repeats, lower the slot count or `generator.detailConcurrency`, or raise the provider's limit ([Worker slots](./generators.md#worker-slots)). |
| "The model provider timed out before finishing." | The provider answered 408, or the call ran past its time limit. | **Regenerate brief**. |
| "The model provider could not be reached." | The provider answered 5xx, or the connection failed, through every retry. | Check the provider's status and the host's outbound route to it, then **Regenerate brief**. |
| "The model declined to summarize this pull request." | The model refused. | Nothing on the instance changes this push: a rerun refuses the same way, so no button is offered. The next push is briefed as usual. |
| "The model provider refused the request because the account reached a spend limit: ..." | `provider.error` with `kind: provider-spend-limit`. | Raise the limit on the provider's billing page, or wait for it to reset, then **Regenerate brief**. |
| "The model returned output that could not be read as a brief." | The answer failed the brief's schema after salvage and one feedback retry. The raw answer is saved in the worker ([Read a failed generation's raw output](./data-and-scaling.md#read-a-failed-generations-raw-output)). | **Regenerate brief**. If it repeats, use a stronger `model:` ([generators.md](./generators.md#length-discipline-and-anchoring-degrade-on-weaker-models)). |
| "Generation stopped: the output contained a value this instance treats as secret. Your operator has been told." | The model's output held the value of one of the worker's secret variables, so nothing was stored. The `job.fail` line reads `generation output contained the value of <VARIABLE> at <field>`, naming the variable, never the value. | Find where the value came from: the pull request, its description or a linked ticket. If it is there, it is exposed: rotate that secret ([secrets.md](./secrets.md)). A rerun of this push fails the same way. |
| "The brief ran past the model's output length limit and was cut off before it finished. ..." | The answer reached the model's output token cap. The raw answer is saved, as for unreadable output. | A rerun is cut the same way, so no button is offered. The next push is briefed as usual. If it repeats across pull requests, try another `model:`. |
| "Generator configuration is invalid: ..." | The worker's `generator:` block failed at run time; the text after the colon names the problem. | Fix the `generator:` block or its key variable, run `docker compose restart worker`, then **Regenerate brief** ([generators.md](./generators.md#the-config-file)). |
| "GitHub denied access to this repository's content." | GitHub refused the content read: the App lacks **Contents: Read**, the repository left the installation, or, for a pasted pull request, the reviewer or the URL fallback token cannot read it. | Grant the permission and accept it on the installation ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these)), or add the repository back, then **Regenerate brief**. |
| "The diff is too large to summarize. MergeBrief briefs a pull request only when it changes up to 3,000 files and GitHub serves its whole diff." | The pull request changes more than 3,000 files, or GitHub served its diff short. Past GitHub's diff limit the worker reads the compare API and accepts it only when it holds every changed file. | Split the pull request. |
| "GitHub was unavailable while reading the pull request." | GitHub answered with an outage or a rate limit through every retry. | Check GitHub's status, then **Regenerate brief**. |
| "The brief stopped after using all its attempts for this push and will not try again on its own." | Retries ran out. The worker logs `job.retries.exhausted`. | Read the earlier `job.fail` lines for that push to find the cause. Then **Regenerate brief**, or a new push, a submitted review or a review request queues a new run. |
| "Generation failed: ..." | A failure with no named class; the text after the colon is the detail. | Read the matching `job.fail` line, then **Regenerate brief**. If it repeats, report it with that line. |
| "No failure detail was recorded." | The run recorded no reason. | Read the worker's `job.fail` lines for that push. |

A failure that needs the operator first, such as credentials or configuration, adds a line under the reason saying so, for example "An operator needs to update this instance's model provider credentials before a rerun can succeed."

## No Entry comment appears

**You see:** the brief opens in MergeBrief, but the pull request has no comment from the App. The worker logs `warn` `generate: entry comment post failed (job unaffected)`, naming status 403 and `Pull requests: write`.

**Cause:** the App lacks **Pull requests: Read & write**, or GitHub is still waiting for the installation to accept that permission. The generation itself succeeds, so nothing in the UI reports this.

**Fix:** set the permission ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these)), then accept the pending request on the installation's settings page on GitHub. Changing the App's settings alone does not reach an existing installation. Then push a commit to the pull request: the comment is not posted retroactively.

## The brief shows warnings

- **An amber `generationWarnings` block under the header:** salvage, the feedback retry or a served-model mismatch fired. The brief is still valid ([generators.md](./generators.md#when-something-degrades)).
- **"Some brief text is longer than the length guidance":** the model overran the length caps. A stronger `model:` fixes it; configuration does not ([generators.md](./generators.md#length-discipline-and-anchoring-degrade-on-weaker-models)).
- **The ticket card says unread:** the card names one of five codes ([trackers.md](./trackers.md#when-the-ticket-is-unread)). The brief is produced from the diff either way.
- **"Too large to compare" or "too large to summarize":** the push changed more than 300 files, GitHub would not serve the diff, its changed lines reached `generator.hugeSpanRatio`, or it exceeds one call's limits. The brief itself is complete ([generators.md](./generators.md#the-300-file-span-limit)).

## GitHub refused the URL fallback token

**You see:** at boot, the api and the worker each log `error` `GitHub refused MERGEBRIEF_URL_FALLBACK_TOKEN, so it serves nobody; fix the token and restart` with `evt: url-fallback-token.owner.fail`, `status` and `code`. The token's owner gets 404 `not-found` when they paste a private pull request the App is not installed on, the same answer as a pull request that does not exist.

**Cause:** GitHub answered the token's `GET /user` with 401, a 403 that is not a rate limit, or 404. The token is revoked, expired, or not a user token. The refusal holds for the life of the process; the api and the worker read the token only at boot.

**Fix:** make a new fine-grained token on your own GitHub account, with Contents and Pull requests read, and swap it in ([Replace the URL fallback token](./secrets.md#replace-the-url-fallback-token)).

Related lines:

| Line | Meaning | Fix |
| --- | --- | --- |
| `info` `URL fallback token serves its owner only`, with `ownerId` | The lookup worked. `ownerId` is the one GitHub user id the token serves. | If that is not your id (`gh api users/<login> --jq .id`), the token was made on another account, such as a bot. Make it on your own. |
| `warn` `URL fallback token owner lookup failed; the token serves nobody until a retry succeeds`, with `retryInMs` | GitHub did not answer the lookup. It retries in the background, from 30 seconds up to every 15 minutes. | Nothing, unless it keeps repeating; then check the host's route to `api.github.com`. |
| `warn` `URL fallback token rejected by GitHub, check MERGEBRIEF_URL_FALLBACK_TOKEN` | The token stopped working after boot. A paste, or a read for a URL pull request, fell back to the reviewer's own denial. | Replace the token as above. |
| `MERGEBRIEF_URL_BOX_TOKEN is no longer read: rename it to MERGEBRIEF_URL_FALLBACK_TOKEN.` | The variable's old name. | Rename it in `.env`, then `docker compose up -d` ([configuration.md](./configuration.md#variables-that-are-not-read)). |

## The update check fails

**You see:** no version notice, `/api/version` carries no fresh `checkedAt`, and the api logs `update.check.fail` at `info` once after boot, then at `debug`.

**Cause:** the host cannot reach github.com, or the release file it fetched is malformed.

**Fix:** allow the api outbound HTTPS to github.com and release-assets.githubusercontent.com, where the release file redirects, or point `updateCheck.url` at a mirror ([Turn off or mirror the update check](./upgrade.md#turn-off-or-mirror-the-update-check)).
