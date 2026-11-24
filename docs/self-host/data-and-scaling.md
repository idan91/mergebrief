# Data, retention and scaling

What the database keeps and how to prune it, how to read the audit log, and how to add worker and api capacity without running Postgres out of connections. Run every command in the folder that holds `docker-compose.yml` and `.env`. The `psql` commands use the bundled database; on an external one, run the same SQL through `psql` in `postgres:17-alpine`, as [Check a restore](./backup-restore.md#check-a-restore) does.

## Prune closed pull requests

Briefs and their sidecars accumulate per pull request revision, and by default nothing prunes them: closing or merging a pull request records the close time and nothing else. `retention.pullRequestDays` makes the worker's daily sweep erase every pull request closed or merged longer ago than that many days, with its briefs and every reviewer's session, drafts and decisions on it.

> [!WARNING]
> The first sweep after you set it erases every pull request already past the window, however long ago it closed, across every installation and every pasted pull request. Only a backup brings them back. Take one first ([Back up and restore](./backup-restore.md)).

1. Add this to `mergebrief.config.yaml`, with your own window, at least 1:

   ```yaml
   retention:
     pullRequestDays: 90
   ```

2. Restart the worker, which reads the file at boot:

   ```sh
   docker compose restart worker
   ```

**Check:** the worker's start line names the window:

```sh
docker compose logs worker | grep 'pull request retention'
```

It reads `pull request retention 90d`. Unset, it reads `unset (rows kept forever)`.

The window counts from the close on GitHub, not from the brief. A reopened pull request leaves the window. A pasted pull request that closed before the window is briefed, then erased by the next sweep. Each sweep writes one audit row per installation or owner, per batch of 500, with the count.

## Prune the audit log

The audit log is append-only, and the daily sweep keeps every row unless you set `retention.auditDays`, at least 30. Set it longer than your longest-open pull request: audit has to outlive a review session.

```yaml
retention:
  auditDays: 365
```

Then `docker compose restart worker`. **Check:** the worker's start line reads `audit retention 365d`.

Nothing on the web tier can trigger the sweep; it runs only inside the worker.

## Query the audit log

Every action a credential takes is recorded, and so is every refusal of one. Reads are not: they already produce an `api.access` line, so the log answers what was done, never what was seen. A row holds ids, tokens and numbers, never a request body or free text. Its `operation` is the same id the API's operation manifest lists, and a row joins its request's log line on `request_id`.

There is no in-app reader. The last 50 writes that reached GitHub:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select occurred_at, operation, outcome, channel, client
  from audit_log
  where classification = '\''external-write'\''
  order by occurred_at desc limit 50;"'
```

Before you write your own query:

- **A row is filed under the installation the request acted in:** the one holding the pull request it named, else the repository. A pull request added by URL files with a null installation and `source = url`, even in a repository an installation holds. So does a request that names no repository, such as creating or revoking a token, and one whose repository sits in no installation the reviewer reaches.
- **A refusal that never resolved a credential is not in this table.** An unknown cookie, a revoked API token or an expired session has no actor to record. Those refusals are `api.access` lines with a 401.
- **Two rows name a repository rather than a pull request:** `upload-attachment` and `purge-attachments`, the App's only pushes ([attachments.md](./attachments.md)), carry `target_type = repository` and the repository's id.

`audit.privateWrites: false` in `mergebrief.config.yaml` stops `api` recording writes that stay inside the instance; writes that reach GitHub and every denial are recorded either way. Restart `api` after changing it.

### Erase one person's audit rows

> [!WARNING]
> This deletes the rows for good. Replace `12345` with the person's GitHub user id (`gh api users/<login> --jq .id`).

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "delete from audit_log where actor_id = 12345;"'
```

## See what uses disk

`brief` and `delta` hold the generated JSON, so they are usually the largest tables:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as size
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = '\''public'\'' and c.relkind = '\''r'\''
  order by pg_total_relation_size(c.oid) desc limit 10;"'
```

## What else is deleted, and when

- **Uninstalling the App or removing a repository from an installation** purges that installation's or repository's pull requests and briefs at once.
- **A repository admin can delete one pull request's briefs** from Home, and **a reviewer can delete a pull request they pasted**. Either takes the same set as the retention sweep, and the purge's audit row names who asked.
- **Reviewer text** sits unencrypted in the database, so a database copy can read it. A draft comment's body is stored from the moment it is drafted and kept after it is posted. A reviewer can delete a comment they have not posted, but a push copies unposted comments into the new head's session, and deleting the copy leaves the earlier session's row. A risk's dismissal reason or note goes with its brief or pull request, and reopening the risk deletes it from that session. Without `retention.pullRequestDays`, all of it stays.
- **Sign-in credentials prune themselves.** Every hour the worker deletes expired sessions, then each stored GitHub token no session and no live API token still uses, and asks GitHub to revoke it. Those revokes are best-effort and stop after 30 seconds per sweep; a token the sweep does not reach stays valid at GitHub until it expires, and the worker logs how many it skipped. A revoked or expired API token stays listed in settings as revoked for 30 days, then the same sweep deletes it. Signing out and revoking the App on github.com delete at once.

## Add worker capacity

Concurrent generations are `WORKER_COUNT` times the sum of `WORKER_CONCURRENCY` and `WORKER_LARGE_CONCURRENCY`, two by default. Prefer more slots in one worker; a second worker buys restart isolation, not throughput slots could not give you ([Worker slots](./generators.md#worker-slots)).

1. **Check the connection budget** before you add anything ([Size the connection budget](#size-the-connection-budget)).
2. **Set the dial in `.env`**, for example two slots in one worker:

   ```dotenv
   WORKER_CONCURRENCY=2
   ```

   or two workers:

   ```dotenv
   WORKER_COUNT=2
   ```

3. **Apply it:**

   ```sh
   docker compose up -d --wait
   ```

**Check:**

```sh
docker compose ps worker
docker compose logs worker | grep 'listening for generate jobs'
```

`ps` lists one `worker` container per `WORKER_COUNT`. Each worker's start line names its slots, such as `slots 2 + 1 large`. `docker compose up --scale worker=N` overrides `WORKER_COUNT` for that run only.

Several workers share one queue safely: no two take the same job, and each scheduled sweep still runs once per tick. When a newer push lands while a job runs, the two can overlap for about 20 seconds before the older one stands down; that costs spend, never correctness, and the daily cap stays exact.

## Run more than one api

```dotenv
API_COUNT=2
```

```sh
docker compose up -d --wait
```

**Check:** `docker compose ps api` lists two containers, both `healthy`.

Every replica serves every request: sessions, the audit log and the job queue live in Postgres; sign-in state rides the request; a GitHub token refresh is serialized on its row; boot migrations take the advisory lock. The api publishes no host port, so nothing else in the compose file changes. What stays per replica:

- **Short caches**, such as a pull request's conversation for 60 seconds. A write evicts only the cache of the replica it landed on, so a comment a reviewer just posted can be missing from a read on another replica for up to a minute. A load balancer that keeps a session on one replica removes that.
- **The attachment upload quota** is counted per replica, so two replicas let one reviewer attach up to twice the limit per window.
- **The update check:** each replica fetches `version.json` on its own schedule, so N replicas make N fetches an hour, log N `update.available` lines per release, and can answer `GET /api/version` differently for up to an hour after a release.
- **Memory:** size each api container for its diff caches on top of its baseline, up to 128 MiB of diffs under 1 MB each plus up to 256 MiB of larger ones (64 MiB at most each, four per viewer, kept 10 minutes).

`web` reaches the replicas through Docker's DNS, which spreads new connections unevenly and keeps sending to a replica that is stuck but still accepts connections. For an even spread and health-aware routing, put a load balancer in front of the apis and point `MERGEBRIEF_API_ORIGIN` at it. `web` is stateless too and scales the same way behind your proxy.

## Size the connection budget

Each api replica opens a pool of up to `DATABASE_POOL_MAX` connections, default 10. Each worker opens two such pools, its store and its job queue, plus a third for the large pool's job queue at `WORKER_LARGE_CONCURRENCY` + 2. The total must stay under Postgres's `max_connections`:

```text
API_COUNT x DATABASE_POOL_MAX + WORKER_COUNT x (2 x DATABASE_POOL_MAX + WORKER_LARGE_CONCURRENCY + 2)
```

With the defaults that is `1 x 10 + 1 x (2 x 10 + 1 + 2) = 33`. The bundled Postgres allows 100, so four workers at the defaults (`10 + 4 x 23 = 102`) already exceed it. Leave room for migrations, `psql` and backups, and on a managed database for the provider's reserved connections.

**Check** what the server allows and what is open now:

```sh
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "show max_connections" -c "select count(*) from pg_stat_activity"'
```

To fit, lower `DATABASE_POOL_MAX` in `.env` (at least 2: a job queue holds one connection for its listener and needs another to claim jobs), or raise the bundled Postgres's limit in `docker-compose.override.yml`:

```yaml
services:
  postgres:
    command: ["postgres", "-c", "max_connections=200"]
```

Then run `docker compose up -d --wait`. On a managed database, the provider sets the limit. A pool that cannot get a connection waits up to 10 seconds, then the request or job fails ([Postgres refuses connections](./troubleshooting.md#postgres-refuses-connections)).
