# GitHub App setup

The self-host backend runs as a **per-instance GitHub App**: you register your own, on your
own account/org, wired to your own deployment. There is no shared hosted App.

This doc is the canonical setup reference for both contributors and self-hosters.

## Permissions (least-privilege, exactly these four)

| Repository permission | Access | Why |
|---|---|---|
| **Contents** | Read & write | **Read** PR diffs. **Write** serves two things: GitHub's `markPullRequestReadyForReview` GraphQL mutation (the "mark ready for review" author affordance) is gated on `contents: write`, and image attachments a reviewer pastes into a comment are pushed to an orphan `mergebrief/attachments` branch ([attachments.md](attachments.md)). The App still **never writes code**: that branch holds images only, and no other branch is ever touched. |
| **Pull requests** | Read & write | Read PR data; post the one branded "brief ready" comment; also authorizes the reviewer's own review + inline comments. Also authorizes reading the primary ticket when it is a GitHub issue (`Get an issue` accepts `Pull requests: read`), so the ticket-alignment read needs no `Issues` permission; see [trackers.md](trackers.md). |
| **Metadata** | Read-only | Mandatory baseline (auto-selected). |

| Organization permission | Access | Why |
|---|---|---|
| **Members** | Read-only | Lists the teams a reviewer can `@mention` while writing a comment, reply or review. The read runs on the reviewer's own token, so a reviewer sees only the teams GitHub shows them. Without it, people are still suggested and a typed `@org/team` still reaches GitHub; only team suggestions are missing. |

> **Adding Members to an App you already registered:** GitHub asks each installation's
> organization owner to approve the new permission. Until they do, the installation keeps
> working on its old permissions and team suggestions stay empty there.

> **Why Contents is Read & write, not Read-only:**
> marking a draft PR ready via GitHub's GraphQL `markPullRequestReadyForReview` mutation returns
> `FORBIDDEN` unless the App holds `contents: write`, a quirk of GitHub's own permission
> mapping for that mutation. Image attachments are the one real push: an orphan
> `mergebrief/attachments` branch of image files, which a ruleset on `mergebrief/*` can refuse
> and a repository admin can delete from Home. If you keep Contents at Read-only, brief
> generation and reads still work, but "Mark ready for review" fails with a permission error
> (`403 github-permission`) and so does attaching an image, with the same code; a rule on
> `mergebrief/*` refusing the push is `403 attachments-disabled`. The UI names each.

**Deliberately NOT enabled:**
- **Issues**: a comment on the PR *conversation* timeline uses the issue-comments endpoint,
  but for a pull request that endpoint is authorized by `Pull requests: write`, so `Issues` is
  redundant.
- **Checks**: posting brief status as a Check Run is deferred. Un-parking it
  would need `Checks: write` and is a design change, not a config toggle.
- Any other write scope.

## Events to subscribe to

On the registration "what events would you like to subscribe to?" screen, check only:

- **Pull request**: the trigger for brief generation (open + every push/synchronize).
- **Pull request review**: a reviewer submitting → advances their Checkpoint.

**`installation`, `installation_repositories` and `github_app_authorization` are NOT on
that list, and don't need to be.** GitHub delivers those to every App automatically
(install/uninstall, repos added or removed, a user revoking the App), regardless of
subscription. The checkbox list only covers optional per-resource events. So two checkboxes
is the complete set.

When a user revokes MergeBrief from their GitHub settings, `github_app_authorization` arrives
and MergeBrief deletes every sign-in session, API token and stored GitHub credential that user
held, and records it in the audit log. They sign in again to come back.

## Reviewer sign-in

A reviewer signs in with GitHub through this same App, and their review, comments and replies
are authored **as them**, on their own user token. That token carries no OAuth scopes: GitHub
bounds it by the App permissions in the tables above **and** by what the reviewer can reach
on GitHub themselves. So the tables are the whole list. A permission left off here is
missing for reviewers too: without **Members**, nobody here can list teams to mention.

Sign-in needs one App setting: **Expire user authorization tokens** (under
"Identifying and authorizing users") must stay checked. GitHub checks it by
default. With it off, GitHub issues no refresh token and every sign-in
fails. The api logs that failure only at `debug`, as `sign-in refused:
GitHub rejected the code`, so check this setting first when sign-in fails
for everyone.

Signing out, "sign out everywhere" and revoking a MergeBrief CLI token revoke the reviewer's
GitHub token at GitHub, through the App's client id and secret, once no session and no live
CLI token still uses that sign-in. A refused or unanswered revoke is logged as
`grant.revoke.fail` and the sign-out or token revoke completes anyway. MergeBrief never uses
the stored copy again; it is deleted at once, or with the last revoked or expired CLI token
that still lists it.

## Webhook

- During registration you can **leave "Active" unchecked** until there's a receiver to point
  at. A URL set with nothing behind it just collects failed deliveries, and local tunnel
  URLs are ephemeral anyway.
- **GitHub rejects `localhost` / private URLs** ("not reachable over the public Internet"):
  the webhook endpoint must be publicly reachable. You never point GitHub straight at
  localhost; a tunnel service gives you a public URL that forwards to your local port. So when
  registering now with no receiver, just leave the webhook **inactive** rather than trying a
  localhost URL.
- **ngrok is the recommended tunnel** (`ngrok http PORT`). Set both
  the App's **Webhook URL** and the OAuth callback to the ngrok public URL, and set a
  **Webhook secret** (`openssl rand -hex 32`; boot refuses one under 32 characters). The callback path is
  `<PUBLIC_BASE_URL>/api/auth/github/callback`, one namespace with the webhook receiver
  (`/api/webhooks/github`), so both App URLs share the `/api` shape.
  > **Upgrading an older App registration:** the callback path moved from
  > `/auth/github/callback` to `/api/auth/github/callback`. Apps registered against the
  > older path must update their **Callback URL** in the GitHub App settings or login
  > breaks with a `redirect_uri` mismatch.
  - Why ngrok over `gh webhook forward`: *two* endpoints must be publicly reachable:
    the webhook receiver **and** the OAuth callback (GitHub redirects the browser there, so it
    can't be localhost). One ngrok tunnel serves both; `gh webhook forward` covers webhooks
    only, so you'd need a tunnel anyway.
  - Bonus: ngrok's local inspector (`http://127.0.0.1:4040`) shows, and **replays**, every
    webhook payload, so you can re-fire one real event at your handler while debugging instead
    of opening PRs repeatedly. Works even before a receiver exists.
  - Free tunnel URLs are ephemeral (they change on restart), so expect to re-paste; a paid
    static domain avoids that for sustained work.
- **Running the loop end-to-end:** see [`../dev/webhook-loop.md`](../dev/webhook-loop.md)
  for the full local recipe: `docker compose up -d postgres`, the `apps/api/.env` vars, `pnpm dev`,
  the ngrok URL to set, and how to verify the `pull_requests` + `graphile_worker.jobs` rows.

## Identity / secrets (all env, never the DB or repo)

After creating the App, collect and store in your deployment's env / secret manager:

- **App ID**
- **Private key** (`.pem`, "Generate a private key")
- **Webhook secret** (the value you generated above)
- **OAuth Client ID + client secret** (for reviewer login)

None of these ever go in the database or the repository. The one *dynamic* secret (the
reviewer token) is encrypted at rest by the persistence layer, see
[Tokens at rest](./operations.md#tokens-at-rest) for what that binding stops and how to
rotate its key; every static secret stays in env.

## Installing across multiple repos

Registering the App and *installing* it are two steps. At install time GitHub asks **"All
repositories"** or **"Only select repositories"**. Pick as many as you like, and change the
set later under **Settings → Applications → Installed GitHub Apps → Configure**.

**One install = one `installation_id` = one tenant.** Installing on several repos under one
account is a *single* installation covering them all; every row is scoped by
`(installation_id, repo)`, so per-repo data is cleanly separated while living under that one
tenant. A different account/org installing the App is a separate tenant.

## Dev vs. production registration

- **Dev:** register manually via the UI (**Settings → Developer settings → GitHub
  Apps → New GitHub App**), "Only on this account".
- **Production (self-hosters, later):** the intended path is the **App-manifest flow**: the
  instance generates the manifest, the operator confirms on GitHub, and identity is handed
  back automatically. Until that ships, the manual UI steps above are the reference.
