# Upgrade and roll back

An upgrade replaces `docker-compose.yml` with the new release's file, pulls that release's image and recreates `api`, `web` and `worker`. The new `api` applies the release's database migrations before it listens, so there is no separate migrate step unless your database role cannot change the schema.

The commands below move an instance from 1.4.0 to 1.6.0. Replace `v1.6.0` with the release you are moving to; its GitHub Release page prints the same commands with its tag filled in. Run every command in the folder that holds `docker-compose.yml` and `.env` ([What the host holds](./compose.md#what-the-host-holds)).

Pick the path for your database: [bundled](#upgrade-on-the-bundled-database), [external](#upgrade-on-an-external-database), or [a restricted role](#upgrade-with-a-restricted-database-role) under `MERGEBRIEF_AUTO_MIGRATE=false`. To go back, see [Roll back](#roll-back).

## Before you upgrade

1. **Read the notes of every release between yours and the target**, not only the newest ([Check the version you run](#check-the-version-you-run)). Each GitHub Release body opens with the upgrade commands for that release.
2. **Check whether any release in the gap is breaking.** The notice says an extra step is needed. From a terminal signed in to the instance, `mergebrief auth status --json | jq .server.breaking` prints `true` when a release in the gap is breaking and `false` when none is; `null` means the instance is up to date or its [update check](#turn-off-or-mirror-the-update-check) has not answered. A breaking release's notes list extra steps; do them in order, on top of the upgrade ([Breaking releases](#breaking-releases)).
3. **Skim [`docs/api-changelog.md`](../api-changelog.md)** if anything scripts against `/api/*` or the log's `evt` names.
4. **Check `mergebrief.config.yaml` against the new release.** Config is never migrated for you, and an unknown key refuses boot ([configuration.md](./configuration.md#instance-config-mergebriefconfigyaml)).

## Upgrade on the bundled database

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
  && curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/download/v1.6.0/docker-compose.yml \
  && docker compose pull api web worker \
  && docker compose stop api web worker \
  && docker compose up -d --wait
```

The chain stops at the first line that fails, with the old release still serving until the `stop` line:

1. **Back up.** The first two lines dump the database and check the archive opens. Keep the file until the new release has run for a while: it is the only way back across more than one release ([Roll back](#roll-back)).
2. **Fetch the release's compose file.** It replaces yours and pins that release's exact image. Your own edits live in `docker-compose.override.yml`, which the upgrade never touches. `.env` stays as it is.
3. **Pull.** `pull` fetches the new image for the three app services only, so the `postgres:17-alpine` image is left alone. A failed download stops the chain with nothing down.
4. **Stop, then start.** `stop` takes `api`, `web` and `worker` down together, so no old `worker` runs while the new `api` migrates. `up` leaves `postgres` running, starts the three, and `--wait` returns once `api` and `web` report healthy. `api` applies the migrations before it reports healthy; a long migration keeps `--wait` waiting for up to 5 minutes.

**Check:**

```sh
docker compose ps -a
docker compose exec api printenv SERVER_VERSION
docker compose logs api | grep db.version.upgrade
```

Every service is up, `api` and `web` read `healthy`, the version reads `1.6.0`, and the log has one `db.version.upgrade` line with `from` and `to`. The version notice disappears once the instance runs the newest release.

If `up` ends with `dependency failed to start` instead, the last line of `docker compose logs api` names what the api refused. A release that needs a new `.env` key lands here: see [A new required env key](#a-new-required-env-key).

## Upgrade on an external database

Under `MERGEBRIEF_AUTO_MIGRATE=false`, use [the next section](#upgrade-with-a-restricted-database-role) instead: this chain would start a release that exits until someone applies its migrations.

1. **Back up.** Take your provider's snapshot, or a dump ([Back up an external database](./backup-restore.md#back-up-an-external-database)).
2. **Upgrade.** Fetch both compose files, since the overlay belongs to the file it sits on, then pull, stop and start:

   ```sh
   curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/download/v1.6.0/docker-compose.yml \
     && curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/download/v1.6.0/docker-compose.external-db.yml \
     && docker compose pull api web worker \
     && docker compose stop api web worker \
     && docker compose up -d --wait
   ```

3. **Check** as for [the bundled database](#upgrade-on-the-bundled-database), without the `instance_version` query.

On a server set up by the [server guide](./server-deployment.md#9-upgrade-to-a-new-release), run these from a root shell, as that section says.

## Upgrade with a restricted database role

With `MERGEBRIEF_AUTO_MIGRATE=false`, `api` and `worker` never change the schema. At boot they compare the release's migrations with the database and exit 1 when it is behind, naming the pending count and the command that applies them. You apply them with a DSN whose role can run DDL, which should exist only for that one command.

1. **Back up**, as above.
2. **Fetch and pull.** Nothing stops yet, so a registry failure leaves the old release serving:

   ```sh
   curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/download/v1.6.0/docker-compose.yml \
     && curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/download/v1.6.0/docker-compose.external-db.yml \
     && docker compose pull api web worker
   ```

3. **Write the DDL DSN to a file**, `secrets/database-url.ddl`, with an editor so it stays out of your shell history. The command runs inside the `api` container, so an `sslrootcert` path in it is the container's path, not the host's.
4. **Migrate, delete the file, then start.** Run this only once step 2 ended without an error:

   ```sh
   DATABASE_URL_FILE= DATABASE_URL="$(cat secrets/database-url.ddl)" docker compose run --rm api migrate; migrated=$?
   rm secrets/database-url.ddl
   test "$migrated" -eq 0 && docker compose up -d --wait
   ```

   `DATABASE_URL_FILE` is blanked on that line because the file wins over the variable. `migrate` applies the app schema and the job queue's `graphile_worker` schema in one run. The file is deleted whether it succeeded or not, and `up` runs only when it succeeded, so a failed migrate leaves the old release serving. An interrupted run skips the delete: check that `secrets/database-url.ddl` is gone.

5. **Check** as for [the bundled database](#upgrade-on-the-bundled-database).

The services keep reading the runtime DSN from `secrets/database-url` throughout. The boot check covers the app schema only. The queue schema needs DDL whenever it is behind, and under a restricted role that surfaces as a permission error rather than a named refusal, so run `migrate` before the first start against a new database, and again whenever release notes say the bundled graphile-worker version moved.

## Roll back

A rollback runs an earlier release again. There is no down migration: one release back works because every release keeps the previous one working against its schema ([How migrations run](#how-migrations-run)). On an external database, fetch that release's `docker-compose.external-db.yml` beside the compose file in each step.

### One release back

`vX.Y.Z` is the release you are going back to:

```sh
curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/download/vX.Y.Z/docker-compose.yml \
  && docker compose up -d --wait
```

Rows the newer release wrote stay in the database and are picked up again when you upgrade. Expect one `db.version.ahead` warning from `api` or `worker`, or one from each, naming both versions. They keep running; the line records that a rollback happened.

**Check:** `docker compose exec api printenv SERVER_VERSION` prints `X.Y.Z`.

### Further back, or across a breaking release

Going back two or more releases, or past a breaking release, needs the dump you took before the first upgrade you are undoing. Anything written since that dump is lost.

1. Fetch the compose file of the release you are going back to, as above, without starting it. It goes first, so the restore starts the older release and not the newer one, which would migrate the dump forward again.
2. Restore the dump ([Restore in place](./backup-restore.md#restore-in-place)). On an external database, restore the provider's snapshot instead, then run `docker compose up -d --wait`.

An orchestrator rolls back to the previous task definition, which names the previous image tag. It needs a restore only in the case above.

## Breaking releases

A breaking release needs more than the upgrade: a new required or removed env key, a new Postgres major in the shipped compose file, a suspended expand-and-contract rule, or a manual data step. Its notes say which and list the steps. Any release still upgrades to the newest in one stop-and-start; the extra steps of every breaking release in the gap apply on top, in order.

### A new required env key

`api` refuses to boot and names the missing key as the last line of `docker compose logs api`. Add the key to `.env`, using the release's `env.example` asset for its shape, then:

```sh
docker compose up -d --wait
```

### Renamed and removed variables

A variable an older release read and a newer one renamed or moved into `mergebrief.config.yaml` refuses boot, or logs a warning, naming its replacement. Remove it from `.env`, set the replacement, then apply both files: `docker compose up -d`, then `docker compose restart api worker` ([Apply a change](./configuration.md#apply-a-change)).

| Variable | What happens | Replace it with |
| --- | --- | --- |
| `GENERATOR_API_KEY_ENV` | Set at all, even empty, the worker refuses boot. | `generator.apiKeyEnv` |
| `REVISION_NARRATIVE_ENABLED`, `HUGE_SPAN_RATIO` | Set and not empty, the worker refuses boot. | `generator.revisionNarrative`, `generator.hugeSpanRatio` |
| `AUDIT_RETENTION_DAYS`, `PR_RETENTION_DAYS` | Set and not empty, the worker refuses boot. | `retention.auditDays`, `retention.pullRequestDays` |
| `AUDIT_PRIVATE_WRITES` | Set at all, even empty, the api refuses boot: an empty value used to read as `false`. | `audit.privateWrites` |
| `MERGEBRIEF_UPDATE_CHECK`, `MERGEBRIEF_UPDATE_CHECK_URL` | Set and not empty, the api refuses boot. | `updateCheck.enabled`, `updateCheck.url` |
| `MERGEBRIEF_ATTACHMENT_QUOTA_FILES`, `MERGEBRIEF_ATTACHMENT_QUOTA_MB`, `MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES`, `MERGEBRIEF_MEDIA_MAX_MB` | Set and not empty, the api refuses boot. | The `attachments` block |
| `MERGEBRIEF_URL_BOX_TOKEN` | Set and not empty, `api` and `worker` log one warning and ignore it. | `MERGEBRIEF_URL_FALLBACK_TOKEN` |
| `MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS` | Set and not empty, `api` and `worker` log one warning and ignore it. | Nothing: removed |

Every key's format is in [configuration.md](./configuration.md#instance-config-mergebriefconfigyaml).

### A new Postgres major

The shipped compose file pins the Postgres major, 17 today. It moves only in a MergeBrief major release, flagged breaking. A new major cannot open an older major's data directory, so the data moves through a dump.

1. **Find the volume.** Its name starts with the compose project name, which is the folder's name by default:

   ```sh
   docker volume ls --filter name=postgres_data
   ```

2. **Dump with the old compose file still in place**, and check that the archive opens:

   ```sh
   DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \
     && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
     && echo "dump ok: $DUMP"
   ```

3. **Only after it prints `dump ok`, in the same shell, replace the data.** `vX.Y.Z` is the breaking release, and `mergebrief_postgres_data` is the name step 1 printed. The first line refuses a missing or empty dump:

   > [!WARNING]
   > `docker volume rm` deletes the old data. Only the dump from step 2 brings it back.

   ```sh
   test -s "${DUMP:-}" \
     && curl -fsSLo docker-compose.next.yml https://github.com/idan91/mergebrief/releases/download/vX.Y.Z/docker-compose.yml \
     && docker compose down \
     && docker volume rm mergebrief_postgres_data \
     && mv docker-compose.next.yml docker-compose.yml \
     && docker compose up -d --wait postgres \
     && docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$DUMP" \
     && docker compose up -d --wait
   ```

4. **Check** with [Check a restore](./backup-restore.md#check-a-restore).

On an external database, use the provider's major-version upgrade instead. The supported floor is Postgres 16.

## Learn that a release exists

- **The version notice.** Every signed-in user sees a band under the header on Home and on the brief page: "MergeBrief 1.6.0 is available. This instance runs 1.4.0." with a **Release notes** link. When a release between yours and the newest is a [breaking release](#breaking-releases), the band adds "This upgrade needs an extra step; the release notes say which."
- **Dismissing it is per user, per release.** The band goes away for you; a dot on your avatar and a "MergeBrief 1.6.0 is available" row in the account menu, above Settings, stay until the instance runs that release. The dot clears the first time you open the menu. A newer release brings the band back.
- **A security release cannot be dismissed.** The band turns amber with a warning icon, leads with "MergeBrief 1.6.0 fixes a security issue.", and stays until the instance runs the fixing release or newer.
- **The api log.** One `update.available` line when a newer release first appears, and once after each boot while the instance is behind: `info`, or `warn` when a release in the gap fixes a vulnerability. Alert on the `warn` ([observability.md](./observability.md#event-vocabulary)).
- **`mergebrief auth status`** shows the server's version beside the newest release it knows of ([cli.md](../use/cli.md#versions)).
- **GitHub.** On the repository page, **Watch**, then **Custom**, then **Releases** emails you on every release. A feed reader can follow `https://github.com/idan91/mergebrief/releases.atom`.

All but the last come from [the update check](#turn-off-or-mirror-the-update-check). With it off, only GitHub tells you.

## Check the version you run

```sh
docker compose ps --format 'table {{.Service}}\t{{.Image}}'
docker compose exec api printenv SERVER_VERSION
```

The first lists the image each running container started from, such as `ghcr.io/idan91/mergebrief:1.4.0`. The second prints the version the api reports, such as `1.4.0`. A source build prints `dev`.

On the bundled database, this prints the version that last booted against the data:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select version from instance_version"'
```

## Turn off or mirror the update check

The api fetches one file, `version.json`, from this project's GitHub Releases at most once an hour. It drives the version notice, the `update.available` log line and the `latest` fields of `GET /api/version`. To turn it off, or fetch the file from a mirror on a network that blocks github.com, set this in `mergebrief.config.yaml`:

```yaml
updateCheck:
  enabled: false
  # or keep it on and fetch from your mirror:
  # url: https://mirror.example.com/version.json
```

Then restart the api, which reads the block at boot ([Apply a change](./configuration.md#apply-a-change)):

```sh
docker compose restart api
```

**Check:** with the check off, `/api/version` carries `version` alone, with no `latest`. A failing check logs `update.check.fail` ([troubleshooting.md](./troubleshooting.md#the-update-check-fails)). Both keys are in [configuration.md](./configuration.md#updatecheck).

## Reference

### How migrations run

`api` and `worker` both apply the release's migrations at boot: the app schema first, then the `graphile_worker` job queue schema. `api` does it before it listens, `worker` before it claims a job. `web` holds no database. The app schema's migrations are recorded in `drizzle.__drizzle_migrations`, so a process that starts against an up-to-date database does nothing.

- **Whoever starts first migrates.** One Postgres advisory lock covers both steps in both services and in `migrate`, so one process applies and the others wait, then find nothing left. A process waiting past 5 minutes exits 1, after a `migration lock:` warning every 30 seconds.
- **It records the version.** The process that applies the migrations writes its version to the one-row `instance_version` table and logs `db.version.upgrade` with `from` and `to` when it moves forward. A check-only boot under `MERGEBRIEF_AUTO_MIGRATE=false` writes nothing.
- **A failed migration stops the boot.** `api` exits before it listens and `worker` refuses to start, each naming the error in its log. Neither serves against a half-migrated schema.
- **Release N-1 keeps working beside release N.** A schema change that drops, renames or tightens is split across two releases: an expand step that adds, copies or widens, then a contract step in the next release that drops, rewrites or tightens. So the old containers that serve for a few seconds during an upgrade keep working, and one release back needs no restore. The same promise covers the job payloads and the HTTP contract between `web` and `api`.
- **Stop-and-start jumps any distance; a rolling deploy goes one release at a time.** The upgrade above stops the old containers before starting the new ones, so it can go from 1.2.0 to 1.6.0 directly, applying each release's migrations in order in one boot. A rolling deploy, where old and new containers serve side by side, is promised only for N-1 beside N, so it takes each release in turn.

### What the update check sends

About a minute after it starts, then at most once an hour when a signed-in read of `/api/version` finds the last attempt older than an hour, the api fetches `version.json`. The read never waits on GitHub: it answers from the last snapshot while the fetch runs behind it. The browser asks every minute while a page is visible, so a new release shows within about an hour of its publication; that polled read logs its `api.access` line at `debug`.

The request carries nothing about your instance: no id, no version, no counts, a default User-Agent. GitHub sees the IP address and the time, as for any download. A `dev` build never checks. With more than one api, each replica fetches on its own schedule ([Run more than one api](./data-and-scaling.md#run-more-than-one-api)).
