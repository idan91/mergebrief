# Rotate secrets

Every secret lives in `.env`, or in a file a `.env` variable names, and `api` and `worker` read it once, at boot. How a change takes effect depends on where the secret sits:

- **A value in `.env`:** run `docker compose up -d`. It recreates each service whose environment changed. `docker compose restart` keeps the old environment, so it does not pick up the change.
- **A file**, such as the one `GITHUB_APP_PRIVATE_KEY_PATH` or `DATABASE_URL_FILE` names: compose cannot see a file's contents change, so run `docker compose restart api worker`.

`web` holds none of these secrets and never needs a restart for them. Run every command in the folder that holds `docker-compose.yml` and `.env`.

If an account or a MergeBrief API token leaks, rather than an instance secret, follow [If an account or token leaks](./security-model.md#if-an-account-or-token-leaks).

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

   On an external database, run the same query through `psql` in `postgres:17-alpine`, as [Check a restore](./backup-restore.md#check-a-restore) does.

4. **Remove `SESSION_KEY_V1`** from `.env` once the count is 0, then run `docker compose up -d`.

**Check:** sign in from a private window. Removing a key while the count is above 0 makes every request of those users that needs GitHub answer 500, with `token.decrypt.fail` in the api log, until you set it back. Nobody is signed out.

### If the session key changed or was lost

Changing `SESSION_KEY_V1` in place, or losing it, breaks every stored token sealed under that name:

- Every request from those users that needs GitHub answers 500, and the api logs `token.decrypt.fail`. Their sessions and API tokens stay valid; only the GitHub side fails.
- Generating a pasted pull request for one of them fails until they sign in again.
- The worker's hourly sweep cannot revoke their tokens at GitHub. It logs `grant.revoke.fail` with `code: credential-unreadable` and deletes the stored token anyway; GitHub expires it on its own.

Put the old value back and run `docker compose up -d`. If the old value is gone, each user recovers by signing out and in again, which seals a new token under the current key. An API token stays bound to the sign-in it was created from, so each user also revokes their old API tokens in `/settings` and creates new ones.

## Rotate the GitHub App private key

`api` and `worker` both sign with it. GitHub accepts every private key the App holds, so the rotation has no gap.

1. On the App's settings page, under **Private keys**, choose **Generate a private key**. The old key keeps working.
2. Put the new PEM in `GITHUB_APP_PRIVATE_KEY` in `.env`, or replace the file `GITHUB_APP_PRIVATE_KEY_PATH` names.
3. Apply it: `docker compose up -d` for the inline key, `docker compose restart api worker` for a key file.
4. **Check:** push a commit to a pull request in an installed repository and confirm its brief generates. Boot reads the key but never shows it to GitHub, so a key GitHub does not accept fails only at the first call that needs the App.
5. Delete the old key on the same settings page.

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

The worker resends what failed in between, up to 20 every 15 minutes, starting within about 30 minutes ([Other webhook answers](./troubleshooting.md#other-webhook-answers)). To do it sooner, redeliver those from the **Advanced** tab. A `webhook.verify.fail` rate that stays up after the rotation means one side did not move.

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

## How GitHub tokens are stored

The only secret MergeBrief stores is each signed-in user's GitHub access and refresh token pair, on its `github_grant` row. Session cookies and API tokens are stored as SHA-256 hashes, so a database copy cannot replay them, and no other column is encrypted.

The pair is encrypted with AES-256-GCM under the key in a `SESSION_KEY_*` variable, with a fresh random IV for every token. The row's `key_ref` column names that variable. Each ciphertext is also bound to its grant row's id, its column and its `key_ref`, so a ciphertext copied into another row or column, or relabelled with another `key_ref`, no longer decrypts.

`SESSION_KEY_REF` names the variable new tokens are sealed under, `SESSION_KEY_V1` by default. It holds a name, never a key: a value that is not a variable name refuses boot ([configuration.md](./configuration.md#github-app-and-sign-in)).

One rule covers every stored token the key cannot open, whatever the cause: a key that changed or was removed, or a ciphertext moved into the wrong row, column or `key_ref`. The request that needs it answers 500, the session is kept, and the api logs `token.decrypt.fail` at `error`. An access token fails at the user's next GitHub call, a refresh token when the access token next needs one, and either keeps failing until the key matches again, the user signs out, or the session expires. If user A's encrypted token is copied into user B's row, B's GitHub-backed requests answer 500 and A's token is never sent.

The binding stops ciphertext moving between rows. It does not stop someone who can write to the database from inserting a session or API token row, or repointing an existing one, at user A's grant: that row then acts as A. Guard database write access as closely as the key.
