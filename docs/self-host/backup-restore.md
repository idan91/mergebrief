# Back up and restore

Postgres is the only stateful part of an instance. Back up the database and the files that unlock it, keep both off the host, and test a restore before you need one.

Run every command in the folder that holds `docker-compose.yml` and `.env` ([What the host holds](./compose.md#what-the-host-holds)).

## What to back up

- **The database.** Every pull request, brief, delta, reviewer session and draft, API token, stored GitHub token and audit row ([What a dump holds](#what-a-dump-holds)).
- **The instance's files.** `.env`, `mergebrief.config.yaml`, and if you have them, `docker-compose.override.yml`, the `secrets/` folder and the App's private key file. Keep them in a password manager or an encrypted store. `.env` holds `SESSION_KEY_V1` and any later session key: a restored database needs the same keys to open the GitHub tokens it stores.

A copy of the `postgres_data` volume's files taken while Postgres runs is not a consistent backup, and neither is a VM disk snapshot alone. Use `pg_dump`.

## Back up the bundled database

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
  && echo "dump ok: $DUMP"
```

`--format=custom` is compressed, and `pg_restore` can restore it selectively. `pg_restore --list` reads only the archive's table of contents, so it proves the file opens; the `pg_dump` exit code proves the dump completed.

**Check:** the chain prints `dump ok` and the file name. Then copy the file off the host, for example to your own computer:

```sh
scp <user>@<host>:<instance-folder>/mergebrief-*.dump .
```

## Back up an external database

Turn on your provider's snapshots or point-in-time recovery; they are the first line of backup. A dump adds a copy outside the provider and is how you move to another database.

The dump runs `pg_dump` from the `postgres:17-alpine` image, which reads Postgres 16 and 17 servers. It reads the connection string from `secrets/database-url`, the file the [cloud guide](./cloud-deployment.md#store-the-connection-string) creates, so the password never reaches your shell history or the command line. On a VM set up by the cloud guide, run it from a root shell (`sudo -s`): `sudo` in front of the line would drop the `DATABASE_URL` it sets.

With a provider whose certificate chains to a public root, such as Neon:

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
DATABASE_URL="$(cat secrets/database-url)" docker run --rm -e DATABASE_URL -e PGSSLROOTCERT=system \
    postgres:17-alpine sh -c 'pg_dump --format=custom "$DATABASE_URL"' > "$DUMP" \
  && docker run --rm -i postgres:17-alpine pg_restore --list < "$DUMP" > /dev/null \
  && echo "dump ok: $DUMP"
```

With a provider CA mounted for the services, such as Supabase or RDS, mount it at the same path, so the `sslrootcert` in the connection string resolves:

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
DATABASE_URL="$(cat secrets/database-url)" docker run --rm -e DATABASE_URL \
    -v "$PWD/secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro" \
    postgres:17-alpine sh -c 'pg_dump --format=custom "$DATABASE_URL"' > "$DUMP" \
  && docker run --rm -i postgres:17-alpine pg_restore --list < "$DUMP" > /dev/null \
  && echo "dump ok: $DUMP"
```

`sslmode=verify-full` makes `pg_dump` verify the server's certificate. Without `PGSSLROOTCERT=system` or a mounted CA it fails with `root certificate file "/root/.postgresql/root.crt" does not exist`.

**Check:** the chain prints `dump ok`. Copy the file off the host.

## Schedule backups

Save this as `backup.sh` in the instance folder. It dumps the bundled database into `backups/`, deletes a dump that does not open, and keeps 14 days:

```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p backups
dump="backups/mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump"
if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$dump" \
  || ! docker compose exec -T postgres pg_restore --list < "$dump" > /dev/null; then
  rm -f "$dump"
  exit 1
fi
find backups -name 'mergebrief-*.dump' -mtime +14 -delete
# Copy "$dump" off this host here, with your backup tool.
```

On an external database, replace the `if` condition's two commands with the `docker run` pair from [Back up an external database](#back-up-an-external-database), writing to `"$dump"`.

```sh
chmod 700 backup.sh
sudo ./backup.sh && ls -l backups
```

**Check:** `backups/` holds one new `.dump` file.

Then run it daily, with a systemd timer or cron. `/opt/mergebrief` below is a placeholder: use the instance folder's path, which `pwd` prints.

**systemd timer:**

```sh
sudo tee /etc/systemd/system/mergebrief-backup.service > /dev/null <<'EOF'
[Unit]
Description=MergeBrief database backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/mergebrief/backup.sh
EOF
sudo tee /etc/systemd/system/mergebrief-backup.timer > /dev/null <<'EOF'
[Unit]
Description=Daily MergeBrief database backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now mergebrief-backup.timer
```

**Check:** `systemctl list-timers mergebrief-backup.timer` shows the next run. `sudo systemctl start mergebrief-backup.service` runs it now; `journalctl -u mergebrief-backup.service` shows a failure.

**cron:** add this line with `sudo crontab -e`:

```text
15 3 * * * /opt/mergebrief/backup.sh >> /var/log/mergebrief-backup.log 2>&1
```

**Check:** the next morning, `backups/` holds a new dump and the log holds no error.

## Restore in place

Restore a dump into the same instance, for example after a bad upgrade. Anything written since the dump is lost. To go back to an older release at the same time, fetch that release's `docker-compose.yml` first ([Roll back](./upgrade.md#further-back-or-across-a-breaking-release)).

### On the bundled database

1. **Find the volume.** Its name starts with the compose project name, which is the folder's name by default:

   ```sh
   docker volume ls --filter name=postgres_data
   ```

2. **Replace the data.** Set `DUMP` to the file, and use the volume name step 1 printed:

   > [!WARNING]
   > `docker volume rm` deletes the database. Only the dump brings it back. Check that `pg_restore --list` opens the file before you run this.

   ```sh
   DUMP=mergebrief-20260803T091500Z.dump
   test -s "$DUMP" \
     && docker compose down \
     && docker volume rm mergebrief_postgres_data \
     && docker compose up -d --wait postgres \
     && docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$DUMP" \
     && docker compose up -d --wait
   ```

   `postgres` starts alone, so no `api` or `worker` migrates or drains jobs against a half-restored database. `--wait` holds the restore until Postgres accepts connections.

3. **Check** with [Check a restore](#check-a-restore).

### On an external database

Restore the provider's snapshot or point-in-time copy with the provider's tools, then point the instance at it if its address changed, and run `docker compose up -d --wait`. To restore a dump instead, restore it into a new, empty database as in [Move to an external database](#move-to-an-external-database), steps 4 to 6.

## Restore to a new host

1. **On the old host, note the version, then stop the app** so nothing is written after the dump:

   ```sh
   docker compose exec api printenv SERVER_VERSION
   docker compose stop api web worker
   ```

2. **Dump the bundled database** ([Back up the bundled database](#back-up-the-bundled-database)). On an external database the data stays where it is: skip the dump and the restore below, and keep the old stack stopped, since two stacks on one database would take the same jobs.
3. **Copy the files to the new host:** the dump, `.env`, `mergebrief.config.yaml`, and if you have them `docker-compose.override.yml`, `secrets/` and the private key file. On the new host, run `chmod 600 .env`.
4. **Fetch the same release's files** into that folder, with the version from step 1. On an external database, fetch `docker-compose.external-db.yml` too:

   ```sh
   curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/download/vX.Y.Z/docker-compose.yml
   ```

5. **Restore and start:**

   ```sh
   DUMP=mergebrief-20260803T091500Z.dump
   test -s "$DUMP" \
     && docker compose up -d --wait postgres \
     && docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$DUMP" \
     && docker compose up -d --wait
   ```

   On an external database, run only the last line.

6. **Move the address.** Keeping the hostname: point its DNS record at the new host, and set up the reverse proxy there ([Terminate TLS](./compose.md#2-terminate-tls-at-a-reverse-proxy)). Changing it: set the new origin as `PUBLIC_BASE_URL` in `.env`, change the App's **Homepage URL**, **Callback URL** and **Webhook URL** to match ([github-app.md](./github-app.md#set-the-callback-url-and-sign-in-options)), then run `docker compose up -d`.
7. **Check** with [Check a restore](#check-a-restore), then redeliver a webhook and sign in ([Check the App](./github-app.md#check-the-app)).
8. **Make it last:** [start on boot](./compose.md#start-on-boot) and [schedule backups](#schedule-backups) on the new host.

Keep the old host stopped. Once the new host passes its checks, remove the old one's containers and data with `docker compose down --volumes --rmi all` there, then delete its copies of `.env` and the other files. Leave the App, its installations and the attachment branches alone: they now serve the new host, so the rest of [Uninstall](./uninstall.md) does not apply.

## Move to an external database

This moves a running instance's data from the bundled Postgres to a managed one. To start over on an empty database instead, the [cloud guide](./cloud-deployment.md#moving-an-existing-h1-server-to-an-external-database) has the shorter path.

1. **Fetch the overlay for the release you run.** `grep` prints the pinned version; `1.4.0` is `v1.4.0` in the URL:

   ```sh
   grep 'image: ghcr.io/idan91/mergebrief' docker-compose.yml
   curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/download/v1.4.0/docker-compose.external-db.yml
   ```

2. **Stop the app and dump** ([Back up the bundled database](#back-up-the-bundled-database)):

   ```sh
   docker compose stop api web worker
   ```

3. **Stop the bundled database** before you change `.env`. Leave out `-v`, which would delete the volume:

   ```sh
   docker compose down
   ```

4. **Create the external database and store its connection string.** Follow your provider's steps in the [cloud guide](./cloud-deployment.md#5b-external-database-h2-e2-or-e3), then steps 1 to 4 of [Store the connection string](./cloud-deployment.md#store-the-connection-string). Do not start the stack yet: the restore needs an empty database.
5. **Restore into it.** `--no-owner --no-privileges` gives every object to the role in the connection string, since the bundled database's `mergebrief` role does not exist there. With a provider CA, add the `-v` mount from [Back up an external database](#back-up-an-external-database) and drop `-e PGSSLROOTCERT=system`:

   ```sh
   DUMP=mergebrief-20260803T091500Z.dump
   DATABASE_URL="$(cat secrets/database-url)" docker run --rm -i -e DATABASE_URL -e PGSSLROOTCERT=system \
     postgres:17-alpine sh -c 'pg_restore --no-owner --no-privileges -d "$DATABASE_URL"' < "$DUMP"
   ```

   It exits 0 when every object restored.

6. **Start:**

   ```sh
   docker compose up -d --wait
   ```

7. **Check** with [Check a restore](#check-a-restore).

The old `postgres_data` volume stays on the host, unused. Keep it until you trust the new database.

## Check a restore

On the bundled database:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from pull_request" -c "select count(*) from brief" -c "select version from instance_version"'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/readyz
```

On an external database, run the same queries through `psql` in `postgres:17-alpine`, as the dump does:

```sh
DATABASE_URL="$(cat secrets/database-url)" docker run --rm -e DATABASE_URL -e PGSSLROOTCERT=system \
  postgres:17-alpine sh -c 'psql "$DATABASE_URL" -c "select count(*) from pull_request" -c "select count(*) from brief"'
```

The counts match what you expect, and `/readyz` prints `200`: the web tier answers 200 only when the api's own readiness check reaches the database. Then open a pull request you know had a brief and confirm it renders.

## What a dump holds

A dump holds every pull request, brief, delta, comparison mark, revision narrative, disposition, reviewer session, draft comment, API token, stored GitHub token and audit row: everything a reviewer can see in the web app. Session cookies and API tokens are stored as hashes; GitHub tokens are encrypted under the session key in `.env` ([How GitHub tokens are stored](./secrets.md#how-github-tokens-are-stored)). Treat a dump like `.env`: together they open every user's GitHub tokens.

It does not hold `.env`, `mergebrief.config.yaml` or any other host file.

A dump carries the schema of the release that took it. Restoring it under the same or a newer release works: the services migrate it forward at boot. Restoring it under an older release is a rollback, safe one release back only ([Roll back](./upgrade.md#roll-back)).
