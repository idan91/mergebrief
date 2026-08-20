# Operations: upgrades, migrations, backup and restore

Everything a running instance needs after the first `docker compose up`.
Two facts carry the whole page:

- **Migrations apply themselves at boot.** There is no migrate step, no
  maintenance window, and no command to remember.
- **Postgres is the only stateful dependency.** Back it up and
  you have backed up the instance. The one exception is the local-brief
  directory, below.

## Upgrading to a new version

```sh
git pull                       # or: check out the tag you want
docker compose build           # rebuild web + worker from the new source
docker compose up -d           # recreate the changed services
```

Postgres itself is a pinned upstream image (`postgres:17-alpine`) and is not
rebuilt by this; it keeps running against the same `postgres_data` volume.

### What happens to the schema

Both application services apply the checked-in migrations **idempotently,
on their own**:

| service | when | what it applies |
|---|---|---|
| `worker` | at boot, before it claims any job (`startWorker`) | app schema, then the graphile queue schema |
| `web` | lazily, when it composes the `/api` app for its first request | the same two, same order |

The app schema uses drizzle's node-postgres migrator against the SQL files
checked into `packages/persistence/drizzle/`; applied migrations are
recorded in the `drizzle.__drizzle_migrations` table, so a process that
starts against an up-to-date database does nothing. Concurrent starts are
safe: `migrateApp` takes a Postgres **advisory lock** for the duration, so
the `worker` booting while `web` handles its first webhook cannot race —
one applies, the other queues and then no-ops. The `graphile_worker` schema
is migrated by graphile's own `runMigrations` and is never touched by
drizzle.

Practical consequences:

- **Whoever starts first migrates.** You do not control (or need to
  control) which one it is.
- **There is a short window** during a rolling recreate where an old
  process is still running against a newly migrated schema. Migrations are
  written additively for exactly this reason (new columns nullable, new
  vocabulary values added by widening a CHECK constraint), so the old code
  keeps working until it exits.
- **`docker compose up -d` is the whole upgrade.** If a migration fails,
  the worker refuses to start and says so in `docker compose logs worker` —
  it does not limp into draining jobs against a half-migrated schema.

### External database: auto-migrate=false

Running against an external Postgres
([compose.md](./compose.md#external-postgres-managed-database)) changes
none of the above by default — boot still applies migrations, whoever
starts first. Two situations move the work to you:

**A runtime role without DDL.** Set `MERGEBRIEF_AUTO_MIGRATE=false` and
both services stop applying: they compare the checked-in migrations
against `drizzle.__drizzle_migrations` read-only and **refuse when the
database is behind**, naming the pending count. The refusal surfaces
asymmetrically, matching how each service composes: the **worker refuses
to start** (crash-loops until migrated); the **web tier boots and stays
"healthy"** (its `/healthz` is static) but refuses composition on the
first `/api` request — `/readyz` red, webhooks 503 — and **recovers on
its next request** once migrations apply, no restart needed. The upgrade
workflow becomes:

```sh
git pull && docker compose -f docker-compose.external-db.yml build
DATABASE_URL='postgres://ddl-capable-role:...@host/db?sslmode=verify-full&sslrootcert=/absolute/host/path/provider-ca.pem' \
  pnpm -C packages/persistence migrate
docker compose -f docker-compose.external-db.yml up -d
```

The migrate command runs from a checkout with dev dependencies installed
(`pnpm install` first on a fresh machine) and needs a DSN whose role can
DDL — that credential exists only for the duration of the command, which
is the point of the mode. Mind the `sslrootcert` path: this command runs
**on the host**, so a CA bundle mounted into the containers at
`/etc/ssl/certs/...` does not exist here — use the host location of the
same file (e.g. `$PWD/secrets/provider-ca.pem`), and make it absolute
(`-C` changes the working directory). Providers on publicly trusted CAs
need no `sslrootcert` at all.

Two caveats:

- The check covers the **app schema** (the drizzle ledger) only. The
  `graphile_worker` queue schema is owned and migrated by graphile-worker
  itself; it no-ops read-only when current, but it needs DDL whenever it
  is NOT current — which under a restricted role surfaces as a loud
  permission error, not a friendly refusal.
- That includes the **first boot against a fresh database**: the manual
  migrate command installs the app schema only, so the very first
  `up -d` still needs to create `graphile_worker`. Bootstrap once with a
  DDL-capable credential — either run the first boot with
  `DATABASE_URL` pointing at the DDL role (auto-migrate can stay
  `false`; the graphile install happens regardless), or grant the
  runtime role temporary DDL for that boot — then switch to the
  restricted DSN. Using the `DATABASE_URL_FILE` secrets flow? The file
  **wins over** `DATABASE_URL`, so for the bootstrap boot temporarily
  point the secret file at the DDL DSN (then restore it) — that keeps
  the credential out of your shell history, consistent with the rule in
  [compose.md](./compose.md) §3 about secrets on command lines. If you
  must inline it instead, blank the file variable
  (`DATABASE_URL_FILE= DATABASE_URL='<ddl-dsn>' docker compose ... up
  -d` — an empty `_FILE` is treated as unset) and keep it out of
  history: a leading space with `HISTCONTROL=ignorespace`, or `set +o
  history` around the command. The same one-off applies later when a
  MergeBrief upgrade bumps the bundled graphile-worker version.

**Rolling upgrades against one database.** Auto-migrate + additive
migrations already tolerate old-code-new-schema overlap (above); nothing
extra to do.

### Downgrades

**There is no down migration** — the migration set is forward-only by
design. Rolling back to an older image against an already-migrated database
is only safe when the newer migrations were purely additive (the usual
case), and even then it is untested. The supported rollback is: restore the
database snapshot you took before upgrading, then start the older images.
Which is the whole argument for the next section.

### Before you upgrade

1. Take a backup (below). It takes seconds and it is the only rollback.
2. Skim [`docs/api-changelog.md`](../api-changelog.md) if anything scripts
   against `/api/*` or against the log event names — breaking changes are
   recorded there, keyed to the version that shipped them.
3. Check whether `mergebrief.config.yaml` gained knobs you want
   ([generators.md](./generators.md)); config is never migrated for you,
   and unknown keys refuse boot rather than being ignored.

## Backup

**External database?** The provider owns backup and restore — use its
point-in-time recovery / snapshot tooling instead of this section (the
`docker compose exec postgres` commands below assume the bundled service
and have nothing to exec into). The `tools/categorizer/out/` and
`.env`/config caveats below still apply to you.

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

- **`tools/categorizer/out/`** — the file-backed briefs the URL box and the
  categorizer CLI produce (mounted from the host in compose). Back the
  directory up too if you use that path; it is plain JSON and can be
  re-generated at model cost.
- **`.env` and `mergebrief.config.yaml`** — your credentials and instance
  config. Keep them wherever you keep secrets; they are not in the volume.

Backing up the `postgres_data` Docker volume by copying files is NOT a
substitute: a file-level copy of a running Postgres data directory is not a
consistent snapshot. Use `pg_dump`, or stop the container first.

## Restore

Into a fresh instance (the usual case — new host, or after a bad upgrade):

```sh
docker compose down                       # stop web + worker + postgres
docker volume rm code-review_postgres_data   # DESTRUCTIVE: drops the old data
docker compose up -d --wait postgres      # recreate an empty database, WAIT for it
docker compose exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < mergebrief-20260803T091500Z.dump
docker compose up -d                      # web + worker; they no-op on migrations
```

Notes that matter:

- Start `postgres` ALONE for the restore. If `web` or `worker` are up they
  will migrate (and the worker will start draining jobs) against the
  database you are in the middle of replacing.
- `--wait` is critical: plain `up -d` returns as soon as the container
  is CREATED, several seconds before Postgres accepts connections, and the
  `pg_restore` would fail on a closed socket. `--wait` blocks until the
  service's healthcheck passes. On an older compose without `--wait`, poll
  instead: `until docker compose exec -T postgres pg_isready -q; do sleep
  1; done`.
- The dump carries the schema at the version it was taken. Restoring an
  OLDER dump into a NEWER deployment is fine — the services migrate it
  forward at boot. The reverse (a newer dump into older code) is not
  supported, per the downgrade note above.
- `--clean --if-exists` makes the restore repeatable against a non-empty
  database. Against a genuinely empty one it is harmless.
- Volume names are prefixed with the compose project name (the directory
  name by default) — `docker volume ls` shows yours if it is not
  `code-review_postgres_data`.

### Verifying a restore

```sh
docker compose exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) from pull_request; select count(*) from brief;"'
curl -sf localhost:3000/readyz && echo " readyz ok"
```

`/readyz` checks app composition plus a live `SELECT 1` — a 200 there means
the web tier reached the restored database. Then open a PR you know had a
brief and confirm it renders.

## Retention (what grows, and what does not prune itself)

Briefs and their sidecars accumulate per PR revision, so the database grows
with review volume — and **nothing prunes them on a schedule.** Closing
or merging a PR records the terminal state and arms no retention window
(the `purge_after` column exists and stays null; a `retention-grace-days`
knob is designed, not built). Brief data is deleted only when you remove a repo
from the installation or uninstall the App, both of which purge that
tenant's rows immediately.

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

- **A row is filed under the tenant of the credential that acted**, not the
  tenant of the thing it acted on. A reviewer signed into one installation can
  revoke a token belonging to another, or switch between them; the row lands
  in the acting session's installation either way.
- **A refusal that never resolved a credential is not in this table.** An
  unknown cookie, a revoked API token, an expired session — the tenant column
  cannot be null, and there is no tenant to write. Those refusals appear as
  `api.access` lines with a 401, and that is where to look for them.

Three knobs, all instance environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | unset (keep forever) | How long the daily sweep keeps rows. Minimum 30. |
| `AUDIT_PRIVATE_WRITES` | `true` | Record writes that stay inside this instance. Writes that leave for GitHub, and every denial, are recorded either way — that is not configurable. |
| `AUDIT_CALLER_IP` | `false` | Populate `caller_ip`. Off by default: in a self-host deployment the credential identifies the caller better than an address does, and the address costs the most privacy of any field. |

**`caller_ip` records nothing in the Docker deployment.** The address has to
come from the serving adapter, and the web tier's server entry does not hand
one to the API. Turning the flag on there is honest but empty; the column
fills only where the app is served by a Node adapter that exposes the socket.

**When it does record, `caller_ip` is the SOCKET address.** Behind a reverse proxy that is the
proxy's address, not the visitor's — this instance does not read
`X-Forwarded-For`, because a header the client can set is not evidence, and
deciding which proxy to trust is a separate decision nobody has made here. If
your web tier is fronted by a proxy, expect one address for everyone, and read
the credential columns instead.

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

## See also

- [compose.md](./compose.md) — services, environment, hardening before
  exposure (TLS, the webhook secret, Postgres credentials).
- [observability.md](./observability.md) — the log event contract, health
  endpoints, and alert recipes; `/healthz` vs `/readyz` semantics.
- [generators.md](./generators.md) — provider/model config and the daily
  generation cap.
