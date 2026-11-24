# Self-hosting MergeBrief

MergeBrief writes a brief for every pull request: what changed, grouped by intent, with the risks a reviewer should look at first. You run it yourself, next to your own GitHub App and your own model key.

Once it runs:

- Every push to an open pull request on a repository you install it on gets a brief in the background.
- The pull request gets one comment from your App, the Entry comment, linking to that brief.
- Reviewers sign in with GitHub, read the brief, and submit their review to GitHub from it.

## Choose a path

| You want to | Follow |
| --- | --- |
| Try it on your own machine | [compose.md](./compose.md), with a tunnel so GitHub can reach you ([Try it locally through a tunnel](./compose.md#try-it-locally-through-a-tunnel)) |
| Run it for a team on a server with a domain | [server-deployment.md](./server-deployment.md): a VPS or cloud VM, HTTPS, and the database on the server or a managed one |

Both run the same compose release, so you can move from the first to the second.

## Prerequisites

- **Docker Engine with Docker Compose 2.24.4 or newer.** The compose files use features older releases reject. Check with `docker compose version`. The image runs on `linux/amd64` and `linux/arm64`.
- **A GitHub account that can register an App.** For an organization's App, you need to be an owner or a GitHub App manager there. There is no shared hosted App ([github-app.md](./github-app.md)).
- **A model provider API key.** The default provider reads `ANTHROPIC_API_KEY`; `openai` and `openrouter` read their own ([generators.md](./generators.md)). The subscription CLI providers (`claude-code`, `codex`, `cursor`) do not run in the image ([generators.md](./generators.md#subscription-cli-providers)).
- **A public HTTPS URL.** GitHub delivers webhooks only to a public URL, and sign-in cookies need `https://` on any host but `localhost`. On a server that is your domain behind a reverse proxy; on your own machine it is a tunnel such as ngrok.
- **`openssl`**, to generate secrets, and optionally the **`gh`** CLI, to look up GitHub ids.

## Quick start

1. **Get a public HTTPS origin.** On a server, point a domain at it and put HTTPS in front ([Put HTTPS in front on a server](./compose.md#put-https-in-front-on-a-server)). On your own machine, start a tunnel ([Try it locally through a tunnel](./compose.md#try-it-locally-through-a-tunnel)). The App's URLs and `PUBLIC_BASE_URL` are built from this origin, so it comes first.
2. **Get the release files** into an empty folder ([Get the release files](./compose.md#get-the-release-files)).
3. **Register and install the GitHub App** with that origin ([github-app.md](./github-app.md)).
4. **Fill in `.env`** with the App's credentials, a session key, your model key and a `POSTGRES_PASSWORD`, which must be set before the first start ([Fill in `.env`](./compose.md#fill-in-env)). Then **list yourself** under `operators` in `mergebrief.config.yaml`, and, if you installed the App on an organization, list the organization's id under `allowed.accounts` too, or its pushes start nothing ([List who may sign in](./compose.md#list-who-may-sign-in)).
5. **Start the stack:** `docker compose up -d --wait` ([Start the stack](./compose.md#start-the-stack)).
6. **Push to a pull request** on a repository the App is installed on ([Check it end to end](./compose.md#check-it-end-to-end)), then [back up](./compose.md#back-up-now) what you just set up.

You're done when the App's comment on that pull request reads **Read the brief for this push** and its link opens the brief in MergeBrief.

## Sizing

- **Generations decide the worker's size.** Concurrent generations are `WORKER_COUNT` times the sum of `WORKER_CONCURRENCY` and `WORKER_LARGE_CONCURRENCY`, two by default. An API provider holds one response stream per slot ([generators.md](./generators.md#worker-slots)).
- **Postgres grows with every push.** Each push to a pull request stores a new brief beside the old ones. Check the database's size after a week of use and plan the disk from that; on the bundled Postgres, `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_size_pretty(pg_database_size(current_database()));"'` prints it. What prunes itself and what does not: [data-and-scaling.md](./data-and-scaling.md#prune-closed-pull-requests).
- **Memory and CPU per service are not measured yet.** Read your own with `docker compose stats --no-stream`, once idle and once while a brief generates, and size the host from the peak. The server guide gives a [starting size](./server-deployment.md#choose-the-deployment).

## Reading order

The pages follow the site's sidebar, in four phases. Set up once, read the Configure and Secure pages before you invite a team, and open the Operate pages when the task comes up.

Set up:

1. This page: what you need and the quick start.
2. [compose.md](./compose.md): get the release files, fill in `.env`, list who may sign in, start the stack and check it end to end.
3. [github-app.md](./github-app.md): register the App, collect its credentials and install it.
4. [server-deployment.md](./server-deployment.md): run it for a team on a VPS or cloud VM with HTTPS and a database on the server or a managed one.

Configure:

1. [configuration.md](./configuration.md): every variable and config key, its default, what an empty or bad value does, and how to apply a change.
2. [generators.md](./generators.md): choose the model provider and model, and check which one wrote a brief.
3. [spend-cap.md](./spend-cap.md): cap how many briefs generate a day.
4. [repo-config.md](./repo-config.md): what a repository's own `.mergebrief/` files can change, and the conditions you set for every repository. Code owners read [Configure your repository](../repo-config/README.md).
5. [trackers.md](./trackers.md): where the primary ticket is read from, and what the worker fetches from links in a pull request description.
6. [attachments.md](./attachments.md): the one push the App makes, for images in review comments.

Secure:

1. [security-model.md](./security-model.md): who can sign in and how to list them, what each user can see, the trust boundaries, and every outbound destination with its off switch.
2. [secrets.md](./secrets.md): rotate the session key, the App's key and secrets, the Postgres password, the model provider key, tracker tokens and OTLP credentials.

Operate:

1. [observability.md](./observability.md): the log line, the `evt` names to alert on, health endpoints and tracing.
2. [upgrade.md](./upgrade.md): upgrade to a new release, check the version you run, and roll back.
3. [backup-restore.md](./backup-restore.md): schedule backups before you need one, and restore in place or onto a new host.
4. [data-and-scaling.md](./data-and-scaling.md): retention, the audit log, and adding worker or api capacity.
5. [troubleshooting.md](./troubleshooting.md): a symptom, its cause and the fix, with the log line or status you will see.
6. [uninstall.md](./uninstall.md): remove an instance from GitHub and the host.

Elsewhere:

- [The `mergebrief` CLI](../use/cli.md): reviewing from a terminal, a script, CI or a coding agent.
- [How MergeBrief works](../architecture.md) and the [glossary](../glossary.md): what happens between a push and a brief, and what each term means.
