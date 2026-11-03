# Troubleshooting

Find the symptom, then the cause and the fix. Each entry names the log line or
status you will see, so you can confirm the cause before you change anything.

Three habits apply to every fix below:

- **Read the last log line first.** `docker compose ps` shows what is down,
  and `docker compose logs <service>` shows why. A process that refuses boot
  names the variable and the reason, never the value.
- **Apply `.env` edits with `docker compose up -d`.** It recreates the
  services with the new environment; `docker compose restart` keeps the old
  one.
- **Some causes log only at `debug`.** Set `LOG_LEVEL=debug` in `.env`, run
  `docker compose up -d`, reproduce, then set it back.

## Index

| Symptom | Go to |
| --- | --- |
| `up` fails with a Dockerfile-not-found error | [The stack does not start](#the-stack-does-not-start) |
| `api` or `worker` shows `Exited (0)` | [A service exits with code 0](#a-service-exits-with-code-0) |
| Webhooks answer 200 but no brief appears | [A service exits with code 0](#a-service-exits-with-code-0), then [No brief appears](#no-brief-appears) |
| A brief generates but the pull request gets no Entry comment | [No Entry comment appears](#no-entry-comment-appears) |
| Sign in returns to the signed-out Home | [Sign-in does not stick](#sign-in-does-not-stick) |
| Sign-in fails on `http://` with a real hostname | [The browser refuses the `__Host-` cookie](#the-browser-refuses-the-__host--cookie) |
| GitHub reports a `redirect_uri` mismatch | [Sign-in does not stick](#sign-in-does-not-stick) |
| Every page answers 403 `forbidden host` | [Every request answers 403 forbidden host](#every-request-answers-403-forbidden-host) |
| Reads work, but posting, submitting or signing out answers 403 | [Writes answer 403 forbidden](#writes-answer-403-forbidden) |
| Every GitHub-backed request answers 500 | [Requests answer 500 after a key change](#requests-answer-500-after-a-key-change) |
| Webhook deliveries answer 401 | [Webhook deliveries answer 401](#webhook-deliveries-answer-401) |
| Webhook deliveries answer 400, 403, 413, 500 or 502 | [Other webhook answers](#other-webhook-answers) |
| `url-fallback-token.owner.fail` in the api or worker log | [GitHub refused the URL fallback token](#github-refused-the-url-fallback-token) |
| A brief carries an amber warnings block | [The brief shows warnings](#the-brief-shows-warnings) |
| The ticket card says the ticket is unread | [The brief shows warnings](#the-brief-shows-warnings) |
| No version notice, and `update.check.fail` in the api log | [The update check fails](#the-update-check-fails) |

## The stack does not start

| You see | Cause | Fix |
| --- | --- | --- |
| `up` fails with a Dockerfile-not-found error | The image pull was denied or the registry was unreachable, and Compose fell back to building from source. | Run `docker compose pull` and read its error ([compose.md](./compose.md#verifying--troubleshooting)). |
| Compose rejects the `env_file` entries before anything starts | Docker Compose is older than v2.24, which added the `path` and `required` form the shipped files use. | Upgrade Docker Compose ([README.md](./README.md#prerequisites)). |
| Every compose command fails before anything starts, after you set `COMPOSE_FILE` | A file `COMPOSE_FILE` lists does not exist. | Fetch the file, or remove it from the list ([compose.md](./compose.md#external-postgres-managed-database)). |
| `api` and `worker` cannot connect to Postgres after you changed `POSTGRES_PASSWORD` | Postgres writes the role on its first start only. | Set the old value back, or change the role inside the container ([compose.md](./compose.md#1-postgres-credentials)). |
| Boot is refused naming `sslmode` | A non-loopback `DATABASE_URL` carries neither `sslmode=verify-full` nor `sslmode=disable`. | Change the DSN ([compose.md](./compose.md#tls-verify-full-or-disable-sslmode-in-the-dsn)). |
| `api` or `worker` exits 1 naming a pending migration count | `MERGEBRIEF_AUTO_MIGRATE=false` and the database is behind the release. | Run the migrate step ([operations.md](./operations.md#external-database-auto-migratefalse)). |
| `api` answers nothing and `web` answers 503 on `/api/*` | `web` cannot reach `api`. | `curl -i localhost:3000/api/version`: a 401 means both are up; a 503 means read `docker compose logs api` ([compose.md](./compose.md#verifying--troubleshooting)). |

## A service exits with code 0

`api` and `worker` exit 0 on a configuration error, so compose's
`restart: on-failure` leaves them down instead of restarting into the same
error. A transient fault, such as a Postgres boot race, exits 1 and restarts.
The `worker` has no HTTP surface, so `docker compose ps` showing
`Exited (0)` is the only sign, and webhooks keep answering 200 while no brief
appears.

Read the last line of `docker compose logs worker`:

| Last line starts with | Cause | Fix |
| --- | --- | --- |
| `worker composition: invalid configuration` | A worker variable is missing or malformed; the line names it. | Fix it in `.env`, then `docker compose up -d`. |
| `worker composition: invalid GitHub configuration` | A GitHub App variable is missing or malformed. | Same. |
| `worker composition: invalid generator configuration` | The provider block refused, for example a missing key or a CLI provider in the shipped image ([generators.md](./generators.md#harness-clis-are-host-process-only-in-v1-deliberately)). | Fix the `generator:` block or its key variable. If the line says `config file: not readable (EACCES)`, UID 1000 cannot read the mounted file: `chmod 644 mergebrief.config.yaml`. |
| `worker composition: invalid tracker configuration` or `worker composition: trackers` | A tracker in the instance config cannot be read, such as a `notion` entry whose token is unset ([trackers.md](./trackers.md#notion)). | Set the token, or remove the entry. |
| `worker composition: invalid tracing configuration` | An `OTEL_*` value is invalid while an endpoint is set ([observability.md](./observability.md#tracing)). | Fix the value, or unset the endpoint. |
| `worker composition: invalid logging configuration` | `LOG_LEVEL` is not `error`, `warn`, `info` or `debug`. | Fix or remove the variable. |
| `worker: stopped` | A plain stop, such as a host reboot. | `docker compose up -d`. |

`api` follows the same rule; its lines start with `api composition:`.
[generators.md](./generators.md#when-something-degrades) has the same triage
from the generation side.

## Sign-in does not stick

The reviewer clicks Sign in with GitHub, approves, and lands on the signed-out
Home again, usually with "Signing in didn't complete. Try again." and
`?error=sign-in-failed` in the address bar.

| Cause | What the api logs | Fix |
| --- | --- | --- |
| The browser is on another origin than `PUBLIC_BASE_URL`, such as `http://localhost:3000` or the server's IP while `PUBLIC_BASE_URL` names your domain. GitHub sends the browser back to `PUBLIC_BASE_URL`, where the sign-in cookie set on the first origin does not exist. | `debug`: `sign-in refused: the state is missing or does not match` | Browse the `PUBLIC_BASE_URL` origin, or set `PUBLIC_BASE_URL` to the origin reviewers browse and update the App's callback URL to match. |
| Plain `http://` on a real hostname. | `debug`: the same line | See [the next entry](#the-browser-refuses-the-__host--cookie). |
| **Expire user authorization tokens** is unchecked in the App settings, so GitHub returns no refresh token. Every sign-in fails. | `debug`: `sign-in refused: GitHub rejected the code` | Check the setting ([github-app.md](./github-app.md#reviewer-sign-in)). |
| One user only: GitHub refused that user's code, for example because their primary email is unverified. | `debug`: the same line | The user fixes it on GitHub and signs in again. |
| GitHub refused the App's OAuth client id or secret. | `error`: `sign-in refused: GitHub refused the App's OAuth credentials`, with `kind` set to GitHub's error token | Fix `GITHUB_OAUTH_CLIENT_ID` or `GITHUB_OAUTH_CLIENT_SECRET`, then `docker compose up -d`. |
| GitHub did not answer the user read after the code exchange. Home says "GitHub couldn't be reached. Try signing in again in a moment." | `warn`: `sign-in failed: GitHub did not answer the user read` | Try again; check GitHub's status if it persists. |
| GitHub reports a `redirect_uri` mismatch. | | The App's callback URL must be `<PUBLIC_BASE_URL>/api/auth/github/callback` ([github-app.md](./github-app.md#webhook)). |

A user who cancels on GitHub's consent page lands on Home with no message;
the api logs `sign-in cancelled on GitHub` at `debug`.

## The browser refuses the `__Host-` cookie

**You see:** sign-in never completes when reviewers browse
`http://brief.example.com`, with the symptoms of the entry above. It works on
`http://localhost`.

**Cause:** every MergeBrief cookie is `__Host-` prefixed and `Secure`. A
browser drops such a cookie on plain `http://` for any hostname other than
`localhost`, so the sign-in state cookie never reaches the callback, and the
session cookie would not either.

**Fix:** terminate TLS at a reverse proxy, set
`PUBLIC_BASE_URL=https://brief.example.com`, and run `docker compose up -d`
([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).

## Every request answers 403 forbidden host

**You see:** every page and every `/api` call answers 403 with
`{"error":"forbidden host"}`. Neither log has a line for it: `web` refuses
the request before it logs or proxies anything.

**Cause:** the request's `Host` header is not `PUBLIC_BASE_URL`'s hostname,
`localhost`, a `*.localhost` name or a bare IP address. Usually
`PUBLIC_BASE_URL` still names another domain, or a proxy forwards a host the
instance does not know.

**Fix:** set `PUBLIC_BASE_URL` to the origin reviewers browse and run
`docker compose up -d`, or have the proxy forward the original `Host`
([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).

## Writes answer 403 forbidden

**You see:** reads work, but posting a comment, submitting a review or signing
out answers 403 with `"code":"forbidden"`. The api logs `warn`
`cookie mutation refused: origin is not this instance` with `secFetchSite`
and `originPresent`, and its `api.access` line carries
`decision: "403-cross-origin"`.

**Cause:** a signed-in browser request that changes state passes when it
carries `Sec-Fetch-Site: same-origin`, or an `Origin` equal to
`PUBLIC_BASE_URL`'s origin, scheme and port included. This request carried
neither. A browser that sends `Sec-Fetch-Site` passes whatever
`PUBLIC_BASE_URL` says, so the refusal shows up when that header is missing,
because the browser does not send it or a proxy strips it, and
`PUBLIC_BASE_URL` is not the exact origin in the address bar. The two log
fields tell you which header was missing.

**Fix:** set `PUBLIC_BASE_URL` to the exact origin reviewers browse, for
example `https://brief.example.com` rather than `http://` or a different
port, and run `docker compose up -d`. Let your proxy pass `Sec-Fetch-Site`
and `Origin` through.

## Requests answer 500 after a key change

**You see:** every request that needs GitHub answers 500, and the api logs
`token.decrypt.fail` at `error`. Sessions are kept.

**Cause:** the session key no longer opens the stored GitHub tokens, usually
because a `SESSION_KEY_*` variable changed or was removed.

**Fix:** set the key back ([operations.md](./operations.md#tokens-at-rest)).

## Webhook deliveries answer 401

**You see:** the App's **Advanced** tab lists deliveries answered 401 with
`{"error":"invalid signature","code":"invalid-signature"}`. The api logs
`warn` `webhook signature verification failed` with
`evt: webhook.verify.fail` and the `deliveryId` from that tab. Nothing was
written.

**Cause:** the signature over the delivery's exact bytes does not match
`GITHUB_WEBHOOK_SECRET` as the api holds it. One of these:

- The App's webhook secret and `.env` differ. The HMAC uses the value exactly
  as set, so a stray character counts.
- `.env` changed but the api still runs the old value, after
  `docker compose restart` instead of `docker compose up -d`.
- The App has no webhook secret, so GitHub sends no signature at all.
- Something in front of the api rewrites the request body.

**Fix:** generate one secret with `openssl rand -hex 32`, set it in the App
settings and in `.env`, run `docker compose up -d`, then redeliver from the
**Advanced** tab. Single 401s from unknown senders are internet scanners; a
sustained rate after a rotation means one side did not move
([compose.md](./compose.md#3-the-webhook-secret-is-the-only-gate-on-the-webhook-route)).

## Other webhook answers

| Status | Meaning | Fix |
| --- | --- | --- |
| 403 `forbidden host` | The webhook URL's host is not one `web` serves. | [Every request answers 403 forbidden host](#every-request-answers-403-forbidden-host). |
| 400 | The delivery was signed but its body did not parse as an event MergeBrief handles. | Nothing was written. |
| 413 | The body is over the 1 MB cap. | Nothing was read past the cap or written. |
| 500 | An unexpected failure; the api logs `webhook.dispatch.fail` at `error`. | Read that line, then redeliver. |
| 502 | An uninstall or removed-repositories event GitHub could not confirm in time. Nothing was purged. | Redeliver. |

GitHub never retries a failed delivery on its own; redeliver from the App's
**Advanced** tab. GitHub also refuses a `localhost` or private webhook URL at
registration ([github-app.md](./github-app.md#webhook)).

## No brief appears

| You see | Cause | Fix |
| --- | --- | --- |
| `docker compose ps` shows the worker `Exited (0)` | The worker refused boot or was stopped. | [A service exits with code 0](#a-service-exits-with-code-0). |
| The pull request shows it is awaiting a trigger | Its author is not on the repository's team. | Someone with push access starts the first brief ([github-app.md](./github-app.md#who-triggers-a-brief)). |
| A draft gets no brief | The instance config sets `drafts.generate: off`. | Mark it ready, or change the policy ([repo-config.md](./repo-config.md#related-instance-block-drafts-operator-side)). |
| The brief view says the daily generation cap was reached; the worker logs `spend.cap.trip` | The instance hit `spend.maxGenerationsPerDay`. | Raise the cap, or wait for 00:00 UTC and the next push ([generators.md](./generators.md#daily-generation-cap)). |
| The generation row is `failed` with `error_code` `diff-too-large` | The pull request changes more than 3,000 files, MergeBrief's limit, or GitHub served its diff short. Past GitHub's pull request diff limit the worker reads the same span from the compare API and accepts it only when it holds every changed file. | Split the pull request. |
| The generation row is `failed`; the worker logs `job.fail` or `job.retries.exhausted` | A permanent failure, such as GitHub's "diff too large", or retries ran out. | Read the row's `error_code` with the query in [compose.md](./compose.md#verifying--troubleshooting). |
| The worker logs `provider.error` with `status` 401 or 403 | The provider refused the key. | Fix the key the `generator:` block names ([observability.md](./observability.md#event-vocabulary)). |

## No Entry comment appears

**You see:** the brief opens in MergeBrief, but the pull request has no comment
from the App. The worker logs `warn`
`generate: entry comment post failed (job unaffected)`, ending in
`GitHub API returned status 403`.

**Cause:** the App lacks **Pull requests: Read & write**, or GitHub is still
waiting for the installation to accept that permission. The generation itself
succeeds, so nothing in the UI reports this.

**Fix:** set the permission ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these-four)),
then accept the pending request on the installation's settings page on GitHub.
Changing the App's settings alone does not reach an existing installation. Then
push a commit to the pull request: the comment is not posted retroactively.

## The brief shows warnings

- **An amber `generationWarnings` block under the header:** salvage, the
  feedback retry or a served-model mismatch fired. The brief is still valid
  ([generators.md](./generators.md#when-something-degrades)).
- **"Some brief text is longer than the length guidance":** the model overran the length
  caps. A stronger `model:` fixes it; configuration does not
  ([generators.md](./generators.md#length-discipline-and-anchoring-degrade-on-weaker-models)).
- **The ticket card says unread:** the card names one of five codes
  ([trackers.md](./trackers.md#when-the-ticket-is-unread)). The brief is
  produced from the diff either way.

## GitHub refused the URL fallback token

**You see:** at boot, the api and the worker each log `error`
`GitHub refused MERGEBRIEF_URL_FALLBACK_TOKEN, so it serves nobody; fix the token and restart`
with `evt: url-fallback-token.owner.fail`, `status` and `code`. The token's
owner gets 404 `not-found` when they paste a private pull request the App is
not installed on, the same answer as a pull request that does not exist.

**Cause:** GitHub answered the token's `GET /user` with 401, a 403 that is not
a rate limit, or 404. The token is revoked, expired, or not a user token. The
refusal holds for the life of the process; the api and the worker read the
token only at boot.

**Fix:** make a new fine-grained token on your own GitHub account, with
Contents and Pull requests read, set it as `MERGEBRIEF_URL_FALLBACK_TOKEN` in
`.env`, and run `docker compose up -d` so both services boot with it
([compose.md](./compose.md#hardening-before-real-exposure)).

Related lines:

| Line | Meaning | Fix |
| --- | --- | --- |
| `info` `URL fallback token serves its owner only`, with `ownerId` | The lookup worked. `ownerId` is the one GitHub user id the token serves. | If that is not your id (`gh api users/<login> --jq .id`), the token was made on another account, such as a bot. Make it on your own. |
| `warn` `URL fallback token owner lookup failed; the token serves nobody until a retry succeeds`, with `retryInMs` | GitHub did not answer the lookup. It retries in the background, from 30 seconds up to every 15 minutes. | Nothing, unless it keeps repeating; then check the host's route to `api.github.com`. |
| `warn` `URL fallback token rejected by GitHub, check MERGEBRIEF_URL_FALLBACK_TOKEN` | The token stopped working after boot. A paste, or a read for a URL pull request, fell back to the reviewer's own denial. | Replace the token as above. |
| `MERGEBRIEF_URL_BOX_TOKEN is no longer read: rename it to MERGEBRIEF_URL_FALLBACK_TOKEN.` | The variable's old name. | Rename it in `.env`, then `docker compose up -d` ([configuration.md](./configuration.md#variables-that-are-not-read)). |

## The update check fails

**You see:** no version notice, `/api/version` carries no fresh `checkedAt`,
and the api logs `update.check.fail` at `info` once after boot, then at
`debug`.

**Cause:** the host cannot reach github.com, or the release file it fetched
is malformed.

**Fix:** allow the api outbound HTTPS to github.com and
release-assets.githubusercontent.com, where the release file redirects, or point
`MERGEBRIEF_UPDATE_CHECK_URL` at a mirror
([operations.md](./operations.md#the-update-check)).
