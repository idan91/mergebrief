# Operations: upgrades, migrations, backup and restore

Everything a running instance needs after the first `docker compose up`.
Two facts carry the whole page:

- **Migrations apply themselves at boot.** There is no migrate step, no
  maintenance window, and no command to remember.
- **Postgres is the only stateful dependency.** Back it up and
  you have backed up the instance.

## Upgrading to a new version

The notices below use an instance on 1.4.0 and a newest release of 1.6.0. The
commands name `v0.1.0`, the first release: replace it with the release you
are moving to.

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
  `https://github.com/Idan91/mergebrief/releases.atom`.

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
  && curl -fsSLo docker-compose.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.yml \
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
3. **Pull, stop, recreate.** `pull` fetches `ghcr.io/idan91/mergebrief:0.1.0`
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
the key in `docker compose logs api`. Add it (the release's `env.example`
asset shows it) and rerun the last line.

Confirm with `mergebrief auth status`, or open `/api/version` on your
public URL in a signed-in browser: `version` reads `0.1.0`. A plain `curl`
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
up-to-date database does nothing. The `graphile_worker` schema is migrated by
graphile's own `runMigrations` and never touched by drizzle. Concurrent starts
are safe: one Postgres advisory lock covers both steps, in both services and
in the migrate command, so one process applies and the others wait, then find
nothing left to do. A process waiting past 5 minutes exits 1, and a
`migration lock:` warning every 30 seconds says why it is still waiting.

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
curl -fsSLo docker-compose.external-db.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.external-db.yml \
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
  restore. `vX.Y.Z` is the release you are going back to:

  ```sh
  curl -fsSLo docker-compose.yml https://github.com/Idan91/mergebrief/releases/download/vX.Y.Z/docker-compose.yml
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
`env.example` asset for its shape, and run `docker compose up -d --wait`
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
drops the old data; `vX.Y.Z` is the breaking release:

```sh
test -s "${DUMP:-}" \
  && curl -fsSLo docker-compose.next.yml https://github.com/Idan91/mergebrief/releases/download/vX.Y.Z/docker-compose.yml \
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

## Starting on boot

A reboot leaves the stack down. `restart: on-failure` brings `api`, `web` and
`worker` back after a nonzero exit, not when the Docker daemon restarts, and
`postgres` has no restart policy. Do not switch to `unless-stopped`: a
configuration error exits 0 so the service stays down, and that policy would
restart it into the same error forever.

While the stack is down every webhook delivery fails. GitHub
[never retries one on its own](./troubleshooting.md#other-webhook-answers), so
the worker resends what failed, up to 20 every 15 minutes, starting within about
30 minutes of coming back. To do it sooner, redeliver one from the App's
**Advanced** tab, within 3 days.

A systemd unit runs `docker compose up` once at boot. Set `WorkingDirectory`
to the folder that holds `docker-compose.yml` and `.env`
([compose.md](./compose.md#what-the-host-holds)). Compose names the project
after that folder, so any other folder starts a second, empty stack.
`COMPOSE_FILE` in `.env` still applies, so an external database needs no
change.

```ini
# /etc/systemd/system/mergebrief.service
[Unit]
Description=MergeBrief
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/mergebrief
ExecStart=/usr/bin/docker compose up -d --wait
ExecStop=/usr/bin/docker compose stop
TimeoutStopSec=240

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable docker mergebrief
sudo reboot
```

After the reboot, run `docker compose ps -a` in that folder. Every service
should be up, and `api` and `web` should read `healthy`, along with `postgres`
on the bundled database.

- **A configuration error still stays down, and the unit may not show it.** The
  unit has no `Restart=`. `--wait` waits for the health checks on `api` and `web`,
  so an error in either shows as failed in `systemctl status mergebrief`. `worker`
  has no health check, so a `worker` that exits a moment after it starts leaves the
  unit active with webhooks still answering and no brief appearing. `docker compose
  ps -a` is the check that catches it. Go to
  [A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0).
- **`TimeoutStopSec`** covers the grace periods in `docker-compose.yml`, so
  systemd does not kill a drain at shutdown.
- **To keep an instance down across reboots**, run
  `sudo systemctl disable mergebrief`. A plain `docker compose stop` lasts only
  until the next boot.

## Backup

**External database?** The provider owns backup and restore. Use its
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
from a cron entry or a systemd timer and keep the dumps off the machine:
a snapshot living only on the host protects against nothing.

What that dump contains: every PR, brief, delta, comparison mark, revision
narrative, disposition, reviewer session, API token, and the audit log. In
other words, everything a reviewer can see in the web app.

What it does NOT contain:

- **`.env` and `mergebrief.config.yaml`**: your credentials and instance
  config. Keep them wherever you keep secrets; they are not in the volume.

Backing up the `postgres_data` Docker volume by copying files is NOT a
substitute: a file-level copy of a running Postgres data directory is not a
consistent snapshot. Use `pg_dump`, or stop the container first.

## Restore

Into a fresh instance (the usual case: new host, or after a bad upgrade):

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
with review volume, and **by default nothing prunes them.** Closing or
merging a PR records the close time and nothing else. Set
`retention.pullRequestDays` in `mergebrief.config.yaml` (minimum 1) and the
worker's daily sweep erases every
pull request closed or merged longer ago than that, across every
installation and every pasted PR, with its briefs and every reviewer's
session, drafts and decisions. The window counts from the close on GitHub,
not from the brief: the first run after you set the variable takes every
pull request already past the window, however long ago it closed, and a
pasted pull request that closed before the window is briefed and then erased
by the next sweep. One audit row per installation or owner, per batch of
500, records the count. A reopened pull request leaves the window with its
close time. Brief data is also deleted when you remove a repo from the
installation or uninstall the App, both of which purge that tenant's rows
immediately, or when a repository admin deletes one pull request's briefs
from Home, or a reviewer deletes a pull request they pasted themselves.
That delete takes the same set; the purge's audit row names the reviewer
who asked for it.

Those sessions hold text reviewers wrote, unencrypted, so a database copy
can read it. `review_draft_comment.body` stores a comment from the moment
it is drafted. Posting it to GitHub marks the row `submitted` and keeps the
text. A reviewer can delete a comment they have not posted, but a push copies
unposted comments into the new head's session, and deleting that copy leaves
the earlier session's row. Every other row goes only with its brief or
pull request, as above, so without `retention.pullRequestDays` it stays. A risk's
dismissal reason or addressing note in `disposition` follows the same rule,
and reopening the risk deletes it from that session.

The audit log is the one exception. It is append-only (nothing edits a row),
and its only removal is the retention sweep, which the worker runs once a day
across every installation. The sweep keeps everything unless you set
`retention.auditDays` (minimum 30). Set it longer than your longest open PR:
audit has to outlive a review session, and no floor can guarantee that for you.
Nothing on the web tier can trigger the sweep: it exists only inside the
worker process.

Sign-in credentials prune themselves, always on. Every hour the worker
deletes expired sessions. It then deletes each GitHub authorization that no
session and no live API token still uses, encrypted GitHub tokens included,
and asks GitHub to revoke that access token. Those revokes are
best-effort and stop after 30 seconds per sweep; a token the sweep does not
reach stays valid at GitHub until it expires, and the worker logs how many
it skipped. A revoked or expired API token
stays listed in settings as revoked for 30 days, then the same sweep deletes
the row. Signing out deletes the session at once, and revoking the App on
github.com deletes every credential that user held; neither waits for the
sweep.

## Tokens at rest

The only secret MergeBrief stores is each signed-in user's GitHub access and
refresh token pair, on its `github_grant` row. Session cookies and API tokens
are stored as SHA-256 hashes only, so a database copy cannot replay them.

The pair is encrypted with AES-256-GCM under the key held in an env var, with
a fresh random IV for every token. The row's `key_ref` column names that env
var. Each ciphertext is also bound to where it lives: its grant row's id, its
column and its `key_ref` are authenticated with it, so a ciphertext copied
into another row or column, or relabelled with another `key_ref`, no longer
decrypts.

One rule covers every stored token the session key cannot open, access or
refresh, whatever the cause: a key that changed or was removed, or a
ciphertext moved into the wrong row, column or `key_ref`. The request that
needs it answers 500, the session is kept, and the api logs
`token.decrypt.fail` at error. An access token fails at the user's next
GitHub call, a refresh token when the access token next needs a refresh, and
either keeps failing until the key matches again, the user signs out, or the
session expires. If user A's encrypted access token is copied into user B's
row, B's GitHub-backed requests answer 500 and A's token is never sent.

The binding stops ciphertext moving between rows and columns. It does not
stop someone who can write to the database from inserting a session or API
token row, or repointing an existing one, at user A's grant: that row then
acts as A. Guard database write access as closely as the key.

`SESSION_KEY_REF` names the env var new tokens are sealed under, default
`SESSION_KEY_V1`. It holds a name, never a key: a value that is not an env
var name refuses boot. Existing rows keep opening under the `key_ref` they
were sealed with. To rotate the key:

1. Generate a new key (`openssl rand -base64 32`) and set it as
   `SESSION_KEY_V2` in `.env`, keeping `SESSION_KEY_V1`.
2. Set `SESSION_KEY_REF=SESSION_KEY_V2`.
3. Run `docker compose up -d`, which recreates `api` and `worker` with the
   new `.env`; `docker compose restart` keeps the old environment. New
   sign-ins and every token refresh now seal under V2. The worker never
   seals; it opens each grant by its own `key_ref`, so it only needs both keys
   present.
4. Keep `SESSION_KEY_V1` set until this returns 0:

   ```sql
   select count(*) from github_grant where key_ref = 'SESSION_KEY_V1';
   ```

   Removing it earlier fails every user whose grant still names it with 500
   and `token.decrypt.fail` until you set it back; nobody is signed out.

## Rotating secrets

Every secret lives in `.env` (or your secret store) and is read once, at
boot. `docker compose up -d` recreates each service whose environment
changed, so it picks up a new value; `docker compose restart` keeps the old
environment. The exception is a secret read from a file, such as
`GITHUB_APP_PRIVATE_KEY_PATH` or `DATABASE_URL_FILE`: compose cannot see a
file's contents change, so after replacing the file run
`docker compose restart api worker`.

`web` holds none of these secrets and never needs a restart for them.

### The session key

The session key seals one thing: each signed-in user's GitHub access and
refresh token pair, on its `github_grant` row. Session cookies and API
tokens are stored as SHA-256 hashes, so no key touches them, and no other
column is encrypted.

Rotate it under a new name, never in place. The steps are in
[Tokens at rest](#tokens-at-rest): add `SESSION_KEY_V2`, point
`SESSION_KEY_REF` at it, recreate `api` and `worker`, and keep
`SESSION_KEY_V1` set until no grant names it. Nobody is signed out.

Changing the value of `SESSION_KEY_V1` in place, or losing it, breaks every
grant sealed under that name:

- Every request from those users that needs GitHub answers 500, and the api
  logs `token.decrypt.fail`. Their sessions and API tokens stay valid; only
  the GitHub side fails.
- Generating a pasted pull request for one of them fails until they sign in
  again.
- The worker's hourly sweep cannot revoke their tokens at GitHub. It logs
  `grant.revoke.fail` with `code: credential-unreadable` and deletes the
  grant anyway; GitHub expires the token on its own.

The fix is to put the old value back and run `docker compose up -d`. If the
old value is gone, each user recovers on their own: signing out and in again
seals a new grant under the current key. An API token stays bound to the
sign-in it was created from, so each user also revokes their old API tokens
in `/settings` and creates new ones.

### The GitHub App private key

`api` and `worker` both sign with it. GitHub accepts every private key the
App holds, so you can rotate with no gap:

1. On the App's settings page, under **Private keys**, choose
   **Generate a private key**. The old key keeps working.
2. Put the new PEM in `GITHUB_APP_PRIVATE_KEY`, or replace the file
   `GITHUB_APP_PRIVATE_KEY_PATH` names.
3. Run `docker compose up -d` (inline key) or
   `docker compose restart api worker` (key file).
4. Confirm a push to a pull request in an installed repository still
   generates its brief.
5. Delete the old key on the same settings page.

An unreadable or empty key file refuses boot, but boot never shows the key
to GitHub. A key GitHub does not accept fails at the first call that needs
the App, so step 4 is the check.

### The OAuth client secret

`api` uses `GITHUB_OAUTH_CLIENT_SECRET` to finish a sign-in, to refresh a
user's GitHub token and to revoke one; `worker` uses it to revoke the tokens
its hourly sweep removes.

1. On the App's settings page, under **Client secrets**, choose
   **Generate a new client secret**. The old one keeps working.
2. Set `GITHUB_OAUTH_CLIENT_SECRET` in `.env` and run `docker compose up -d`.
3. Sign in from a private window to confirm.
4. Delete the old secret on GitHub.

Signed-in users notice nothing. If the secret in `.env` is one GitHub no
longer accepts, every sign-in fails and the api logs
`sign-in refused: GitHub refused the App's OAuth credentials` at `error`.
Every token refresh fails too, logging `token.refresh.fail`: the request
answers 500 and the session is kept.

### The webhook secret

The App holds one webhook secret, so GitHub and MergeBrief must change
together. Deliveries GitHub sends while the two sides differ fail: the api
answers 401, logs `webhook.verify.fail` and writes nothing.

1. Generate a new secret: `openssl rand -hex 32`. Boot refuses one under 32
   characters.
2. Set it as the App's **Webhook secret** on GitHub, then at once set
   `GITHUB_WEBHOOK_SECRET` in `.env` and run `docker compose up -d`. Only
   `api` verifies deliveries, but `worker` parses the same variable, and
   both are recreated.
3. The worker resends what failed in between, up to 20 every 15 minutes, starting
   within about 30 minutes
   ([troubleshooting.md](./troubleshooting.md#other-webhook-answers)). To do it
   sooner, open **Recent Deliveries** on the App's **Advanced** tab and redeliver
   them.

A `webhook.verify.fail` rate that stays up after the rotation means one side
did not move.

### The Postgres password

The bundled `postgres` image reads `POSTGRES_PASSWORD` only when it
initializes an empty volume. After the first boot, changing `.env` alone
leaves the role's password as it was, while compose builds the `api` and
`worker` connection string from the new value, so both fail to connect.
Change the role first:

1. Generate a new password: `openssl rand -hex 24`. Use the output
   verbatim; it lands in a connection string unescaped
   ([compose.md](./compose.md#1-postgres-credentials)).
2. Stop the services that hold connections:

   ```sh
   docker compose stop web api worker
   ```

3. Set the role's password from inside the container. `\password` prompts
   twice, and keeps the value out of your shell history and the server log:

   ```sh
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   # at the psql prompt:
   \password
   \q
   ```

4. Set `POSTGRES_PASSWORD` in `.env` to the same value. If `.env` also
   carries a host `DATABASE_URL` for the bundled database
   (`postgres://code_review:...@127.0.0.1:5432/...`, used by a host dev loop
   or host tooling), update its password too.
5. Run `docker compose up -d`. Compose recreates `postgres` with the new
   environment, which the image ignores, and `api` and `worker` with the
   connection string derived from it. The data stays in the volume.

`POSTGRES_USER` and `POSTGRES_DB` are first-boot only in the same way;
changing them later needs the matching `ALTER ROLE` or `ALTER DATABASE`, and
is rarely worth it.

On an external database, change the password at the provider, then update
`DATABASE_URL` and run `docker compose up -d`, or update the file
`DATABASE_URL_FILE` names and run `docker compose restart api worker`.

### The URL fallback token

`api` and `worker` each ask GitHub at boot whose token
`MERGEBRIEF_URL_FALLBACK_TOKEN` is, and serve only that account. They read
the variable only at boot, so a new token takes effect only when they are
recreated.

1. Make the new token on the same GitHub account as the old one. On another
   account it serves only that account, and the previous owner's pasted
   private pull requests lose the fallback.
2. Set `MERGEBRIEF_URL_FALLBACK_TOKEN` in `.env` and run
   `docker compose up -d`.
3. Check the `api` and `worker` logs for the line
   `URL fallback token serves its owner only`. A
   `url-fallback-token.owner.fail` line instead means GitHub refused the
   token; it serves nobody until you replace it and restart.
4. Delete the old token on GitHub, under **Settings**, **Developer
   settings**, **Personal access tokens**.

A fine-grained token carries an expiry date; rotate it before that date.

## The audit log

Every action a credential takes is recorded, and so is every refusal of one. Reads
are not: they fire on every render, they already produce an `api.access` line,
and recording them would bury the actions. The consequence is worth stating
plainly: the log answers *what was done*, never *what was seen*.

A row holds ids, tokens and numbers, never a request body, never free text.
The operation is the same id the API's operation manifest lists, so a row and
a request log line join on `request_id`.

Two things to know before you write a query against it:

- **A row is filed under the installation the request acted in**, the one
  holding the pull request it named, else the repository. A pull request
  added by URL files with a null installation and `source = url`, even in a
  repository an installation holds. So do a request that names no
  repository, such as creating or revoking a token, and one whose repository sits
  in no installation the reviewer reaches.
- **A refusal that never resolved a credential is not in this table.** An
  unknown cookie, a revoked API token, an expired session: there is no actor
  to write, so nothing is recorded. Those refusals appear as
  `api.access` lines with a 401, and that is where to look for them.

Two rows name a repository rather than a pull request: `upload-attachment`
and `purge-attachments`, the App's only pushes ([attachments.md](attachments.md)),
carry `target_type = repository` and the repository's id, on a denial past
the gate as well as on success.

Two knobs, both in `mergebrief.config.yaml`:

| Key | Default | What it does |
| --- | --- | --- |
| `retention.auditDays` | unset (keep forever) | How long the daily sweep keeps rows. Minimum 30. |
| `audit.privateWrites` | `true` | Record writes that stay inside this instance. Writes that leave for GitHub, and every denial, are recorded either way; that is not configurable. |

```yaml
retention:
  auditDays: 365
audit:
  privateWrites: true
```

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

If disk becomes a concern, `brief` and `delta` are the tables to look at:
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
because every start takes the same instance-wide advisory lock. Each
scheduled sweep (`sweep-audit`, `sweep-sessions`, `sweep-pull-requests`, `sweep-webhook-deliveries`, `sweep-generation-parts`) still runs once per tick:
each runner tries to record the tick in graphile's `_private_known_crontabs`
table, and only the runner that advances `last_execution` enqueues the job. Each worker opens its own
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

Size each api container's memory for its diff caches on top of its
baseline: up to 128 MiB of span diffs under 1 MB each, plus up to 256 MiB of
larger ones (64 MiB at most each, four per viewer, kept 10 minutes).

Each replica also opens its own Postgres pool of up to `DATABASE_POOL_MAX`
connections (default 10), and each worker opens two such pools, one for
its store and one for its job queue, plus a third for the large pool's job
queue at `WORKER_LARGE_CONCURRENCY` + 2 connections. The budget is
`api replicas x DATABASE_POOL_MAX + worker count x (2 x DATABASE_POOL_MAX +
WORKER_LARGE_CONCURRENCY + 2)`, which must stay under Postgres
`max_connections`. The value is at least 2: a job queue keeps one
connection for its listener for the life of the worker and needs another
to claim jobs.

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

Each api opens its own pool of up to `DATABASE_POOL_MAX` connections, so count
replicas against Postgres's `max_connections` the way you count workers.
GitHub webhooks arrive through `web` and land on whichever replica
answers; the debounce that folds pushes into one job is a queue key in
Postgres, so it holds across replicas.

## The update check

About a minute after it starts, and then at most once an hour, when a signed-in read of `/api/version` finds the last attempt older than an hour, the API fetches one static file, `version.json`, from this project's GitHub Releases. The read itself never waits on GitHub: it answers from the last snapshot and the fetch runs behind it, so when the fetch succeeds a stale answer lasts one more read. The browser asks every minute while a page is visible and on a return to the window, so a signed-in user sees a new release within about an hour of its publication; that polled read logs its `api.access` line at `debug`, so an open tab adds nothing to the `info` log. The request carries nothing about your instance: no id, no version, no counts, a default User-Agent. GitHub sees the IP address and the time, as for any download; we see nothing, because we have no access to GitHub's logs. The check sends nothing else.

The answer drives three things: the banner every signed-in user sees when a newer version exists, one `update.available` line in the API log (`warn` when the release fixes a vulnerability), and the `latest` fields of `GET /api/version`, which `mergebrief auth status` shows.

To turn it off, set `MERGEBRIEF_UPDATE_CHECK=false`. The banner, the log line and the `latest` fields then never appear; nothing else changes. A `dev` build never checks.

If your network blocks github.com or release-assets.githubusercontent.com, where the release file redirects, the check fails quietly: one `update.check.fail` line at `info` on the first failure after boot, `debug` after that, and `/api/version` carries no fresh `checkedAt`.

| Variable | Default | What it does |
| --- | --- | --- |
| `MERGEBRIEF_UPDATE_CHECK` | `true` | Fetch `version.json` from GitHub Releases at most once an hour to learn about newer releases. The request identifies nothing. Off: no banner, no log line, no `latest` in `/api/version`. |
| `MERGEBRIEF_UPDATE_CHECK_URL` | `https://github.com/Idan91/mergebrief/releases/latest/download/version.json` | Where `version.json` is fetched from. Point it at a mirror on a network that blocks github.com. An absolute `http` or `https` URL with no credentials in it, or boot is refused. |

## Uninstalling

Removing an instance touches three places: GitHub, the host, and each
repository the App pushed images to. Work in this order, because the first
step needs the instance running.

1. **Take a last backup**, if you may want the data again
   ([Backup](#backup)). After step 6 nothing brings it back.
2. **Delete the attachment branches.** Each repository a reviewer attached
   an image in holds a `mergebrief/attachments` branch the App pushed
   ([attachments.md](./attachments.md)). Uninstalling the App leaves it in
   place. While the instance still runs, a repository admin deletes it from
   Home: the row menu of any pull request in that repository offers
   **Delete attachment branch**. Once the App is gone, or for a repository
   Home does not list, delete it on GitHub. To find the branches across an
   account or organization:

   ```sh
   for repo in $(gh repo list <owner> --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner'); do
     gh api "repos/$repo/git/ref/heads/mergebrief/attachments" --silent 2>/dev/null && echo "$repo"
   done
   ```

   and delete one with:

   ```sh
   gh api -X DELETE "repos/<owner>/<repo>/git/refs/heads/mergebrief/attachments"
   ```

   Every comment that embedded an image from the branch, on GitHub
   included, then shows a broken image.

3. **Uninstall the App from each account and organization** that installed
   it: in that account's or organization's settings, open the App under its
   installed GitHub Apps, choose **Configure**, then **Uninstall**. If the
   instance is still running, it receives the uninstall and deletes that
   installation's pull requests and briefs at once. The App's "brief ready"
   comments on pull requests stay on GitHub; delete them there if you want
   them gone.
4. **Delete the App registration**: on the App's settings page,
   **Advanced**, then **Delete GitHub App**.
5. **Revoke the URL fallback token**, if you set
   `MERGEBRIEF_URL_FALLBACK_TOKEN`: delete it on GitHub under **Settings**,
   **Developer settings**, **Personal access tokens**, on the account that
   owns it.
6. **Remove the containers, then the data.** From the folder that holds
   `docker-compose.yml`:

   ```sh
   docker compose down                        # stop and remove the containers
   docker compose down --volumes --rmi all    # DESTRUCTIVE: also drops postgres_data and the images
   ```

   The second command deletes the `postgres_data` volume, and with it every
   brief, review session, API token and audit row. It cannot be undone; only
   a dump from step 1 brings the data back. On an external database, drop
   the database through your provider instead; `--volumes` has nothing to
   remove there.

7. **Delete the host files**: `.env`, `mergebrief.config.yaml`, any private
   key file, `docker-compose.override.yml` and the `secrets/` folder, which
   holds the database URL with its password when you use `DATABASE_URL_FILE`.
   On an external database, also drop or rotate that role. Treat old dumps
   like `.env`: a dump holds every user's encrypted GitHub tokens, and `.env`
   holds the key that opens them.

### What each user can revoke

A user leaving a running instance, or one who does not want to wait for the
operator, can clear their own side:

- **API tokens**: revoke each one in `/settings`.
- **Sessions**: **Sign out**, then **Everywhere**. Once no session and no
  live API token uses their sign-in, MergeBrief revokes their GitHub token
  at GitHub and deletes its stored copy.
- **The App's access to their account**: on GitHub, **Settings**,
  **Applications**, **Authorized GitHub Apps**, then **Revoke** next to the
  App. GitHub tells a running instance, which deletes every session, API
  token and stored GitHub credential the user held there.

## See also

- [configuration.md](./configuration.md): every environment variable,
  instance config key and CLI setting, with defaults and accepted values.
- [compose.md](./compose.md): services, environment, hardening before
  exposure (TLS, the webhook secret, Postgres credentials).
- [observability.md](./observability.md): the log event contract, health
  endpoints, and alert recipes; `/healthz` vs `/readyz` semantics.
- [generators.md](./generators.md): provider/model config and the daily
  generation cap.
- [attachments.md](./attachments.md): the one push the App makes, and how
  an admin deletes it.
