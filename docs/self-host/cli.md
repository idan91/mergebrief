# Self-host: the `mergebrief` CLI

How to get the CLI (and the agents it drives) talking to your deployment.
Assumes the compose stack ([compose.md](compose.md)) and the GitHub App
([github-app.md](github-app.md)) are already up.

## What the CLI needs from your deployment

The CLI is a thin client over the public HTTP API (`/api/*`) with an opaque
Bearer token. Three things must be true:

1. **The API is reachable** at the base URL you give `auth login`, the same
   origin the web app serves.
2. **`/api/*` accepts `Authorization: Bearer mergebrief_...`** end to end.
   The server side already does; the catch is usually in front of it (next
   section).
3. **A token exists**, minted in the web app, per user, with the scope you
   chose for it.

## IdP / SSO proxies: exempt `/api/*`

If your deployment sits behind an identity-aware proxy (Cloudflare Access,
oauth2-proxy, Authelia, Pomerium, …), browser sessions work but the CLI's
Bearer requests get answered with a login redirect or an HTML page. The CLI
detects this and says so (a redirect/HTML answer produces an explicit
"identity-provider proxy" error). The fix is one rule:

> **Exempt the `/api/*` path prefix from the IdP.**

This is the SAME exemption the GitHub webhook needs
(`/api/webhooks/github`), so most deployments already have half of it. The
application enforces its own auth on every `/api/*` request (hint-free 401s;
tokens are hashed at rest and limited to the scope chosen at mint), so the IdP adds nothing on
this path but breakage. `/api/auth/*` (login, token minting) stays
browser-only (Bearer tokens are ignored there), so if you want your IdP in
front of auth management, scope the IdP exemption to exclude `/api/auth/*`
rather than exempting all of `/api/*`.

If your proxy can inject static headers and you keep it in the path anyway,
per-profile `headers` in the CLI config are the escape hatch:

```json
{
  "profiles": {
    "work": {
      "baseUrl": "https://mergebrief.internal.example",
      "token": "mergebrief_…",
      "headers": { "CF-Access-Client-Id": "…", "CF-Access-Client-Secret": "…" }
    }
  }
}
```

## Minting a token (operator walkthrough)

1. Sign in to the web app with GitHub, open **`/settings`**.
2. Name the token (e.g. `ci-reviewer`), pick its **scope**, and choose an
   expiry (90 days default; "no expiry" is allowed; for self-host
   CI that trade-off is yours; the wrapped GitHub credential still dies
   after ~6 months idle either way). A token binds no organization or
   installation: it acts as you, on your GitHub sign-in, so it reaches the
   repositories you reach in the web app.

   The scope is required and fixed for the token's life; a narrower or
   wider one is a new token. Each level includes the one before it:

   | Scope | In the form | Allows |
   | --- | --- | --- |
   | `read` | Read only | every read command |
   | `private-write` | Read and review in MergeBrief | review state kept in MergeBrief: `draft create` and `update`, `chunk-read`, `reclassify`, `outcome`, `generate` |
   | `external-write` | Read, review, and post to GitHub | anything that writes to GitHub: `submit`, `reply`, `thread resolve` and `thread unresolve`, `ready`, `draft attach` |

   A command above its token's scope answers `403 scope-exceeded`. Pick the
   least a token needs. No scope reaches `draft reanchor`, `draft delete` or
   `risk dismiss|address|reopen`: they need the signed-in browser session and
   answer `403 human-only` to any token.
3. Copy the token: it is shown **once**. Revoke and re-mint freely from
   the same page; `last_used_at` in the list tells you which tokens are
   live.
4. On the machine that runs the CLI:

   ```sh
   echo "mergebrief_…" | mergebrief auth login --base-url https://mergebrief.your-org.example
   ```

`mergebrief auth status --json` is the end-to-end probe: it reports
reachability, whether the token authenticates, and the server version in
one shape ([Versions](#versions) lists the version fields).

## Profiles (multiple deployments)

One profile per deployment. A token is not tied to an organization, so one
profile covers every organization you reach on that deployment:

```sh
echo "$WORK_TOKEN" | mergebrief auth login --base-url https://mb.work.example --profile work
echo "$OSS_TOKEN"  | mergebrief auth login --base-url https://mb.oss.example  --profile oss
```

Resolution order per invocation: `--profile` / `MERGEBRIEF_PROFILE` → an
`owners:` match on the current repo's origin owner (add
`"owners": ["acme"]` to a profile to route `acme/*` clones automatically) →
the default profile (the first one you logged into). `MERGEBRIEF_TOKEN`
overrides the resolved profile's stored token, handy in CI where the token
lives in a secret store, not on disk.

## Versions

`mergebrief --version` prints the CLI's version. A CLI built from source
reports `0.0.0`, and a server built from source reports `dev`. Either one
is a dev build: it never checks for a newer version, never compares, and
never warns. `mergebrief@next` is the most recent release candidate, not for
production; a dist-tag never moves on its own, so `next` can be older than
`latest` once the release it previewed is out.

### What the CLI prints when versions differ

Three kinds of line, all on stderr, in human and `--json` mode alike. None
changes the exit code, and none refuses a command.

| Case | On a successful run | On a failed run |
| --- | --- | --- |
| A newer mergebrief exists on npm, any size | the update line, once per answer | nothing extra |
| CLI and server differ by a major, either direction | a warning on every run | the error line gains `[server 1.4.0, cli 2.0.0, major gap]` |
| CLI and server differ by minor or patch | nothing | the error line gains `[server 1.4.0, cli 1.6.0]` |
| Either side is a dev build | nothing | no suffix |

The lines, for a server on 1.4.0:

```text
A new version of mergebrief is available: 1.2.0 → 1.6.0. To update, run: npm i -g mergebrief@1.6.0
mergebrief 1.2.0 is behind this server (2.0.0): some commands may fail. To update, run: npm i -g mergebrief@2.0.0
This server (1.4.0) is behind mergebrief 2.0.0: some commands may not exist there. To match it, run: npx mergebrief@1.4.0
request failed (HTTP 404) [server 1.4.0, cli 1.6.0]
```

The first is the update line; the second and third are the major warning
for a CLI behind the server and ahead of it; the last is a failed run's one
error line with its suffix. Every version prints as plain
`major.minor.patch`.

The update line and the CLI-behind warning suggest `npx mergebrief@x.y.z`
when the CLI runs under `npx` (npm sets `npm_command=exec`), and
`npm i -g mergebrief@x.y.z` otherwise. The server-behind warning always
suggests `npx mergebrief@<server version>`, which runs a matching CLI
without touching a global install.

### How the CLI knows

- **The server's version** comes from the `MergeBrief-Version` header on
  the first response of the run, so the comparison costs no extra request.
  The API sets the header on every signed-in `/api/*` response, and never on
  a 401, on `/healthz` or on `/readyz`: an unauthenticated caller learns
  nothing the signed-in `GET /api/version` would not tell it.
- **A newer CLI** comes from npm. The CLI asks
  `https://registry.npmjs.org/mergebrief/latest` beside the command it is
  running, and keeps the answer only if it arrived by the time the command
  finished, within 2 seconds; otherwise the request is dropped, so a slow
  registry never delays a command. The answer lands in
  `update-check.json` under `$XDG_CACHE_HOME/mergebrief/` (or
  `~/.cache/mergebrief/`), and the update line prints once, on a later run,
  never during the check. The CLI asks only when the cached answer is
  missing or more than a day old, and only an answer that arrived in time
  is written, so a dropped or failed check leaves the cache as it was and
  the next run asks again. The line prints after the next successful
  command, once per answer; a failed run keeps its one error line and
  leaves the update line for the run after. The request carries nothing
  about your instance, and a failed check is silent. A network that reaches
  your server but blocks `registry.npmjs.org` never sees the update line,
  and sees the dropped request on every run; `MERGEBRIEF_NO_VERSION_WARNING`
  stops it.

### Turning the warnings off

`MERGEBRIEF_NO_VERSION_WARNING`, set to any value, silences the update line
and the major warning, and the CLI then never asks npm. The failure suffix
stays: it is part of the error message. Nothing is gated on CI or a TTY. An agent in CI hitting a major
gap is the reader who most needs the warning, and the update line stays
quiet there anyway, because a fresh container never has a cached check to
print.

The instance's own `MERGEBRIEF_UPDATE_CHECK=false`
([operations.md](./operations.md#the-update-check)) does not silence the
CLI: the update line is the CLI asking npm from your machine, and
`MERGEBRIEF_NO_VERSION_WARNING` is its opt-out.

### `auth status`

`mergebrief auth status` prints the server's version, the CLI's version
and the newest release the server knows of on its second line:

```text
profile default → https://mb.example
token: configured · authenticated · server 1.4.0 · cli 1.2.0 · latest 1.6.0
```

It is the one place a CLI user sees that the server itself is behind.
`--json` carries the version fields beside `profile`, `baseUrl`,
`tokenConfigured`, `server.reachable` and `server.authenticated`:

| Field | What it holds |
| --- | --- |
| `cli.version` | this CLI's version |
| `server.version` | the server's version, `null` when the server could not be reached or the token did not authenticate |
| `server.latest` | the newest release the server's update check has seen |
| `server.releaseNotesUrl` | that release's notes |
| `server.checkedAt` | when the server last checked successfully |
| `server.breaking` | `true` when a release between the server's version and `latest` is a breaking release |
| `server.security` | `true` when a release in that gap fixes a vulnerability |

The five fields after `server.version` appear only when the server sent
them: a server whose update check is off, has not succeeded yet, or
predates the check yields `server.version` alone.

### `npx` or a global install

`npx mergebrief` fetches the package on demand and usually runs the newest
release; against an older server a major apart, the major warning names
the version to pin, `npx mergebrief@1.4.0`. A global install
(`npm i -g mergebrief`) stays on the version you installed until you update
it, and the update line tells you about once a day, on the run after each
daily check, while a newer one exists.

When the newest release is a major ahead of your server, the two lines
point opposite ways across days: the update line offers 2.0.0, and once you
take it the major warning asks you to match 1.4.0. They never print in the
same run. Upgrading the server ends it.

## Local generation and the primary ticket

The `categorize` and `delta` dev CLIs (`tools/categorizer`) resolve the PR's
primary ticket from the working tree's `.mergebrief/settings.yaml`
(`trackers:` list, see [repo-config.md](repo-config.md)). Tracker reads use
the same env as the worker (`gh auth` for GitHub Issues, `NOTION_TOKEN` for
Notion); `--context <file>` supplies the ticket text directly when neither
is available. Details in `tools/categorizer/README.md`.

## Attaching an image to a draft

`mergebrief draft attach <number> <file>` pushes a PNG, JPEG, GIF or WebP
file to the repository's `mergebrief/attachments` branch on the App's token
and prints its URL ([attachments.md](attachments.md)). Add
`--draft <id> --base <sha> --head <sha>` to also append the image to that
held draft comment; `--draft` without the brief span's `--base` and
`--head` exits 2. It needs an `external-write` token, and the App installed
on the repository.

Deleting that branch has no CLI command on purpose: it breaks images in
comments already on GitHub, so the API takes the confirmation from a browser
session only (`403 human-only` for a token). A repository admin does it from
Home.

## Agents

The agent guide ships as the `mergebrief` skill (`skills/mergebrief` in the
repository). Install it into a coding agent with skills.sh:

```bash
npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>
```

The skill carries the review workflow, the authority policy, and the wire
contract; the CLI's `--help` owns flags and payloads. `mergebrief --agents`
now only prints where the guide moved.
