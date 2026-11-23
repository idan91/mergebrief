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
| Run it for a team on a VM with a domain | [cloud-deployment.md](./cloud-deployment.md): a Hetzner or EC2 VM, HTTPS, and the database on the VM or a managed one |

Both run the same compose release, so you can move from the first to the second.

## Prerequisites

- **Docker Engine with Docker Compose 2.24.4 or newer.** The compose files use features older releases reject. Check with `docker compose version`. The image runs on `linux/amd64` and `linux/arm64`.
- **A GitHub account that can register an App.** For an organization's App, you need to be an owner or a GitHub App manager there. There is no shared hosted App ([github-app.md](./github-app.md)).
- **A model provider API key.** The default provider reads `ANTHROPIC_API_KEY`; `openai` and `openrouter` read their own ([generators.md](./generators.md)). The subscription CLI providers (`claude-code`, `codex`, `cursor`) do not run in the image ([generators.md](./generators.md#harness-clis-are-host-process-only-in-v1-deliberately)).
- **A public HTTPS URL.** GitHub delivers webhooks only to a public URL, and sign-in cookies need `https://` on any host but `localhost`. On a server that is your domain behind a reverse proxy; on your own machine it is a tunnel such as ngrok.
- **`openssl`**, to generate secrets, and optionally the **`gh`** CLI, to look up GitHub ids.

## Quick start

1. **Get the release files** into an empty folder ([Get the release files](./compose.md#get-the-release-files)).
2. **Register and install the GitHub App** with your public URL ([github-app.md](./github-app.md)).
3. **Fill in `.env`** with the App's credentials, a session key and your model key, and **list yourself** in `mergebrief.config.yaml` ([Fill in `.env`](./compose.md#fill-in-env), [List who may sign in](./compose.md#list-who-may-sign-in)).
4. **Start the stack:** `docker compose up -d --wait` ([Start the stack](./compose.md#start-the-stack)).
5. **Push to a pull request** on a repository the App is installed on ([Check it end to end](./compose.md#check-it-end-to-end)).

You're done when the App's comment on that pull request reads **Read the brief for this push** and its link opens the brief in MergeBrief.

## Sizing

- **Generations decide the worker's size.** Concurrent generations are `WORKER_COUNT` times the sum of `WORKER_CONCURRENCY` and `WORKER_LARGE_CONCURRENCY`, two by default. An API provider holds one response stream per slot ([generators.md](./generators.md#worker-slots)).
- **Postgres grows with briefs.** Each revision of a pull request stores its brief, its revision summary and its delta. In the test fixtures a small brief is about 6 KB and a synthetic very large one about 84 KB. What prunes itself and what does not: [operations.md](./operations.md#retention-what-grows-and-what-does-not-prune-itself).
- **Memory and CPU per service are not measured yet.** Read your own with `docker compose stats --no-stream`, once idle and once while a brief generates, and size the host from the peak. The cloud guide starts at 2 vCPU and 4 GB.

## Reading order

After the quick start, read these in order the first time; each stands on its own afterwards.

1. [generators.md](./generators.md): the provider and model, the daily generation cap, the `operators` list, and what force pushes and rebases do to a brief.
2. [security-model.md](./security-model.md): who can sign in, what each user can see, the trust boundaries, and every outbound destination with its off switch.
3. [configuration.md](./configuration.md): every variable and config key, its default, and what an empty or bad value does.
4. [operations.md](./operations.md): upgrades, migrations, backup and restore, retention, tokens at rest, rotating secrets, the audit log and uninstalling.
5. [observability.md](./observability.md): the log line, the `evt` names to alert on, health endpoints and tracing.
6. [troubleshooting.md](./troubleshooting.md): a symptom, its cause and the fix, with the log line or status you will see.

Read these when a repository or a reviewer needs them:

- [repo-config.md](./repo-config.md): what a repository's own `.mergebrief/` files can change about its briefs.
- [trackers.md](./trackers.md): where the primary ticket is read from, and what the worker fetches from links in a pull request description.
- [attachments.md](./attachments.md): the one push the App makes, for images in review comments.
- [cli.md](./cli.md): connecting the `mergebrief` CLI, and the `/api/*` exemption an identity-aware proxy needs.
