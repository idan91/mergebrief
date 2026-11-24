# Security model

What an Instance trusts, who can reach what, and every place it sends data.
The hardening steps live in
[compose.md](./compose.md#hardening-before-real-exposure); this page explains
the model those steps protect.

## Who can sign in

An instance starts closed. Nobody can sign in or start a brief until its config
names them ([generators.md](./generators.md#who-may-start-a-brief)):

| Named by | Who that lets in |
| --- | --- |
| `operators` | Those people, and anyone in an installation of the App on their personal accounts, which includes collaborators on those repositories |
| `allowed.users` | Those people, whatever they can install |
| `allowed.accounts` | Anyone in an installation of the App on those organizations or personal accounts |

Webhook deliveries answer to the same list. A pull request, review, check run or
status delivery starts or wakes a run only for a repository on a listed account or
an Operator's personal account. Anything else is answered 200 and logged with the account's id, at
`warn`, or at `debug` for a check run or status, which a push brings by the dozen, so a stranger who
installs a public App spends nothing. Install and uninstall
events still apply.

Each of them can paste a pull request URL or Regenerate, and each of those runs
spends your provider key, counted against the
[daily cap](./generators.md#daily-generation-cap). A person you take off the list
loses access at their next GitHub token rotation, about every 8 hours of use: it
ends their sessions and their API tokens, including one with no expiry. Until
then they can read what their own GitHub access allows, and they cannot start a
brief or create a token.

Sign-in runs through your own GitHub App
([github-app.md](./github-app.md#reviewer-sign-in)), and every reviewer then acts
on their own user token, bounded by the App's permissions and by what that
account can reach on GitHub. Register the App as private, owned by your
organization
([github-app.md](./github-app.md#who-can-install-and-sign-in)).

If your company has an identity provider, we recommend also deciding who signs in
at the network. An identity-aware proxy that exempts `/api/*` but keeps
`/api/auth/*` behind it admits only the people it lets through to sign in, and
still lets the webhook and the CLI reach the API
([cli.md](./cli.md#idp--sso-proxies-exempt-api)).

Signed out, a visitor sees one sign-in page and a Sign in button. Without a
session every `/api` route answers 401, apart from the webhook, the sign-in
redirect and its callback, and sign-out. `/healthz` and `/readyz` answer
without a session and carry no data
([observability.md](./observability.md#health-endpoints)).

## What each user can see

| User | How they reach a pull request | What they read | What they write |
| --- | --- | --- | --- |
| Reviewer on an Installation | The App is installed on the repository, and their own token can read it. | The briefs of that repository's pull requests and each pull request's conversation. Every read checks their own token first, then finds the Installation that holds the repository. | Comments, replies and reviews on their own token, authored as them. A Trigger approval or a regenerate needs push access; deleting a pull request's data needs admin. Their Review Session is theirs alone. |
| Reviewer with a URL pull request | They may start a brief, as above, and paste a pull request URL on Home, for a repository in no Installation. | The brief the worker built with their own Grant. Their Inbox lists the pull requests they pasted, and any other reviewer whose token can read the repository opens the same stored brief. | Comments and reviews on their own token, and deleting their own URL row. No regenerate and no image attachments; the worker never writes to GitHub for a URL pull request, so it gets no Entry comment. |
| Operator | Their GitHub user id is in the instance config's `operators` list ([generators.md](./generators.md#operators)). | Everything their reviewer access gives them, plus instance-wide state no repository scopes: today's started runs against the daily cap, on the Instance tab of Settings or with `mergebrief spend`. | Nothing beyond their reviewer access. |

The Operator role grants no repository reach. Owning the URL fallback token
does not make anyone an Operator; only the `operators` list does. Every
signed-in user sees the version notice
([operations.md](./operations.md#how-you-learn-a-release-exists)).

Whoever controls the host sits outside this model. `.env` holds every
credential, and anyone who can write to the database can insert a session
that acts as another user ([operations.md](./operations.md#tokens-at-rest)).
The audit log has no screen and no API route: you read it from the database
([operations.md](./operations.md#the-audit-log)).

## Trust boundaries

### The webhook route

`POST /api/webhooks/github` takes no session and no token. The HMAC-SHA256
signature over the raw body, keyed by `GITHUB_WEBHOOK_SECRET`, is the only
gate. The api checks it before it parses the body or touches the database; a
missing or wrong signature answers 401 and writes nothing. The Installation a
delivery acts on comes from the signed payload, never from a header. The route
caps the body at 1 MB and has no rate limit of its own, so put one in your
proxy ([compose.md](./compose.md#3-the-webhook-secret-is-the-only-gate-on-the-webhook-route)).

### The web tier

`web` is the only service meant to take outside traffic, and it holds no
credentials. `postgres` also publishes a port, bound to `127.0.0.1:5432` for
host tooling, and it keeps the default `mergebrief` credentials until you set
`POSTGRES_PASSWORD`. On a host other people log in to, drop that mapping or
set a strong password
([compose.md](./compose.md#1-postgres-credentials)).

Compose gives `web` no `env_file`: it gets `PUBLIC_BASE_URL`,
`MERGEBRIEF_API_ORIGIN` and six tracing variables, and never the OTLP
headers. It forwards `/api/*` to `api` as it arrived, minus the hop headers
and the caller-address claims `Forwarded`, `X-Forwarded-For` and
`X-Real-IP`; the api records no caller address. It answers 403 to any request
whose `Host` is not `PUBLIC_BASE_URL`'s hostname, `localhost`, a `*.localhost`
name or a bare IP address.

`api` publishes no port. It holds every credential and the database
connection, and only `web` reaches it, over the compose network.

### Rate limiting

Apart from the per-reviewer
[attachment upload quota](./attachments.md#upload-quota), the API has no
built-in rate limiting, the webhook route included. Rate limit at your reverse
proxy. [compose.md](./compose.md#rate-limit-the-webhook-route-at-your-proxy)
says how to scope a limit to the webhook route and size it for GitHub's
bursts.

### Sessions and tokens

- **Sign-in.** The OAuth start sets two `__Host-` cookies that live ten
  minutes: `__Host-mergebrief_oauth_state` holds a random state nonce, and
  `__Host-mergebrief_oauth_return` holds the page to return to after sign-in.
  The callback refuses a state that does not match the cookie.
- **Session cookie.** `__Host-mergebrief_session` is `HttpOnly`, `Secure`,
  `SameSite=Lax` and `Path=/`. It carries a random value, and the database
  keeps only its SHA-256 hash. A session expires when its GitHub refresh token
  does, and each token refresh moves that date forward.
- **Sign out everywhere** deletes every browser session you hold. It does not
  touch your API tokens: each keeps working until you revoke it or it
  expires.
- **Same-origin writes.** A cookie request that changes state must prove it
  came from this instance: it carries `Sec-Fetch-Site: same-origin`, or an
  `Origin` equal to `PUBLIC_BASE_URL`'s origin. Anything else answers 403.
- **API tokens.** An API token starts with `mergebrief_`, is stored as a
  SHA-256 hash, and carries the access level chosen when it was created. The
  `/api/auth/*` routes ignore it, so a stolen token cannot create another token
  or sign its owner out ([cli.md](./cli.md#creating-a-token-operator-walkthrough)).
  The CLI stores its token in plain text in
  `~/.config/mergebrief/config.json` (under `$XDG_CONFIG_HOME` when set), a
  file only its owner can read (mode `0600`).
- **GitHub tokens.** Each user's access and refresh token pair is the one
  secret MergeBrief stores, encrypted under the session key
  ([operations.md](./operations.md#tokens-at-rest)). A user who revokes the
  App on github.com loses every session, API token and stored GitHub token
  here ([github-app.md](./github-app.md#events-to-subscribe-to)).

### If an account or token leaks

Do all three steps. Each one closes a different door.

1. **Sign out everywhere.** In MergeBrief, open the account menu, choose
   **Sign out**, then **Everywhere**. This ends every browser session.
2. **Revoke every API token.** Open `/settings` on your instance and choose
   **Revoke** on each token under **API tokens**. Sign-out does not reach
   them.
3. **Revoke the App's authorization on github.com.** Go to GitHub's
   **Settings → Applications → Authorized GitHub Apps** and revoke your
   MergeBrief App. GitHub tells MergeBrief, which then deletes every session,
   API token and stored GitHub token you held.

To check a leaked token is dead, paste it at the prompt and call the API with
it. A revoked token answers `401`; a live one answers `200`:

```sh
read -rs LEAKED_TOKEN
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $LEAKED_TOKEN" \
  https://mergebrief.your-org.example/api/version
unset LEAKED_TOKEN
```

### The worker

The worker reads a pull request from an Installation with the App's
installation token. For a URL pull request it reads with the Grant of the
reviewer who added it: the job carries a reference to the Grant, never the token, and nothing
it does for that job writes to GitHub.

Pull request text is written by people you may not trust. The worker fences
it as data for the model, but text in a description, a diff or a ticket can
still steer what a brief says
([generators.md](./generators.md#what-stays-open)). A brief whose output
contains the value of a secret the worker holds fails as `output-secret`
instead of being stored.

### The URL fallback token

`MERGEBRIEF_URL_FALLBACK_TOKEN` is a GitHub token for URL pull requests on
repositories the App is not installed on. At boot the api and the worker ask GitHub whose token
it is. From then on:

- It serves one person, the GitHub account that owns it. Every other user
  gets the instance as if no token were set.
- It is tried only after that person's own token is denied, and only for a
  URL pull request they add and its brief.
- It reads and never writes. Comments, reviews and every other write run on
  the person's own token.
- Diff and file reads on it are limited to the commits MergeBrief recorded
  for that pull request. The file path is not limited: any file at one of
  those commits is readable.
- It never lists the repository's open pull requests, and the worker never
  reads an issue outside the pull request's repository with it.

If GitHub refuses the token at boot, it serves nobody until it is replaced and
the process restarts
([troubleshooting.md](./troubleshooting.md#github-refused-the-url-fallback-token)).

## Outbound destinations

Logs go to stdout. Nothing reports back to the MergeBrief project: the update
check is the one request toward its GitHub Releases, and it carries nothing
about your instance.

| Destination | Sent by | What is sent | How to turn it off |
| --- | --- | --- | --- |
| GitHub (`api.github.com`, `github.com`; for image attachments also `private-user-images.githubusercontent.com` and the storage host a public image redirects to, today `github-production-user-asset-6210df.s3.amazonaws.com`) | api, worker | On the App's installation token: pull request data, diffs, files, the `.mergebrief/` files, issues read as tickets and the visibility of the repository a ticket sits in, the Entry comment, image attachments, and the reads that confirm a webhook delivery. On a reviewer's own token: their reads, comments and reviews. OAuth: the code exchange, token refresh and revoke. `GET /user` for the URL fallback token's owner. | It cannot be off: GitHub is where every pull request comes from. |
| Model provider (`api.anthropic.com`, `api.openai.com/v1`, `openrouter.ai`, or `generator.baseUrl`) | worker | The pull request's title, description, base and head branch names, file list and unified diff, and the numbers and titles of its neighbours in a stack; on a revision, the previous brief and the incremental diff; for a Delta Brief, the review comments; the repository's `instructions.md` and custom attributes; the primary ticket's text; the text fetched from links in the description. `openai` and `openrouter` also check the model at boot, and `openrouter` sends `referer` and `title` when the config sets them. `openrouter` passes the request on to the upstream that serves the model, and the worker asks it for one that keeps no request data ([generators.md](./generators.md#openrouter)). A redirect from a provider is refused, never followed. | Generation needs a provider. To keep code inside your network, point `openai`'s `baseUrl` at a compatible server you run ([generators.md](./generators.md#the-six-providers)). |
| Update check (`github.com`, this project's GitHub Releases, and `release-assets.githubusercontent.com`, where the download redirects) | api | One `GET` for `version.json`, at most once an hour, with no instance id, version or count ([operations.md](./operations.md#the-update-check)). | `updateCheck.enabled: false` in the instance config, or `updateCheck.url` to fetch it from your own mirror. |
| Notion (`api.notion.com`) | worker | The integration token, the board's database id, the ticket number, and the page and block ids of the one ticket a pull request names. Only for pull requests from an Installation ([trackers.md](./trackers.md#notion)). | Remove the `notion` entries from `contextSources:` and `trackers:`. |
| Jira (`api.atlassian.com`) | worker | The account email and API token, the site's cloud id and the issue key of the one ticket a pull request names. At boot, one request that asks what the token can do. Only for pull requests from an Installation ([trackers.md](./trackers.md#jira)). | Remove the `jira` entries from `contextSources:` and `trackers:`. |
| Jira site (the configured `site`, `/_edge/tenant_info`) | worker | A plain `GET` with no credential, to look up the site's cloud id, once per worker process, at boot, and again after a lookup that failed or a cloud id Atlassian no longer knows ([trackers.md](./trackers.md#what-the-worker-asks-atlassian)). | Remove the `jira` entries from `contextSources:` and `trackers:`. |
| OTLP endpoint you configure | api, worker, web | Trace spans whose attributes are ids, counts, decision tokens, the model name and token counts. Cookies, request headers other than the host, SQL parameter values and URL query strings are not recorded; a failed query's span keeps Postgres's error message, which can quote a value ([observability.md](./observability.md#tracing)). | Off by default. Leave both endpoint variables unset, or set `OTEL_SDK_DISABLED=true`. |
| Links in a pull request description | worker | A plain `GET` from the worker to up to five http(s) links, with no credentials and no redirects followed ([trackers.md](./trackers.md#links-in-the-description)). Up to 20,000 characters of each answer go to the model. | `linkFetch.mode: off` in the instance config, or `allowlist` to name the hosts ([configuration.md](./configuration.md#linkfetch)). The worker warns at boot while the mode is `public`, and its boot line states the mode. |


The table covers the instance's own processes. A reviewer's browser also loads
avatars from `github.com`. An image in a description or a comment loads
through the API, or straight from one of the hosts GitHub serves its own
stored files from (`github.com`, and named hosts under `githubusercontent.com`
and `githubassets.com` such as `raw.` and `user-images.`). GitHub's image
relay, `camo.githubusercontent.com`, is not one of them: it fetches an image
from any host, and can fetch it again on each view. Nor is a release file on
`github.com`: GitHub counts each download where the repository's owner can
read it. An image on any other host is never loaded: the page names the host
and links the address, so that host does not learn who opened the brief or
when.

Two limits remain. A file GitHub serves is still fetched from GitHub, and
GitHub meters some of what it serves to the repository's owner: a file kept
in Git LFS counts against the owner's bandwidth, so a pull request author who
points an image at their own repository can see that it was fetched, though
not by whom. The page cannot tell such a file from a committed one before it
loads. A Mermaid diagram is the other: the diagram library can still fetch an
image or a stylesheet address the diagram itself names.

The `mergebrief` CLI asks the npm registry for
its newest version unless `MERGEBRIEF_NO_VERSION_WARNING` is set
([cli.md](./cli.md#versions)).
