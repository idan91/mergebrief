# Security model

What an instance trusts, who can reach what, and every place it sends data. Product terms are defined in the [glossary](../glossary.md). Start with the checklist: each step links the page that walks you through it. The rest of the page explains the model those steps protect.

## Before you expose it

The defaults suit one person on a loopback-only machine. Before you point a domain at the instance, or leave a tunnel up, work through this list.

1. **Set a Postgres password before the first boot.** The bundled database keeps the default `mergebrief` credentials until you set `POSTGRES_PASSWORD` ([compose.md](./compose.md#1-postgres-credentials)).
2. **Terminate TLS at a reverse proxy,** set `PUBLIC_BASE_URL` to its `https://` origin, and add `Strict-Transport-Security` there. Leave compression off at the proxy ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).
3. **Generate the webhook secret** with `openssl rand -hex 32`. It is the only gate on the webhook route ([compose.md](./compose.md#3-the-webhook-secret-is-the-only-gate-on-the-webhook-route)).
4. **Rate-limit the webhook route at the proxy.** The app has no rate limit of its own ([compose.md](./compose.md#rate-limit-the-webhook-route-at-your-proxy)).
5. **Keep every published port on loopback.** `web` listens on `127.0.0.1:3000` and `postgres` on `127.0.0.1:5432`; `api` publishes none. Only the proxy should reach `web`.
6. **Register the App as private,** owned by your organization ([github-app.md](./github-app.md#who-can-install-and-sign-in)).
7. **List only the people and accounts who may sign in** under `operators` and `allowed` ([compose.md](./compose.md#list-who-may-sign-in)). See [Who can sign in](#who-can-sign-in) for what each entry admits.
8. **Decide what the worker may fetch.** By default it fetches any public link in a pull request description. Set `linkFetch.mode` to `allowlist` or `off`, and restrict the worker's egress at the network if it can reach internal services on routable addresses ([configuration.md](./configuration.md#linkfetch)).
9. **Make the URL fallback token on your own account,** if you set `MERGEBRIEF_URL_FALLBACK_TOKEN` at all. It serves only the account that owns it ([The URL fallback token](#the-url-fallback-token)).
10. **Back up `.env` with the database.** It holds the session key that seals every stored GitHub token ([backup-restore.md](./backup-restore.md#what-to-back-up)).
11. **Stop tunnels** when you are not testing. A tunnel puts the instance on the internet ([compose.md](./compose.md#4-a-tunnel-is-production-exposure)).
12. **Optionally, put sign-in behind your identity provider** ([below](#put-it-behind-an-identity-aware-proxy)).

**Check** from the host, with your own domain:

```sh
docker compose ps --format '{{.Service}}: {{.Ports}}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://brief.example.com/api/webhooks/github
curl -sI https://brief.example.com/ | grep -i strict-transport-security
```

- Every published port (the ones with `->`) starts with `127.0.0.1`, and `api` and `worker` publish none.
- The unsigned webhook POST answers `401`.
- The last command prints your `Strict-Transport-Security` header.

## Put it behind an identity-aware proxy

If your company has an identity provider such as Okta, you can decide who reaches sign-in at the network, with an identity-aware proxy such as Cloudflare Access, oauth2-proxy, Authelia or Pomerium. Your provider's docs cover the setup. Give it these paths, matching `/api/auth/*` first:

| Path | At the proxy | Used by |
| --- | --- | --- |
| `/api/auth/*` | Behind the identity provider | The browser: sign-in, its GitHub callback, the session, sign-out and API tokens |
| `/api/webhooks/github` | Open, with a rate limit | GitHub. Its signature is the only gate |
| Every other `/api/*` | Open | The CLI and agents. The API checks a session or token on every request |
| Everything else | Behind the identity provider | The browser: pages and assets |

- **The CLI never calls `/api/auth/*`.** If its requests reach the identity provider, it gets a login page and reports that the instance "answered like an identity-provider proxy". A proxy that accepts static headers can be satisfied from the CLI's profile instead ([cli.md](./cli.md#behind-an-identity-aware-proxy)).
- **Health checks:** the compose checks do not pass through the proxy. Open `/healthz` and `/readyz` only for a monitor outside it.
- **An open browser tab** calls `/api/auth/*` too, so it needs a reload once the identity provider's session expires.
- **Leave compression off** at the proxy, for the same reason as in step 2 above.
- **The proxy adds to `operators` and `allowed`;** it replaces neither.
- **Leavers keep their API tokens** when you disable them in the identity provider, because tokens skip the proxy. Also remove them from the instance config or from the GitHub account that lets them in; they lose access at their next GitHub token rotation ([Who can sign in](#who-can-sign-in)).

## Who can sign in

An instance starts closed. Nobody can sign in or start a brief until `mergebrief.config.yaml` names them, and a paste, a Regenerate and an API token all answer to the same list. On a solo instance, your own id under `operators` is all you need.

```yaml
# mergebrief.config.yaml
operators:
  - 583231      # GitHub user ids of the people who run the instance
allowed:
  users:
    - 9919      # single people, such as an outside reviewer
  accounts:
    - 12345678  # organizations or personal accounts whose installations count
```

Find a person's id with `gh api users/<login> --jq .id`, or in their avatar URL (`avatars.githubusercontent.com/u/<id>`), and an organization's with `gh api orgs/<org> --jq .id`. List ids, never logins: GitHub frees a login when its owner renames, and whoever registers it next would inherit the access. Then restart the services that read the lists:

```sh
docker compose restart api worker
```

**Check:** the person signs in. A refused account sees "This GitHub account isn't allowed on this instance. Ask whoever runs it for access.", and the api logs `info` `sign-in refused: the account is not allowed on this instance` with the account's `reviewerId`.

| Named by | Who that lets in |
| --- | --- |
| `operators` | Those people, and anyone in an installation of the App on their personal accounts, which includes collaborators on those repositories. Up to 100 ids. |
| `allowed.users` | Those people, whatever they can install. Up to 1000 ids. |
| `allowed.accounts` | Anyone in an installation of the App on those organizations or personal accounts. Up to 1000 ids. |

- **What counts as "in an installation"** is GitHub's answer: the installations a person has explicit access to, through ownership, as a collaborator or through organization membership. Reading a public repository does not count, and neither does a suspended installation. An installation made at enterprise level never matches, so list each organization.
- **Empty and bare blocks.** Omitting `operators`, or writing `operators: []`, means nobody is an operator. A bare `operators:` with nothing under it, a bare `allowed:`, or an `allowed:` that names neither list refuses boot. An instance whose config names nobody logs `the instance config names nobody` at boot and refuses every sign-in.

Webhook deliveries answer to the same list. A pull request, review, check run or status delivery starts or wakes a run only for a repository on a listed account or an operator's personal account. Anything else is answered 200 and logged with the account's id, at `warn`, or at `debug` for a check run or status, which a push brings by the dozen. A stranger who installs a public App spends nothing. Install and uninstall events still apply.

Everyone on the list can paste a pull request URL or regenerate a brief, and each of those runs spends your provider key, counted against the [daily cap](./spend-cap.md).

A person you take off the list loses access at their next GitHub token rotation, about every 8 hours of use. That ends their sessions and their API tokens, including one with no expiry. Until then they can read what their own GitHub access allows, and they cannot start a brief or create a token.

Sign-in runs through your own GitHub App ([github-app.md](./github-app.md#reviewer-sign-in)), and every reviewer then acts on their own user token, bounded by the App's permissions and by what that account can reach on GitHub.

Signed out, a visitor sees one sign-in page. Without a session every `/api` route answers 401, apart from the webhook, the sign-in redirect and its callback, and sign-out. `/healthz` and `/readyz` answer without a session and carry no data ([observability.md](./observability.md#health-checks)).

## What each user can see

A reviewer's own GitHub access decides every read. [How MergeBrief works](../architecture.md#who-can-read-what) explains it in plain terms; the detail per kind of user follows.

### A reviewer on an installed repository

- **Reaches** a pull request when the App is installed on its repository and their own token can read it.
- **Reads** that repository's briefs and each pull request's conversation. Every read checks their own token first, then finds the installation that holds the repository.
- **Writes** comments, replies and reviews on their own token, authored as them. Their review session is theirs alone.
- **Needs push access** to approve an outside author's first brief or to regenerate, and admin to delete a pull request's data.

### A reviewer with a pasted URL pull request

- **Reaches** it by pasting its URL on Home, for a repository in no installation. They must be on the sign-in list.
- **Reads** the brief the worker built with their own GitHub grant. Their Inbox lists the pull requests they pasted. Any other reviewer whose token can read the repository opens the same stored brief.
- **Writes** comments and reviews on their own token, and can delete their own URL row.
- **Cannot** regenerate or attach images. The worker never writes to GitHub for a URL pull request, so it gets no Entry comment.

### An operator

- **Is** a GitHub user whose numeric id is in the instance config's `operators` list ([Who can sign in](#who-can-sign-in)).
- **Reads** everything their reviewer access gives them, plus instance-wide state no repository scopes: today's started runs against the daily cap, on the Instance tab of Settings or with `mergebrief spend`.
- **Writes** nothing beyond their reviewer access. The role grants no repository reach.

Owning the URL fallback token does not make anyone an operator; only the `operators` list does. Every signed-in user sees the version notice.

Whoever controls the host sits outside this model. `.env` holds every credential, and anyone who can write to the database can insert a session that acts as another user. The audit log has no screen and no API route: you read it from the database ([Query the audit log](./data-and-scaling.md#query-the-audit-log)).

## Trust boundaries

### The webhook route

`POST /api/webhooks/github` takes no session and no token. The HMAC-SHA256 signature over the raw body, keyed by `GITHUB_WEBHOOK_SECRET`, is the only gate. The api checks it before it parses the body or touches the database; a missing or wrong signature answers 401 and writes nothing. The installation a delivery acts on comes from the signed payload, never from a header. The route caps the body at 1 MB and has no rate limit of its own, so put one in your proxy ([compose.md](./compose.md#3-the-webhook-secret-is-the-only-gate-on-the-webhook-route)).

### The web tier

`web` is the only service meant to take outside traffic, and it holds no credentials. Compose gives it no `env_file`: it gets `PUBLIC_BASE_URL`, `MERGEBRIEF_API_ORIGIN` and six tracing variables, and never the OTLP headers.

- It forwards `/api/*` to `api` as it arrived, minus the hop headers and the caller-address claims `Forwarded`, `X-Forwarded-For` and `X-Real-IP`. The api records no caller address.
- It answers 403 to any request whose `Host` is not `PUBLIC_BASE_URL`'s hostname, `localhost`, a `*.localhost` name or a bare IP address.

`api` publishes no port. It holds every credential and the database connection, and only `web` reaches it, over the compose network.

`postgres` publishes `127.0.0.1:5432` for host tooling, and keeps the default `mergebrief` credentials until you set `POSTGRES_PASSWORD`. On a host other people log in to, drop that mapping or set a strong password ([compose.md](./compose.md#1-postgres-credentials)).

### Rate limiting

Apart from the per-reviewer [attachment upload quota](./attachments.md#limit-uploads-per-reviewer), the API has no built-in rate limiting, the webhook route included. Rate limit at your reverse proxy; [compose.md](./compose.md#rate-limit-the-webhook-route-at-your-proxy) says how to scope a limit to the webhook route and size it for GitHub's bursts.

### Sessions and tokens

- **Sign-in.** The OAuth start sets two `__Host-` cookies that live ten minutes: `__Host-mergebrief_oauth_state` holds a random state nonce, and `__Host-mergebrief_oauth_return` holds the page to return to after sign-in. The callback refuses a state that does not match the cookie.
- **Session cookie.** `__Host-mergebrief_session` is `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`. It carries a random value, and the database keeps only its SHA-256 hash. A session expires when its GitHub refresh token does, and each token refresh moves that date forward.
- **Sign out everywhere** deletes every browser session you hold. It does not touch your API tokens: each keeps working until you revoke it or it expires.
- **Same-origin writes.** A cookie request that changes state must prove it came from this instance: it carries `Sec-Fetch-Site: same-origin`, or an `Origin` equal to `PUBLIC_BASE_URL`'s origin. Anything else answers 403.
- **API tokens.** An API token starts with `mergebrief_`, is stored as a SHA-256 hash, and carries the scope chosen when it was created. The `/api/auth/*` routes ignore it, so a stolen token cannot create another token or sign its owner out ([cli.md](./cli.md#create-a-token)).
- **The CLI's copy.** The CLI stores its token in plain text in `~/.config/mergebrief/config.json` (under `$XDG_CONFIG_HOME` when set), a file only its owner can read (mode `0600`).
- **GitHub tokens.** Each user's access and refresh token pair is the one secret MergeBrief stores, encrypted under the session key ([How GitHub tokens are stored](./secrets.md#how-github-tokens-are-stored)). A user who revokes the App on github.com loses every session, API token and stored GitHub token here ([github-app.md](./github-app.md#reviewer-sign-in)).

### If an account or token leaks

Do all three steps. Each one closes a different door.

1. **Sign out everywhere.** In MergeBrief, open the account menu, choose **Sign out**, then **Everywhere**. This ends every browser session.
2. **Revoke every API token.** Open `/settings` on your instance and choose **Revoke** on each token under **API tokens**. Sign-out does not reach them.
3. **Revoke the App's authorization on github.com.** Go to GitHub's **Settings → Applications → Authorized GitHub Apps** and revoke your MergeBrief App. GitHub tells MergeBrief, which then deletes every session, API token and stored GitHub token you held.

To check a leaked token is dead, paste it at the prompt and call the API with it. A revoked token answers `401`; a live one answers `200`:

```sh
read -rs LEAKED_TOKEN
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $LEAKED_TOKEN" \
  https://mergebrief.your-org.example/api/version
unset LEAKED_TOKEN
```

### The worker

The worker reads a pull request from an installation with the App's installation token. For a URL pull request it reads with the grant of the reviewer who added it: the job carries a reference to the grant, never the token, and nothing it does for that job writes to GitHub.

Pull request text is written by people you may not trust. The worker fences it as data for the model, but text in a description, a diff or a ticket can still steer what a brief says ([generators.md](./generators.md#what-stays-open)). A brief whose output contains the value of a secret the worker holds fails as `output-secret` instead of being stored.

### The URL fallback token

`MERGEBRIEF_URL_FALLBACK_TOKEN` is a GitHub token for URL pull requests on repositories the App is not installed on. At boot the api and the worker ask GitHub whose token it is. From then on:

- It serves one person, the GitHub account that owns it. Every other user gets the instance as if no token were set.
- It is tried only after that person's own token is denied, and only for a URL pull request they add and its brief.
- It reads and never writes. Comments, reviews and every other write run on the person's own token.
- Diff and file reads on it are limited to the commits MergeBrief recorded for that pull request. The file path is not limited: any file at one of those commits is readable.
- It never lists the repository's open pull requests, and the worker never reads an issue outside the pull request's repository with it.

If GitHub refuses the token at boot, the api and the worker log `url-fallback-token.owner.fail`, and it serves nobody until it is replaced and the process restarts ([troubleshooting.md](./troubleshooting.md)).

## Outbound destinations

Logs go to stdout. Nothing reports back to the MergeBrief project: the update check is the one request toward its GitHub Releases, and it carries nothing about your instance.

| Destination | Sent by | What is sent | How to turn it off |
| --- | --- | --- | --- |
| GitHub (`api.github.com`, `github.com`), on the App's installation token | api, worker | Pull request data, diffs, files, the `.mergebrief/` files, issues read as tickets and the visibility of the repository a ticket sits in, the Entry comment, image attachments, and the reads that confirm a webhook delivery | It cannot be off: GitHub is where every pull request comes from |
| GitHub, on a reviewer's own token | api, worker | Their reads, comments and reviews, and the reads for a URL pull request | Same |
| GitHub OAuth | api | The code exchange, token refresh and revoke; `GET /user` for the URL fallback token's owner | Same |
| GitHub's image hosts (`private-user-images.githubusercontent.com`, and the storage host a public image redirects to, today `github-production-user-asset-6210df.s3.amazonaws.com`) | api | Requests for image attachments | Same |
| Model provider (`api.anthropic.com`, `api.openai.com/v1`, `openrouter.ai`, or `generator.baseUrl`) | worker | The pull request's text, diff and context, listed [below](#what-the-model-provider-receives) | Generation needs a provider. To keep code inside your network, point `openai`'s `baseUrl` at a compatible server you run ([generators.md](./generators.md#the-six-providers)) |
| Update check (`github.com`, this project's GitHub Releases, and `release-assets.githubusercontent.com`, where the download redirects) | api | One `GET` for `version.json`, at most once an hour, with no instance id, version or count | `updateCheck.enabled: false` in the instance config, or `updateCheck.url` to fetch it from your own mirror ([configuration.md](./configuration.md#updatecheck)) |
| Notion (`api.notion.com`) | worker | The integration token, the board's database id, the ticket number, and the page and block ids of the one ticket a pull request names. Installed repositories only ([trackers.md](./trackers.md#notion)) | Remove the `notion` entries from `contextSources:` and `trackers:` |
| Jira (`api.atlassian.com`) | worker | The account email and API token, the site's cloud id and the issue key of the one ticket a pull request names. At boot, one request that asks what the token can do. Installed repositories only ([trackers.md](./trackers.md#jira)) | Remove the `jira` entries from `contextSources:` and `trackers:` |
| Jira site (the configured `site`, `/_edge/tenant_info`) | worker | A plain `GET` with no credential, to look up the site's cloud id: once per worker process at boot, and again after a failed lookup or a cloud id Atlassian no longer knows ([trackers.md](./trackers.md#what-the-worker-asks-atlassian)) | Remove the `jira` entries from `contextSources:` and `trackers:` |
| The OTLP endpoint you configure | api, worker, web | Trace spans, listed [below](#what-a-trace-carries) | Off by default. Leave both endpoint variables unset, or set `OTEL_SDK_DISABLED=true` |
| Links in a pull request description | worker | A plain `GET` to up to five http(s) links, with no credentials and no redirects followed. Up to 20,000 characters of each answer go to the model ([trackers.md](./trackers.md#links-in-the-description)) | `linkFetch.mode: off`, or `allowlist` to name the hosts ([configuration.md](./configuration.md#linkfetch)). The worker warns at boot while the mode is `public`, the default |

### What the model provider receives

- The pull request's title, description, base and head branch names, file list and unified diff.
- The numbers and titles of its neighbours in a stack.
- On a revision, the previous brief and the incremental diff; for a delta brief, the review comments.
- The repository's `instructions.md` and custom attributes.
- The primary ticket's text, and the text fetched from links in the description.

`openai` and `openrouter` also check the model at boot, and `openrouter` sends `referer` and `title` when the config sets them. `openrouter` passes the request on to the upstream that serves the model, and the worker asks it for one that keeps no request data ([generators.md](./generators.md#openrouter)). A redirect from a provider is refused, never followed.

### What a trace carries

Span attributes are ids, counts, decision tokens, the model name and token counts. Cookies, request headers other than the host, SQL parameter values and URL query strings are not recorded. A failed query's span keeps Postgres's error message, which can quote a value ([observability.md](./observability.md#tracing)).

### What a reviewer's browser loads

The table covers the instance's own processes. A reviewer's browser also loads:

- **Avatars** from `github.com`.
- **Images in a description or comment,** through the API or straight from the hosts GitHub serves its own stored files from (`github.com`, and named hosts under `githubusercontent.com` and `githubassets.com`). An image on any other host, GitHub's image relay `camo.githubusercontent.com` and a release download are never loaded: the page names the host and links the address instead.
- **A Mermaid diagram's own references:** the diagram library can fetch an image or stylesheet address the diagram names.

A file kept in Git LFS counts against its owner's bandwidth, so an author who points an image at their own repository can see that it was fetched, though not by whom.

The `mergebrief` CLI asks the npm registry for its newest version unless `MERGEBRIEF_NO_VERSION_WARNING` is set ([cli.md](./cli.md#versions)).
