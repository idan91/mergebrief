# Self-hosting MergeBrief

These pages cover running your own MergeBrief Instance: an api, a web tier and
a worker over one Postgres database, started from the shipped compose file.
Read them in the order below the first time; after that, each page stands on
its own.

## Prerequisites

- **Docker Engine with Docker Compose v2.24 or newer.** The shipped compose
  files load `.env` with the long `env_file` form, a `path` plus
  `required: false`, and older Compose releases reject that form. Run
  `docker compose version` to check. The image is built for `linux/amd64` and
  `linux/arm64`.
- **A GitHub App you register yourself.** There is no shared hosted App. Its
  App id, private key, webhook secret and OAuth client id and secret go in
  `.env` ([github-app.md](./github-app.md)).
- **A model provider API key.** The zero-config default reads
  `ANTHROPIC_API_KEY`; `openai` and `openrouter` read their own keys
  ([generators.md](./generators.md)). The subscription-billed CLI providers
  (`claude-code`, `codex`, `cursor`) run only as a process on your own machine
  outside the image, and the compose worker refuses them at boot
  ([generators.md](./generators.md#harness-clis-are-host-process-only-in-v1-deliberately)).
- **A public HTTPS URL in production.** GitHub delivers webhooks only to a
  publicly reachable URL ([github-app.md](./github-app.md#webhook)). The
  sign-in cookies are `__Host-` cookies, which a browser keeps over `https://`
  or on `http://localhost`, never over plain `http://` on another hostname.
  Nothing in the stack speaks TLS, so a reverse proxy in front terminates it
  ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).

## Sizing

- **Generations decide the worker's size.** Concurrent generations are
  `WORKER_COUNT` times the sum of `WORKER_CONCURRENCY` and
  `WORKER_LARGE_CONCURRENCY`, two by default. An API provider
  holds one response stream per slot ([generators.md](./generators.md#worker-slots)).
- **Postgres grows with briefs.** Each revision of a pull request stores its
  brief body as text, plus its revision summary and delta beside it. In the
  test fixtures a four-chunk brief body is about 6 KB and a synthetic
  300-chunk one about 84 KB. What prunes itself and what does not is in
  [operations.md](./operations.md#retention-what-grows-and-what-does-not-prune-itself).
- **Memory and CPU per service are not yet measured on a release image.**
  Read your own with `docker compose stats --no-stream`, once idle and once
  while a brief generates, and size the host from the peak.

## Server deployment

- [Deploy on a server](server-deployment.md): a pinned release
  image on a VPS or cloud VM, with bundled or managed Postgres, plus HTTPS
  and validation.
- [Managed Postgres provider notes](managed-postgres-notes.md): what the
  guide's database requirements mean on Neon, Supabase and Amazon RDS.

## Reading order

1. [github-app.md](./github-app.md): which permissions and events to give the
   App, how reviewer sign-in works, and who triggers a brief.
2. [compose.md](./compose.md): the services, the `.env` values a first boot
   needs, an external database, and the hardening steps before real exposure.
3. [generators.md](./generators.md): the provider and model, the daily
   generation cap, the `operators` list, and what force pushes and rebases do
   to a brief.
4. [security-model.md](./security-model.md): who can sign in, what each user
   can see, the trust boundaries, and every outbound destination with its off
   switch.
5. [configuration.md](./configuration.md): every variable and config key, its
   default, and what an empty or bad value does.
6. [operations.md](./operations.md): upgrades, migrations, backup and restore,
   retention, tokens at rest, rotating secrets, the audit log and uninstalling.
7. [observability.md](./observability.md): the log line, the `evt` names to
   alert on, health endpoints and tracing.
8. [troubleshooting.md](./troubleshooting.md): a symptom, its cause and the
   fix, with the log line or status you will see.

Read these when a repository or a reviewer needs them:

- [repo-config.md](./repo-config.md): what a repository's own `.mergebrief/`
  files can change about its briefs.
- [trackers.md](./trackers.md): where the primary ticket is read from, and
  what the worker fetches from links in a pull request description.
- [attachments.md](./attachments.md): the one push the App makes, for images
  in review comments.
- [cli.md](./cli.md): connecting the `mergebrief` CLI, and the `/api/*`
  exemption an identity-aware proxy needs.
