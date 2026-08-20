# Self-host: the `mergebrief` CLI

How to get the CLI (and the agents it drives) talking to your deployment.
Assumes the compose stack ([compose.md](compose.md)) and the GitHub App
([github-app.md](github-app.md)) are already up.

## What the CLI needs from your deployment

The CLI is a thin client over the public HTTP API (`/api/*`) with an opaque
Bearer token. Three things must be true:

1. **The API is reachable** at the base URL you give `auth login` — the same
   origin the web app serves.
2. **`/api/*` accepts `Authorization: Bearer mergebrief_...`** end to end.
   The server side already does; the catch is usually in front of it (next
   section).
3. **A token exists** — minted in the web app, per user, per organization.

## IdP / SSO proxies: exempt `/api/*`

If your deployment sits behind an identity-aware proxy (Cloudflare Access,
oauth2-proxy, Authelia, Pomerium, …), browser sessions work but the CLI's
Bearer requests get answered with a login redirect or an HTML page. The CLI
detects this and says so (a redirect/HTML answer produces an explicit
"identity-provider proxy" error) — the fix is one rule:

> **Exempt the `/api/*` path prefix from the IdP.**

This is the SAME exemption the GitHub webhook needs
(`/api/webhooks/github`), so most deployments already have half of it. The
application enforces its own auth on every `/api/*` request (hint-free 401s;
tokens are hashed at rest and installation-bound) — the IdP adds nothing on
this path but breakage. `/api/auth/*` (login, token minting) stays
browser-only — Bearer tokens are ignored there — so if you want your IdP in
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
2. Name the token (e.g. `ci-reviewer`), pick the **organization** it binds
   to (a token is bound to exactly one installation — the tenancy boundary),
   choose an expiry (90 days default; "no expiry" is allowed — for self-host
   CI that trade-off is yours; the wrapped GitHub credential still dies
   after ~6 months idle either way).
3. Copy the token — it is shown **once**. Revoke and re-mint freely from
   the same page; `last_used_at` in the list tells you which tokens are
   live.
4. On the machine that runs the CLI:

   ```sh
   echo "mergebrief_…" | mergebrief auth login --base-url https://mergebrief.your-org.example
   ```

`mergebrief auth status --json` is the end-to-end probe: it reports
reachability, whether the token authenticates, and the server version in
one shape.

## Profiles (multiple deployments / organizations)

One profile per (deployment, organization) pair; a token binds one
organization, so spanning orgs means one profile each:

```sh
echo "$WORK_TOKEN" | mergebrief auth login --base-url https://mb.work.example --profile work
echo "$OSS_TOKEN"  | mergebrief auth login --base-url https://mb.oss.example  --profile oss
```

Resolution order per invocation: `--profile` / `MERGEBRIEF_PROFILE` → an
`owners:` match on the current repo's origin owner (add
`"owners": ["acme"]` to a profile to route `acme/*` clones automatically) →
the default profile (the first one you logged into). `MERGEBRIEF_TOKEN`
overrides the resolved profile's stored token — handy in CI where the token
lives in a secret store, not on disk.

## Agents

Point your agent at `mergebrief --agents` — the packaged guide carries the
output contract, the exit table with next-moves, and the reviewer/author
loops. A two-line `AGENTS.md` snippet for adopting repos:

```markdown
Reviews here run on MergeBrief. Run `mergebrief --agents` once and follow
that guide; always use `--json`, and name the brief span (`--base`/`--head`
from `pr <n>`'s baseSha/headSha) on every write.
```
