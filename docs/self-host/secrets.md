# Rotate secrets

Every secret lives in `.env`, or in a file a `.env` variable names, and `api` and `worker` read it once, at boot. A value in `.env` takes effect with `docker compose up -d` ([Apply a change](./configuration.md#apply-a-change)). A file, such as the one `GITHUB_APP_PRIVATE_KEY_PATH` or `DATABASE_URL_FILE` names, takes `docker compose restart api worker`, because compose cannot see a file's contents change. `web` holds none of these secrets and never needs a restart for them. Run every command in the folder that holds `docker-compose.yml` and `.env`.

| Secret | Variable | Steps |
| --- | --- | --- |
| Session key | `SESSION_KEY_V1`, `SESSION_KEY_REF` | [Rotate the session key](#rotate-the-session-key) |
| GitHub App private key | `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH` | [Rotate the GitHub App private key](#rotate-the-github-app-private-key) |
| OAuth client secret | `GITHUB_OAUTH_CLIENT_SECRET` | [Rotate the OAuth client secret](#rotate-the-oauth-client-secret) |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` | [Rotate the webhook secret](#rotate-the-webhook-secret) |
| Postgres password | `POSTGRES_PASSWORD`, or `DATABASE_URL` on an external database | [Change the Postgres password](#change-the-postgres-password) |
| URL fallback token | `MERGEBRIEF_URL_FALLBACK_TOKEN` | [Replace the URL fallback token](#replace-the-url-fallback-token) |
| Model provider key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or the one `generator.apiKeyEnv` names | [Rotate the model provider key](#rotate-the-model-provider-key) |
| Tracker token | `NOTION_TOKEN`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | [Rotate a tracker token](#rotate-a-tracker-token) |
| OTLP header credential | the collector's own file, or `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | [Rotate an OTLP header credential](#rotate-an-otlp-header-credential) |
| A user's account or MergeBrief API token, not an instance secret | none | [If an account or token leaks](./security-model.md#if-an-account-or-token-leaks) |

## Rotate the session key

The session key encrypts each signed-in user's stored GitHub tokens. Rotate it under a new variable name, never by changing a value in place: existing tokens keep opening under the old name while new ones seal under the new one, and nobody is signed out.

1. **Add a new key** to `.env` under a new name, keeping `SESSION_KEY_V1`:

   ```sh
   openssl rand -base64 32
   ```

   ```dotenv
   SESSION_KEY_V1=<the current key, unchanged>
   SESSION_KEY_V2=<the new key>
   SESSION_KEY_REF=SESSION_KEY_V2
   ```

2. **Recreate the services:**

   ```sh
   docker compose up -d
   ```

   New sign-ins and every token refresh now seal under `SESSION_KEY_V2`. The worker never seals; it opens each stored token by the name it was sealed under, so it only needs both keys present.

3. **Keep `SESSION_KEY_V1` set until no stored token names it.** This count reaches 0 as users sign in again or their tokens refresh:

   ```sh
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from github_grant where key_ref = '\''SESSION_KEY_V1'\''"'
   ```

   On an external database, run the same query the [external way](./backup-restore.md#run-sql-on-an-external-database).

4. **Remove `SESSION_KEY_V1`** from `.env` once the count is 0, then run `docker compose up -d`.

**Check:** sign in from a private window. Removing a key while the count is above 0 breaks those users' GitHub calls until you set it back ([below](#if-the-session-key-changed-or-was-lost)).

### If the session key changed or was lost

Changing `SESSION_KEY_V1` in place, losing it, or removing any `SESSION_KEY_*` a stored token still names breaks every token sealed under that name. So does a ciphertext moved into another row, column or `key_ref` ([How GitHub tokens are stored](#how-github-tokens-are-stored)). What happens:

- Every request from those users that needs GitHub answers 500, and the api logs `token.decrypt.fail` at `error`. An access token fails at the user's next GitHub call, a refresh token when the access token next needs one.
- Nobody is signed out: their sessions and API tokens stay valid, and only the GitHub side fails, until the key matches again, the user signs out, or the session expires.
- Generating a pasted pull request for one of them fails until they sign in again.
- The worker's hourly sweep cannot revoke their tokens at GitHub. It logs `grant.revoke.fail` with `code: credential-unreadable` and deletes the stored token anyway; GitHub expires it on its own.

**Fix:** put the old value back under its old name and run `docker compose up -d`. If the old value is gone, each user recovers by signing out and in again, which seals a new token under the current key. An API token stays bound to the sign-in it was created from, so each user also revokes their old API tokens in `/settings` and creates new ones. **Check:** the user's next GitHub-backed request answers, and no new `token.decrypt.fail` line names their `reviewerId`.

## Rotate the GitHub App private key

`api` and `worker` both sign with it. GitHub accepts every private key the App holds, so the rotation has no gap.

1. On the App's settings page, open **Credentials** in the left sidebar, then **Key pairs**, and choose **New key**. Your browser downloads the new key as a PEM file. The old key keeps working.
2. Put the new PEM in `GITHUB_APP_PRIVATE_KEY` in `.env`, or replace the file `GITHUB_APP_PRIVATE_KEY_PATH` names.
3. Apply it: `docker compose up -d` for the inline key, `docker compose restart api worker` for a key file.
4. **Check:** push a commit to a pull request in an installed repository and confirm its brief generates. Boot reads the key but never shows it to GitHub, so a key GitHub does not accept fails only at the first call that needs the App.
5. Delete the old key under **Key pairs**.

## Rotate the OAuth client secret

`api` uses `GITHUB_OAUTH_CLIENT_SECRET` to finish a sign-in, to refresh a user's GitHub token and to revoke one; `worker` uses it to revoke the tokens its hourly sweep removes.

1. On the App's settings page, under **Client secrets**, choose **Generate a new client secret**. The old one keeps working.
2. Set `GITHUB_OAUTH_CLIENT_SECRET` in `.env` and run `docker compose up -d`.
3. **Check:** sign in from a private window.
4. Delete the old secret on GitHub.

Signed-in users notice nothing. A secret GitHub no longer accepts fails every sign-in, with `sign-in refused: GitHub refused the App's OAuth credentials` at `error` in the api log, and every token refresh, with `token.refresh.fail`.

## Rotate the webhook secret

The App holds one webhook secret, so GitHub and MergeBrief change together. Deliveries GitHub sends while the two differ answer 401, log `webhook.verify.fail`, and write nothing.

1. Generate a new secret. Boot refuses one under 32 characters:

   ```sh
   openssl rand -hex 32
   ```

2. Set it as the App's **Webhook secret** on GitHub, then at once set `GITHUB_WEBHOOK_SECRET` in `.env` and run `docker compose up -d`. Only `api` verifies deliveries, but `worker` parses the same variable, and both are recreated.
3. **Check:** on the App's **Advanced** tab, redeliver the newest delivery under **Recent Deliveries**. It answers `200`.

The worker resends the deliveries that failed in between ([how and when](./troubleshooting.md#other-webhook-answers)). To do it sooner, redeliver those from the **Advanced** tab. A `webhook.verify.fail` rate that stays up after the rotation means one side did not move.

## Change the Postgres password

The bundled `postgres` image reads `POSTGRES_PASSWORD` only when it creates an empty volume. After that, changing `.env` alone leaves the role's password as it was, while compose builds the `api` and `worker` connection string from the new value, so both fail to connect. Change the role first.

1. **Generate a password** and use it verbatim: it lands in a connection string unescaped ([Postgres credentials](./compose.md#1-postgres-credentials)).

   ```sh
   openssl rand -hex 24
   ```

2. **Stop the services that hold connections:**

   ```sh
   docker compose stop web api worker
   ```

3. **Set the role's password inside the container.** `\password` prompts twice and keeps the value out of your shell history and the server log:

   ```sh
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

   At the `psql` prompt:

   ```text
   \password
   \q
   ```

4. **Set `POSTGRES_PASSWORD` in `.env`** to the same value. If `.env` also carries a host `DATABASE_URL` for the bundled database, used by host tooling, update its password too.
5. **Start:**

   ```sh
   docker compose up -d --wait
   ```

   Compose recreates `postgres` with the new environment, which the image ignores, and `api` and `worker` with the connection string built from it. The data stays in the volume.

**Check:** `docker compose ps -a` shows `api` and `web` healthy and `worker` up.

`POSTGRES_USER` and `POSTGRES_DB` are first-boot only in the same way; changing them later needs the matching `ALTER ROLE` or `ALTER DATABASE`.

On an external database, change the password at the provider, then update `DATABASE_URL` and run `docker compose up -d`, or update the file `DATABASE_URL_FILE` names and run `docker compose restart api worker`.

## Replace the URL fallback token

`api` and `worker` each ask GitHub at boot whose token `MERGEBRIEF_URL_FALLBACK_TOKEN` is, and serve only that account. A fine-grained token carries an expiry date: replace it before that date.

1. Make the new token on the same GitHub account as the old one. A token on another account serves only that account, and the previous owner's pasted private pull requests lose the fallback.
2. Set `MERGEBRIEF_URL_FALLBACK_TOKEN` in `.env` and run `docker compose up -d`.
3. **Check:** `docker compose logs api worker | grep 'URL fallback token'` shows `URL fallback token serves its owner only` from each. A `url-fallback-token.owner.fail` line instead means GitHub refused the token ([troubleshooting.md](./troubleshooting.md#github-refused-the-url-fallback-token)).
4. Delete the old token on GitHub, under **Settings**, **Developer settings**, **Personal access tokens**.

## Rotate the model provider key

Only the worker holds the key. It reads it from the variable `generator.apiKeyEnv` names in `mergebrief.config.yaml`, or, with none named, from `ANTHROPIC_API_KEY` for `anthropic`, `OPENAI_API_KEY` for `openai` and `OPENROUTER_API_KEY` for `openrouter`. A CLI provider signs in its own way ([Subscription CLI providers](./generators.md#subscription-cli-providers)).

1. Create a new key in the provider's console. Keep the old one live.
2. Set the new key in `.env` under the same variable, then run `docker compose up -d`.
3. **Check:** `docker compose ps -a worker` shows it running, not `Exited (0)`. Then push a commit to a pull request, or click **Regenerate brief** on a failed one, and confirm the brief generates. `openrouter`, and `openai` without a `baseUrl`, check the key at boot, so a refused key stops the worker with `invalid generator configuration`; `anthropic` first uses it for a brief, where a refused key logs `provider.error` with `kind: auth`.
4. Revoke the old key in the provider's console.

## Rotate a tracker token

Only the worker reads the tracker credentials, at boot: `NOTION_TOKEN` for Notion, `JIRA_EMAIL` and `JIRA_API_TOKEN` for Jira, or the variables an entry's `tokenEnv` and `emailEnv` name ([trackers.md](./trackers.md#add-the-credentials-and-boards-to-the-instance)).

1. Create the new token: in the Notion integration's settings, or on Atlassian's API token page with only the `read:jira-work` scope ([trackers.md](./trackers.md#2-create-an-api-token-with-one-scope)). If the service replaces the old token at once, ticket reads fail until step 2 lands.
2. Set it in `.env` and run `docker compose up -d`.
3. **Check:** for Jira, `docker compose logs worker | grep jira.token.check` shows no line with `outcome: refused` ([Jira refused the token at boot](./troubleshooting.md#jira-refused-the-token-at-boot)). For either, push to a pull request whose title names a ticket and confirm its brief reads it ([Check that a ticket is read](./trackers.md#check-that-a-ticket-is-read)).
4. Revoke the old token in Notion or Atlassian.

## Rotate an OTLP header credential

A tracing backend's key belongs in a collector or agent beside the stack, as the [observability recipes](./observability.md#wire-your-stack) set up. There, rotate it in the collector's own file, such as `.env.otelcol`, and recreate that service:

```sh
docker compose up -d otel-collector
```

If `api` and `worker` send the credential themselves in `OTEL_EXPORTER_OTLP_HEADERS` or `OTEL_EXPORTER_OTLP_TRACES_HEADERS`:

1. Create the new credential at the backend, keeping the old one live.
2. Set the header value in `.env` (`key=value`, the value percent-encoded), then run `docker compose up -d`.
3. **Check:** `docker compose logs api worker | grep 'tracing on'` shows a line from each, then push a commit and find its new traces in the backend. A malformed header refuses boot while an endpoint is set.
4. Revoke the old credential at the backend.

## How GitHub tokens are stored

The only secret MergeBrief stores is each signed-in user's GitHub access and refresh token pair, on its `github_grant` row. Session cookies and API tokens are stored as SHA-256 hashes, so a database copy cannot replay them, and no other column is encrypted.

The pair is encrypted with AES-256-GCM under the key in a `SESSION_KEY_*` variable, with a fresh random IV for every token. The row's `key_ref` column names that variable. Each ciphertext is also bound to its grant row's id, its column and its `key_ref`, so a ciphertext copied into another row or column, or relabelled with another `key_ref`, no longer decrypts.

`SESSION_KEY_REF` names the variable new tokens are sealed under, `SESSION_KEY_V1` by default. It holds a name, never a key: a value that is not a variable name refuses boot ([configuration.md](./configuration.md#github-app-and-sign-in)).

A token the key cannot open fails the same way whatever the cause ([If the session key changed or was lost](#if-the-session-key-changed-or-was-lost)). If user A's encrypted token is copied into user B's row, B's GitHub-backed requests answer 500 and A's token is never sent.

The binding stops ciphertext moving between rows. It does not stop someone who can write to the database from inserting a session or API token row, or repointing an existing one, at user A's grant: that row then acts as A. Guard database write access as closely as the key.
