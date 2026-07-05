# GitHub App setup

The self-host backend runs as a **per-instance GitHub App** — you register your own, on your
own account/org, wired to your own deployment. There is no shared hosted App.

> **Status (2026-07-05):** the webhook receiver and reviewer login that consume this App are
> **not built yet** (they land in BRIEF-2 / P4 workstream 2). You can register the App now to
> develop against or to inspect real webhook payloads, but nothing consumes its events until
> BRIEF-2 ships. This doc is the canonical setup reference for both contributors and eventual
> self-hosters; the **decision** rationale lives in
> [ADR 0016](../adr/0016-github-app-auth-and-trust-tenancy-boundary.md).

## Permissions (least-privilege — exactly these three)

| Repository permission | Access | Why |
|---|---|---|
| **Contents** | Read-only | Read PR diffs. The App never writes code. |
| **Pull requests** | Read & write | Read PR data; post the one branded "brief ready" comment; also authorizes the reviewer's own review + inline comments. |
| **Metadata** | Read-only | Mandatory baseline (auto-selected). |

**Deliberately NOT enabled:**
- **Issues** — a comment on the PR *conversation* timeline uses the issue-comments endpoint,
  but for a pull request that endpoint is authorized by `Pull requests: write`, so `Issues` is
  redundant.
- **Checks** — posting brief status as a Check Run is deferred (ADR 0016 #3). Un-parking it
  would need `Checks: write` and is an ADR amendment, not a config toggle.
- Any other write scope.

## Events to subscribe to

On the registration "what events would you like to subscribe to?" screen, check only:

- **Pull request** — the trigger for brief generation (open + every push/synchronize).
- **Pull request review** — a reviewer submitting → advances their Checkpoint.

**`installation` and `installation_repositories` are NOT on that list — and don't need to
be.** GitHub delivers those to every App automatically (install/uninstall, repos added or
removed), regardless of subscription. The checkbox list only covers optional per-resource
events. So two checkboxes is the complete set.

## Reviewer OAuth (a separate axis — not on the App registration page)

The App's *installation* permissions above govern what the **App itself** does (in practice:
posting the single branded comment). A reviewer's actual review + inline comments are authored
**as the human, via their OAuth user token** — a separate grant.

OAuth scopes are requested in code at login time (BRIEF-2), **not** configured on the
registration form. The reviewer grant needs repo read access so the tool can enforce the
per-read authorization gate (ADR 0016 #5) and so a submitted review lands natively as the
reviewer. Nothing to toggle now — flagged so "where do I set reviewer permissions?" has an
answer: it's code, not this form.

## Webhook

- During registration you can **leave "Active" unchecked** until there's a receiver to point
  at (i.e. until BRIEF-2). A URL set now would just collect failed deliveries, and local tunnel
  URLs are ephemeral anyway.
- **GitHub rejects `localhost` / private URLs** ("not reachable over the public Internet") —
  the webhook endpoint must be publicly reachable. You never point GitHub straight at
  localhost; a tunnel service gives you a public URL that forwards to your local port. So when
  registering now with no receiver, just leave the webhook **inactive** rather than trying a
  localhost URL.
- When developing BRIEF-2: **ngrok is the recommended tunnel** (`ngrok http PORT`). Set both
  the App's **Webhook URL** and the OAuth callback to the ngrok public URL, and set a
  **Webhook secret** (`openssl rand -hex 32`).
  - Why ngrok over `gh webhook forward`: BRIEF-2 needs *two* endpoints publicly reachable —
    the webhook receiver **and** the OAuth callback (GitHub redirects the browser there, so it
    can't be localhost). One ngrok tunnel serves both; `gh webhook forward` covers webhooks
    only, so you'd need a tunnel anyway.
  - Bonus: ngrok's local inspector (`http://127.0.0.1:4040`) shows — and **replays** — every
    webhook payload, so you can re-fire one real event at your handler while debugging instead
    of opening PRs repeatedly. Works even before a receiver exists.
  - Free tunnel URLs are ephemeral (they change on restart), so expect to re-paste; a paid
    static domain avoids that for sustained work.
- **Running the loop end-to-end (BRIEF-2):** see [`../dev/webhook-loop.md`](../dev/webhook-loop.md)
  for the full local recipe — `docker compose up -d postgres`, the `apps/web/.env` vars, `pnpm dev`,
  the ngrok URL to set, and how to verify the `pull_requests` + `graphile_worker.jobs` rows. That's
  also the fixture-capture step for PR A's parser tests.

## Identity / secrets (all env, never the DB or repo — ADR 0016 #7)

After creating the App, collect and store in your deployment's env / secret manager:

- **App ID**
- **Private key** (`.pem`, "Generate a private key")
- **Webhook secret** (the value you generated above)
- **OAuth Client ID + client secret** (for reviewer login)

None of these ever go in the database or the repository. The one *dynamic* secret (the
reviewer token) is encrypted at rest by the persistence layer; every static secret stays in
env.

## Installing across multiple repos

Registering the App and *installing* it are two steps. At install time GitHub asks **"All
repositories"** or **"Only select repositories"** — pick as many as you like, and change the
set later under **Settings → Applications → Installed GitHub Apps → Configure**.

**One install = one `installation_id` = one tenant.** Installing on several repos under one
account is a *single* installation covering them all; every row is scoped by
`(installation_id, repo)`, so per-repo data is cleanly separated while living under that one
tenant. A different account/org installing the App is a separate tenant. (ADR 0016 #6.)

## Dev vs. production registration

- **Dev (now):** register manually via the UI (**Settings → Developer settings → GitHub
  Apps → New GitHub App**), "Only on this account".
- **Production (self-hosters, later):** the intended path is the **App-manifest flow** — the
  instance generates the manifest, the operator confirms on GitHub, and identity is handed
  back automatically (ADR 0016 #1). BRIEF-2 will provide this; until then the manual UI steps
  above are the reference.
