# Operations: upgrades, migrations, backup and restore

Everything a running instance needs after the first `docker compose up`.
Two facts carry the whole page:

- **Migrations apply themselves at boot.** There is no migrate step, no
  maintenance window, and no command to remember.
- **Postgres is the only stateful dependency.** Back it up and
  you have backed up the instance. The one exception is the local-brief
  directory, below.

## Upgrading to a new version

The examples below use an instance on 1.4.0 and a newest release of 1.6.0.

### How you learn a release exists

- **The version notice.** Every signed-in user sees a band under the header
  on Home and on the brief page: "MergeBrief 1.6.0 is available. This
  instance runs 1.4.0." with a **Release notes** link. When a release
  between yours and the newest is a [breaking release](#breaking-releases),
  the band adds "This upgrade needs an extra step; the release notes say
  which."
- **Dismissing it is per user, per release.** The band goes away for you; a
  dot on your avatar and a "MergeBrief 1.6.0 is available" row in the
  Account menu, above Settings, stay until the instance runs that release.
  The dot clears the first time you open the menu. A newer release brings
  the band back.
- **A security release cannot be dismissed.** The band turns amber with a
  warning icon, leads with "MergeBrief 1.6.0 fixes a security issue.", and
  stays until the instance runs the fixing release or newer.
- **The API log.** One `update.available` line when a newer release first
  appears, and once after each boot while the instance is behind: `info`,
  or `warn` when a release in the gap fixes a vulnerability. Alert on the
  `warn`; the fields are in
  [observability.md](./observability.md#event-vocabulary).
- **`mergebrief auth status`** shows the server's version beside the newest
  release it knows of ([cli.md](./cli.md#versions)).
- **GitHub itself.** On the repository page, **Watch**, then **Custom**,
  then **Releases** emails you on every release. Any feed reader can follow
  `https://github.com/Idan91/code-review/releases.atom`.

The first five come from [the update check](#the-update-check). Turn it off
and only GitHub tells you.

### Before you upgrade

1. Read the notes of every release between yours and the target, not only
   the newest. Each GitHub Release body opens with
   [the upgrade step](#the-upgrade-step) for that release, its tag filled
   in.
2. Check whether any release in that gap is breaking. The notice says an
   extra step is needed, and `breaking` is `true` in `GET /api/version` and
   in `mergebrief auth status --json`. A breaking release needs the extra steps its
   notes list, in order, on top of the upgrade step
   ([Breaking releases](#breaking-releases)).
3. Skim [`docs/api-changelog.md`](../api-changelog.md) if anything scripts
   against `/api/*` or against the log event names. Breaking changes are
   recorded there, keyed to the version that shipped them.
4. Check whether `mergebrief.config.yaml` gained knobs you want
   ([generators.md](./generators.md)). Config is never migrated for you,
   and unknown keys refuse boot rather than being ignored.

### The upgrade step

Run these in the folder that holds `docker-compose.yml` and `.env`
([compose.md](./compose.md#what-the-host-holds)):

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
  && curl -fsSLo docker-compose.yml https://github.com/Idan91/code-review/releases/download/v1.6.0/docker-compose.yml \
  && docker compose pull api web worker \
  && docker compose stop api web worker \
  && docker compose up -d --wait
```

1. **Back up.** The first line dumps the database ([Backup](#backup)) and
   the chain stops there if the dump fails or its archive does not open.
   Keep the file until the new release has run for a while: it is the only
   way back across more than one release. On an external database, take
   the provider's snapshot instead, then run the chain's last four lines by
   hand with `docker-compose.external-db.yml` in place of
   `docker-compose.yml` on the `curl` line, as the local filename and in the
   asset name both: that is the file `COMPOSE_FILE` in `.env` names, and
   compose never reads the default file there, so fetching the default file
   would leave the old release pinned and still exit 0. Under
   `MERGEBRIEF_AUTO_MIGRATE=false`, follow
   [External database: auto-migrate=false](#external-database-auto-migratefalse)
   instead: it applies the migrations before the new containers start,
   where this chain would stop the old release and start one that exits
   until someone migrates.
2. **Fetch the release's compose file.** It replaces yours byte for byte
   and pins that release's exact image tag. Your own edits (ports, volumes,
   limits, a config mount) live in `docker-compose.override.yml`, which
   compose merges on its own (through its `COMPOSE_FILE` entry on an
   external database) and the upgrade never touches. `.env` stays as it
   is.
3. **Pull, stop, recreate.** `pull` fetches `ghcr.io/idan91/mergebrief:1.6.0`
   for the three app services only, so the floating `postgres:17-alpine` tag
   is left alone,
   picking the image for the host's architecture, while the old release
   still serves; a failed download stops the chain with nothing down. The
   `stop` line then takes `api`, `web` and `worker` down together before
   anything new starts: `up -d` recreates services one by one, and without
   the stop an old `worker` could still run while the new `api` migrates,
   which matters when the jump spans more than one release. `up` leaves
   `postgres` running because nothing about it changed and starts the
   three; the new `api` applies the release's migrations, then listens, and
   `--wait` returns once the health checks pass.

If the release needs a new `.env` key, the `api` refuses to boot and names
the key in `docker compose logs api`. Add it (the release's `.env.example`
asset shows it) and rerun the last line.

Confirm with `mergebrief auth status`, or open `/api/version` on your
public URL in a signed-in browser: `version` reads `1.6.0`. A plain `curl`
gets a 401, because the route needs a session. The notice disappears once
the instance runs the newest release.

### What happens to the schema

Both database-owning services apply the release's migrations at boot, on
their own:

| service | when | what it applies |
|---|---|---|
| `api` | at boot, before it listens | app schema, then the graphile queue schema |
| `worker` | at boot, before it claims any job | the same two, same order |

`web` holds no database and migrates nothing. The app schema uses drizzle's
node-postgres migrator against the SQL files in
`packages/persistence/drizzle/`, recorded in the
`drizzle.__drizzle_migrations` table, so a process that starts against an
up-to-date database does nothing. Concurrent starts are safe: the migrator
takes a Postgres advisory lock, so one service applies and the other waits,
then finds nothing left to do. The `graphile_worker` schema is migrated by
graphile's own `runMigrations` and never touched by drizzle.

Whichever service applies the migrations first also records the running
version in the one-row `instance_version` table (a check-only boot under
`MERGEBRIEF_AUTO_MIGRATE=false` stays read-only and leaves the row alone),
and logs `db.version.upgrade` with `from`
and `to` when it moves forward.

Practical consequences:

- **Whoever starts first migrates.** You do not control, or need to
  control, which one it is.
- **Release N-1 keeps working beside release N.** Every release follows
  expand and contract: a schema change that drops, renames or tightens is
  split into an Expand step (adds, copies, widens) in one release and a
  Contract step (drops, rewrites, tightens) in the next. So the old
  containers that serve for a few seconds during the recreate keep working
  against the migrated schema, and one release back needs no restore
  ([Rolling back](#rolling-back)). The same promise covers the job queue
  payload and the HTTP contract between `web` and `api`.
- **Stop-and-start jumps any distance; a rolling deploy goes one release at
  a time.** The upgrade step above stops the old containers and starts the
  new ones, so it can go from 1.2.0 to 1.6.0 directly: migrations apply in
  order, 1.3.0's, then 1.4.0's, and so on, in one boot. A rolling deploy,
  where old and new containers serve side by side as an orchestrator does
  it, is promised only for N-1 beside N, so it takes each release in turn.
- **A failed migration stops the boot.** The `api` exits before it listens
  and the `worker` refuses to start, each naming the error in its
  `docker compose logs`. Neither serves against a half-migrated schema.

### External database: auto-migrate=false

Running against an external Postgres
([compose.md](./compose.md#external-postgres-managed-database)) changes
none of the above by default: boot still applies migrations, whoever
starts first. Two situations move the work to you.

**A runtime role without DDL.** Set `MERGEBRIEF_AUTO_MIGRATE=false` and
both services stop applying: they compare the release's migrations against
`drizzle.__drizzle_migrations` read-only and **exit 1 when the database is
behind**, naming the pending count. Both restart under
`restart: on-failure` and keep exiting until the migrations are applied;
meanwhile `web` answers `/api/*` with a sanitized 503 and its `/readyz`
goes red while `/healthz` stays static. Once the migrations apply, the next
restart succeeds and the web tier recovers on its own. The migrate command
is the one the refusal names, `docker compose run --rm api migrate`: the
image carries it, it applies the app schema and the `graphile_worker` queue
schema in one run, and it needs no checkout. Take the provider's snapshot,
then fetch the release's compose file and pull the images, which needs no
credential and stops at the first failure:

```sh
curl -fsSLo docker-compose.external-db.yml https://github.com/Idan91/code-review/releases/download/v1.6.0/docker-compose.external-db.yml \
  && docker compose pull api web worker
```

The `pull` sits here, before the schema moves, so a registry failure stops
the chain with the old release untouched, as in the upgrade step.

The `migrate` run needs a DSN whose role can DDL, and that credential
should exist only for the duration of the command, which is the point of
the mode: write it to `secrets/database-url.ddl` right before this block,
which reads it into the one command's environment, never into your shell
history. Run it only once the block above ended without an error.
`DATABASE_URL_FILE` is blanked on the same line because the file wins over
the variable. The file is deleted whether `migrate` succeeded or failed,
and `up` runs only when it succeeded, so a failed migrate leaves the old
release serving and no credential on disk; an interrupted migrate skips the
delete, so check the file is gone before you walk away:

```sh
DATABASE_URL_FILE= DATABASE_URL="$(cat secrets/database-url.ddl)" docker compose run --rm api migrate; migrated=$?
rm secrets/database-url.ddl
test "$migrated" -eq 0 && docker compose up -d --wait
```

The services keep reading the runtime DSN from `secrets/database-url`
throughout. The command runs inside the `api` container, so an
`sslrootcert` path in the DDL DSN is the container mount, not a host path.
The DDL DSN sits in that one-off container's environment until it exits
and `--rm` removes it; anyone who can `docker inspect` it already owns the
host.

Two caveats:

- The boot check covers the **app schema** (the drizzle ledger) only. The
  `graphile_worker` queue schema is owned and migrated by graphile-worker
  itself; at boot it no-ops read-only when current, but it needs DDL
  whenever it is not current, which under a restricted role surfaces as a
  loud permission error, not a friendly refusal. The `migrate` run above
  brings both schemas current, so run it before the first `up -d` against
  a **fresh database** and again whenever a MergeBrief upgrade bumps the
  bundled graphile-worker version; the release notes say when.
- Keep the DDL DSN out of your shell history, consistent with the rule in
  [compose.md](./compose.md) §3 about secrets on command lines: the
  `$(cat ...)` form above, a leading space with `HISTCONTROL=ignorespace`,
  or `set +o history` around the command.

**Rolling upgrades against one database.** Expand and contract already
covers old code running beside a new schema (above); nothing extra to do,
as long as the rollout takes one release at a time.

### Rolling back

A rollback runs the previous release again. There is no down migration;
what makes a rollback safe is the expand-and-contract promise above. On an
external database the compose file in every case below is
`docker-compose.external-db.yml`, in the filename and the asset name both,
as in the upgrade step.

- **One release back** is the previous release's compose file alone, no
  restore:

  ```sh
  curl -fsSLo docker-compose.yml https://github.com/Idan91/code-review/releases/download/v1.5.0/docker-compose.yml
  docker compose up -d --wait
  ```

  Rows the newer release wrote stay in the database and are picked up again
  when you re-upgrade. Expect one `db.version.ahead` warning, from whichever
  of `api` and `worker` records its version first, or one from each when
  they boot together, naming both versions: a newer release last recorded
  itself. They keep running; the warning records that a rollback happened.
- **Two or more releases back, or back across a breaking release,** is a
  restore plus the file: fetch the compose file of the release you are
  going back to, then [restore](#restore) the dump you took before the
  first upgrade you are undoing. The file goes first so the restore's last
  line starts the older release, not the newer one, which would migrate the
  dump forward again. On an external database, restore the provider's
  snapshot in place of [Restore](#restore), then `docker compose up -d
  --wait`. Anything written since the dump is lost.
- **An orchestrator** rolls back to the previous task definition, which
  names the previous image tag. It needs a restore only in the case above.

### Breaking releases

A breaking release is one whose upgrade needs more than the upgrade step: a
new required or removed env key, a Postgres major bump in the shipped
compose file, a suspended expand-and-contract rule, or a manual data step.
Its notes say which, and list the steps. Any release still upgrades to the
newest in one stop-and-start step; the extra steps of every breaking
release in the gap apply on top, in order.

**A new env key.** The `api` refuses to boot and names the missing key in
`docker compose logs api`. Add it to `.env`, using the release's
`.env.example` asset for its shape, and run `docker compose up -d --wait`
again.

**A Postgres major.** The shipped compose file pins the Postgres major (17
today). It moves only in a MergeBrief major, flagged breaking. A new
Postgres major cannot open an older major's data directory, so the data
moves through a dump. Check the volume name with `docker volume ls` first:
it carries the compose project name, which is the folder's name by
default. Then take the dump with the old compose file still in place, and
check that the archive opens before anything is dropped:

```sh
DUMP=mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$DUMP" \
  && docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null \
  && echo "dump ok: $DUMP"
```

The `&&` chain stops at the first failure, and `pg_restore --list` reads
only the archive's table of contents, so the `pg_dump` exit code is what
proves the dump complete. Only once that block prints `dump ok` does the
second one run, in the same shell, because it reads `$DUMP`; its first
link refuses a missing or empty dump file, and nothing after it runs. It
drops the old data:

```sh
test -s "${DUMP:-}" \
  && curl -fsSLo docker-compose.next.yml https://github.com/Idan91/code-review/releases/download/v2.0.0/docker-compose.yml \
  && docker compose down \
  && docker volume rm mergebrief_postgres_data \
  && mv docker-compose.next.yml docker-compose.yml \
  && docker compose up -d --wait postgres \
  && docker compose exec -T postgres \
       sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
       < "$DUMP" \
  && docker compose up -d --wait
```

The `docker volume rm` line is the destructive step: it drops the old
data, and only the dump brings it back.

The [Restore](#restore) notes apply. On an external database, use the
provider's major-version upgrade instead; the supported floor stays
Postgres 16 or newer.

## Backup

**External database?** The provider owns backup and restore — use its
point-in-time recovery / snapshot tooling instead of this section (the
`docker compose exec postgres` commands below assume the bundled service
and have nothing to exec into). The `.env`/config caveat below still
applies to you.

One database, one command:

```sh
docker compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
```

`--format=custom` is compressed and restores selectively; plain
`--format=plain` SQL also works if you would rather read the file. Run it
from a cron entry or a systemd timer and keep the dumps off the machine —
a snapshot living only on the host protects against nothing.

What that dump contains: every PR, brief, delta, comparison mark, revision
narrative, disposition, reviewer session, API token, and the audit log. In
other words, everything a reviewer can see in the web app.

What it does NOT contain:

- **`.env` and `mergebrief.config.yaml`** — your credentials and instance
  config. Keep them wherever you keep secrets; they are not in the volume.

Backing up the `postgres_data` Docker volume by copying files is NOT a
substitute: a file-level copy of a running Postgres data directory is not a
consistent snapshot. Use `pg_dump`, or stop the container first.

## Restore

Into a fresh instance (the usual case — new host, or after a bad upgrade):

```sh
docker compose down                       # stop api + web + worker + postgres
docker volume rm mergebrief_postgres_data   # DESTRUCTIVE: drops the old data
docker compose up -d --wait postgres      # recreate an empty database, WAIT for it
docker compose exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < mergebrief-20260803T091500Z.dump
docker compose up -d                      # api + web + worker; they no-op on migrations
```

Notes that matter:

- Start `postgres` ALONE for the restore. If `api` or `worker` are up they
  will migrate (and the worker will start draining jobs) against the
  database you are in the middle of replacing. `web` holds no database, but
  bring it down too so nothing serves from a half-restored one.
- `--wait` is critical: plain `up -d` returns as soon as the container
  is CREATED, several seconds before Postgres accepts connections, and the
  `pg_restore` would fail on a closed socket. `--wait` blocks until the
  service's healthcheck passes. On an older compose without `--wait`, poll
  instead: `until docker compose exec -T postgres pg_isready -q; do sleep
  1; done`.
- The dump carries the schema at the version it was taken. Restoring an
  OLDER dump into a NEWER deployment is fine: the services migrate it
  forward at boot. A newer dump under older code is the
  [rollback](#rolling-back) case, safe one release back only.
- `--clean --if-exists` makes the restore repeatable against a non-empty
  database. Against a genuinely empty one it is harmless.
- Volume names are prefixed with the compose project name, which is the
  folder's name by default. `docker volume ls` shows yours if it is not
  `mergebrief_postgres_data`.

### Verifying a restore

```sh
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) from pull_request; select count(*) from brief;"'
curl -sf localhost:3000/readyz && echo " readyz ok"
```

The API's `/readyz` runs a live `SELECT 1`, and the web tier's `/readyz`
answers 200 only when it reaches the API's. So a 200 on port 3000 means the
whole chain reached the restored database. Then open a PR you know had a
brief and confirm it renders.

## Retention (what grows, and what does not prune itself)

Briefs and their sidecars accumulate per PR revision, so the database grows
with review volume — and **nothing prunes them on a schedule.** Closing
or merging a PR records the terminal state and arms no retention window
(the `purge_after` column exists and stays null; a `retention-grace-days`
knob is designed, not built). Brief data is deleted when you remove a repo
from the installation or uninstall the App, both of which purge that
tenant's rows immediately, or when a repository admin deletes one pull
request's briefs from Home, or a reviewer deletes a pull request they
pasted themselves. That delete takes every brief and every
reviewer's session, drafts and decisions for the pull request; the purge's
audit row names the reviewer who asked for it.

The audit log is the one exception. It is append-only — nothing edits a row —
and its only removal is the retention sweep, which the worker runs once a day
across every installation. The sweep keeps everything unless you set
`AUDIT_RETENTION_DAYS` (minimum 30). Set it longer than your longest open PR:
audit has to outlive a review session, and no floor can guarantee that for you.
Nothing on the web tier can trigger the sweep — it exists only inside the
worker process.

## The audit log

Every action a credential takes is recorded — and every refusal of one. Reads
are not: they fire on every render, they already produce an `api.access` line,
and recording them would bury the actions. The consequence is worth stating
plainly: the log answers *what was done*, never *what was seen*.

A row holds ids, tokens and numbers — never a request body, never free text.
The operation is the same id the API's operation manifest lists, so a row and
a request log line join on `request_id`.

Two things to know before you write a query against it:

- **A row is filed under the installation the request acted in**, the one
  holding the repository it named. A request that names no repository, such
  as a token mint or revoke, and one whose repository sits in no installation
  the reviewer reaches, both file with a null installation and
  `source = url`.
- **A refusal that never resolved a credential is not in this table.** An
  unknown cookie, a revoked API token, an expired session: there is no actor
  to write, so nothing is recorded. Those refusals appear as
  `api.access` lines with a 401, and that is where to look for them.

Two rows name a repository rather than a pull request: `upload-attachment`
and `purge-attachments`, the App's only pushes ([attachments.md](attachments.md)),
carry `target_type = repository` and the repository's id, on a denial past
the gate as well as on success.

Three knobs, all instance environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | unset (keep forever) | How long the daily sweep keeps rows. Minimum 30. |
| `AUDIT_PRIVATE_WRITES` | `true` | Record writes that stay inside this instance. Writes that leave for GitHub, and every denial, are recorded either way — that is not configurable. |
| `AUDIT_CALLER_IP` | `false` | Populate `caller_ip`. Off by default: in a self-host deployment the credential identifies the caller better than an address does, and the address costs the most privacy of any field. |

**`caller_ip` records the WEB TIER's address, not the visitor's.** The address
comes from the serving adapter, and the API is reached through the web tier's
proxy, so the socket it sees belongs to that proxy. Expect one address for
every visitor and read the credential columns instead.

**`caller_ip` is the SOCKET address, always.** This instance does not read
`X-Forwarded-For`, because a header the client can set is not evidence, and
deciding which proxy to trust is a separate decision nobody has made here. The
web tier's proxy drops `X-Forwarded-For`, `X-Real-IP` and `Forwarded` rather
than forwarding them, so adding a reverse proxy in front changes nothing about
what lands in the column.

Erasing one person's rows is a query, not a feature:

```sh
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "delete from audit_log where actor_id = 12345;"'
```

There is no in-app reader. `psql` is the interface:

```sh
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    select occurred_at, operation, outcome, channel, client
    from audit_log
    where classification = '\''external-write'\''
    order by occurred_at desc limit 50;"'
```

If disk becomes a concern, `brief` and `delta` are the tables to look at —
they hold the generated JSON:

```sh
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as size
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '\''public'\'' and c.relkind = '\''r'\''
    order by pg_total_relation_size(c.oid) desc limit 10;"'
```

## Running more than one worker

`WORKER_COUNT=2` (or `docker compose up --scale worker=2`) starts two
runner processes against the same queue. That is safe by construction:
graphile-worker claims a job with row locking, so no two runners drain the
same job. Two jobs for one PR can overlap briefly: a newer head enqueues a
successor behind its debounce window (60s for a push, 10s for a ready flip,
a paste or an owner follow-up) while the running job's head watch, a 20s
poll that aborts the run on a newer head, stands the older run down. Up to
one poll of overlap in the normal case (longer while head reads are
failing) costs spend, never correctness, and the daily cap stays exact
because every start takes the same instance-wide advisory lock. The scheduled
`sweep-audit` still runs once per tick: each runner tries to record the
tick in graphile's `_private_known_crontabs` table, and only the runner
that advances `last_execution` enqueues the job. Each worker opens its own
connection pool, so count that against Postgres's `max_connections`.
Prefer more slots over more workers unless you want the restart isolation.

## Running more than one api

`API_COUNT=2` (or `docker compose up --scale api=2`) starts two api
containers behind the one `web`. Every replica can serve every request:
sessions, the audit log and the job queue live in Postgres, so any replica
serves any cookie; CSRF and OAuth state ride the request itself; a GitHub
token refresh is serialized on the grant row, so two replicas never spend
one single-use refresh token; boot migrations take a Postgres advisory
lock, so replicas starting together do not race, the first applies and the
rest find the schema current. The api publishes no host port, so nothing
else in the compose file changes.

What is per replica: a handful of short caches (a PR's conversation for
60 seconds, a viewer's reachable installations, GitHub access answers, diff
and file reads), the update check's snapshot and the attachment upload
quota. Three consequences. The quota is counted per replica, so two replicas
let one reviewer attach up to twice the configured limit per window. A write
evicts the cache of the replica it landed on only, so a comment or review a
reviewer just posted can be missing from the next read for up to a minute
when that read lands on another replica; a load balancer that keeps a
session on one replica (sticky on the session cookie) removes that. And
each replica fetches `version.json` on its own schedule, so with N
replicas there are N fetches an hour, N `update.available` lines per
release, and `GET /api/version` can differ between replicas for up to an
hour after a release.

How requests spread under compose alone: `web` calls `http://api:3001`,
Docker's DNS answers that name with every replica in rotating order, and
each new connection lands on the next one. Requests sent back to back
reuse one connection, so a burst stays on one replica while paused
traffic and parallel fetches spread unevenly. Measured on the shipped
file: thirty back-to-back requests through one `web` all went to one
replica, twelve fresh connections split six and six, and with that replica
exited every further request succeeded through the other, with no restart
of `web`. That is failover when a replica exits; a replica that is stuck
but still accepting connections keeps receiving them until `web`'s
upstream timeout answers 502. For an even spread and health-aware routing
put a load balancer in front of the apis (your reverse proxy can do it)
and point `MERGEBRIEF_API_ORIGIN` at it. `web` is stateless as well, a
server render plus the `/api/*` proxy, so it can be scaled the same way
behind the proxy that already terminates TLS for it.

Each api opens its own connection pool (up to ten connections), so count
replicas against Postgres's `max_connections` the way you count workers.
GitHub webhooks arrive through `web` and land on whichever replica
answers; the debounce that folds pushes into one job is a queue key in
Postgres, so it holds across replicas.

## The update check

About a minute after it starts, and then at most once an hour, when a signed-in read of `/api/version` finds the last attempt older than an hour, the API fetches one static file, `version.json`, from this project's GitHub Releases. The read itself never waits on GitHub: it answers from the last snapshot and the fetch runs behind it, so when the fetch succeeds a stale answer lasts one more read. The browser asks every minute while a page is visible and on a return to the window, so a signed-in user sees a new release within about an hour of its publication; that polled read logs its `api.access` line at `debug`, so an open tab adds nothing to the `info` log. The request carries nothing about your instance: no id, no version, no counts, a default User-Agent. GitHub sees the IP address and the time, as for any download; we see nothing, because we have no access to GitHub's logs. The check sends nothing else.

The answer drives three things: the banner every signed-in user sees when a newer version exists, one `update.available` line in the API log (`warn` when the release fixes a vulnerability), and the `latest` fields of `GET /api/version`, which `mergebrief auth status` shows.

To turn it off, set `MERGEBRIEF_UPDATE_CHECK=false`. The banner, the log line and the `latest` fields then never appear; nothing else changes. A `dev` build never checks.

If your network blocks github.com, the check fails quietly: one `update.check.fail` line at `info` on the first failure after boot, `debug` after that, and `/api/version` carries no fresh `checkedAt`.

| Variable | Default | What it does |
| --- | --- | --- |
| `MERGEBRIEF_UPDATE_CHECK` | `true` | Fetch `version.json` from GitHub Releases at most once an hour to learn about newer releases. The request identifies nothing. Off: no banner, no log line, no `latest` in `/api/version`. |
| `MERGEBRIEF_UPDATE_CHECK_URL` | `https://github.com/Idan91/code-review/releases/latest/download/version.json` | Where `version.json` is fetched from. Point it at a mirror on a network that blocks github.com. An absolute `http` or `https` URL, or boot is refused. |

## See also

- [compose.md](./compose.md) — services, environment, hardening before
  exposure (TLS, the webhook secret, Postgres credentials).
- [observability.md](./observability.md) — the log event contract, health
  endpoints, and alert recipes; `/healthz` vs `/readyz` semantics.
- [generators.md](./generators.md) — provider/model config and the daily
  generation cap.
- [attachments.md](./attachments.md) — the one push the App makes, and how
  an admin deletes it.
