# GitHub App setup

The self-host backend runs as a **per-instance GitHub App**: you register your own, on your
own account/org, wired to your own deployment. There is no shared hosted App.

This doc is the canonical setup reference for both contributors and self-hosters.

## Permissions (least-privilege, exactly these five)

| Repository permission | Access | Why |
|---|---|---|
| **Contents** | Read & write | **Read** PR diffs. **Write** serves two things: GitHub's `markPullRequestReadyForReview` GraphQL mutation (the "mark ready for review" author affordance) is gated on `contents: write`, and image attachments a reviewer pastes into a comment are pushed to an orphan `mergebrief/attachments` branch ([attachments.md](attachments.md)). The App still **never writes code**: that branch holds images only, and no other branch is ever touched. |
| **Pull requests** | Read & write | Read PR data; post the one branded "brief ready" comment; also authorizes the reviewer's own review + inline comments. |
| **Metadata** | Read-only | Mandatory baseline (auto-selected). |
| **Issues** | Read-only | Reads the issue a pull request names as its ticket ([trackers.md](./trackers.md#github-issues)). |

| Organization permission | Access | Why |
|---|---|---|
| **Members** | Read-only | Lists the teams a reviewer can `@mention` while writing a comment, reply or review. The read runs on the reviewer's own token, so a reviewer sees only the teams GitHub shows them. Without it, people are still suggested and a typed `@org/team` still reaches GitHub; only team suggestions are missing. Review Checkpoints and [who triggers a brief](#who-triggers-a-brief) do not depend on it: a private member's write access is read through Metadata. |

> **Adding Members to an App you already registered:** GitHub asks each installation's
> organization owner to approve the new permission. Until they do, the installation keeps
> working on its old permissions and team suggestions stay empty there.

> **Adding Issues to an App you already registered:** GitHub asks for the same approval. Until
> then, a GitHub ticket reads as refused on the brief, and generation continues without it.

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
- **Issues: write**: a comment on the PR *conversation* timeline uses the issue-comments endpoint,
  but for a pull request that endpoint is authorized by `Pull requests: write`, so write is
  redundant.
- **Checks**: posting brief status as a Check Run is deferred. Un-parking it
  would need `Checks: write` and is a design change, not a config toggle.
- Any other write scope.

## Events to subscribe to

On the registration "what events would you like to subscribe to?" screen, check only:

- **Pull request**: the trigger for brief generation (open + every push/synchronize), for an
  author on the team; see [Who triggers a brief](#who-triggers-a-brief).
- **Pull request review**: a reviewer submitting → queues a regeneration, and advances
  their Checkpoint when the reviewer is on the team. On a private (not internal) repository every
  reviewer counts. On a public or internal repository the owner, organization members and
  collaborators count;
  anyone else, such as a private organization member that GitHub reports as a contributor,
  counts only with write access, which one read of their repository permission (covered by
  Metadata) settles. A read, triage or failed answer sets no Checkpoint.

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

Signing out, "sign out everywhere" and revoking a MergeBrief API token revoke the reviewer's
GitHub token at GitHub, through the App's client id and secret, once no session and no live
API token still uses that sign-in. A refused or unanswered revoke is logged as
`grant.revoke.fail` and the sign-out or token revoke completes anyway. MergeBrief never uses
the stored copy again; it is deleted at once, or with the last revoked or expired API token
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
  - Why ngrok over `gh webhook forward`: GitHub's servers deliver the webhook, so the
    receiver needs a public URL. The OAuth callback is a browser redirect and works on
    `localhost`, but one tunnel serving both keeps `PUBLIC_BASE_URL` to a single origin;
    `gh webhook forward` covers webhooks only.
  - Bonus: ngrok's local inspector (`http://127.0.0.1:4040`) shows, and **replays**, every
    webhook payload, so you can re-fire one real event at your handler while debugging instead
    of opening PRs repeatedly. Works even before a receiver exists.
  - Free tunnel URLs are ephemeral (they change on restart), so expect to re-paste; a paid
    static domain avoids that for sustained work.
- **Running the loop end-to-end:** see [the local webhook loop in `CONTRIBUTING.md`](../../CONTRIBUTING.md#local-webhook-loop)
  for the full local recipe: `docker compose up -d postgres`, the `.env` vars, `pnpm dev`,
  the ngrok URL to set, and how to verify the `pull_requests` + `graphile_worker.jobs` rows.

## Who triggers a brief

A push generates a brief at once only when the PR's author is on the repository's team, by the
same rule a reviewer's Checkpoint uses. MergeBrief reads it from the delivery's
`author_association`, GitHub's own label for how the author relates to the repository:

- **A private (not internal) repository:** every author counts, since only invited people see it.
- **A public or internal repository:** `OWNER` (owns the repository), `MEMBER` (belongs to the
  organization that owns it) and `COLLABORATOR` (invited to collaborate) count at once.
- **Anyone else:** `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN`, `NONE`,
  or no association at all. One read of their repository permission settles it, covered by
  Metadata: `write` or `admin` counts (GitHub reports `maintain` as `write`); `read`, `triage`
  (reported as `read`), and a read that fails or times out do not. A private organization member
  that GitHub reports as a contributor counts here once they hold write access.

Any other author's PR waits: each head shows as awaiting a trigger, and nothing is spent until
someone with push access starts the first brief from MergeBrief. That approval holds for the
PR, so every later push generates as usual. An author promoted onto the team triggers normally
from their next push. A later event whose read fails leaves a head that already
triggered as it is.

A bot author is decided separately, by the repository's `trustedBots` list in
`.mergebrief/settings.yaml` ([repo-config.md](repo-config.md)). A push that an unmet trigger
condition holds waits for that condition before any of this applies.

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

## Who can install and sign in

GitHub's "Where can this GitHub App be installed?" setting decides more than the
install page:

| Registered as | Who can install it | Who can authorize it |
| --- | --- | --- |
| Only on this account, owned by an organization | That organization | Its members |
| Only on this account, owned by a person | That person's account | GitHub's docs do not say |
| Any account | Anyone | Anyone |

Pick the first. The instance answers to its own list either way
([who may start a brief](./generators.md#who-may-start-a-brief)): installing the
App lets nobody in and starts no brief until the account is listed. A stranger's
install on an "Any account" App spends nothing.

## Dev vs. production registration

- **Dev:** register manually via the UI (**Settings → Developer settings → GitHub
  Apps → New GitHub App**), "Only on this account".
- **Production:** register the same way; the manual UI steps above are the reference.

## Logo

A new App shows GitHub's generated identicon until you upload a logo. Use
[`github-app-logo.png`](../media/github-app-logo.png), a 512px PNG of the MergeBrief mark in
vermilion on the app's near-black ground. Its SVG source sits in the same folder.

<img src="../media/github-app-logo.png" alt="The MergeBrief GitHub App logo: the vermilion mark on a near-black square." width="128">

1. Open the App's settings: **Settings → Developer settings → GitHub Apps**, then **Edit**
   beside the App. For an App an organization owns, start from that organization's
   **Settings**.
2. Under **Display information**, click **Upload a logo** and pick `github-app-logo.png`.
   Keep the whole square when GitHub offers a crop, then click **Set new avatar**.
3. Under **Badge background color**, which appears once a logo is uploaded, enter `#020203`,
   the logo's own ground, so the badge shows no edge around it.

The App-manifest flow has no logo field, so this upload stays a manual step.

## Production registration checklist

Run through this once the instance has its public address. Each line links
to the section that explains it.

- [ ] **`PUBLIC_BASE_URL` is the `https://` origin reviewers browse.** The
      session cookie is `__Host-` prefixed and `Secure`, so over plain
      `http://` on a real hostname sign-in does not persist
      ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)).
- [ ] **Callback URL** is `PUBLIC_BASE_URL` followed by
      `/api/auth/github/callback`, character for character. The api builds
      the OAuth redirect from that value, so any difference is a
      `redirect_uri` mismatch at sign-in ([Webhook](#webhook)).
- [ ] **Webhook URL** is `PUBLIC_BASE_URL` followed by
      `/api/webhooks/github`, publicly reachable, with **Active** checked
      ([Webhook](#webhook)).
- [ ] **Webhook secret** comes from `openssl rand -hex 32`, is different
      from every other instance's, and matches `GITHUB_WEBHOOK_SECRET`.
      Boot refuses a secret under 32 characters
      ([compose.md](./compose.md#3-the-webhook-secret-is-the-only-gate-on-the-webhook-route)).
- [ ] **Expire user authorization tokens** stays checked. Without it GitHub
      issues no refresh token and every sign-in fails
      ([Reviewer sign-in](#reviewer-sign-in)).
- [ ] **Permissions** are exactly the five in
      [Permissions](#permissions-least-privilege-exactly-these-five):
      Contents and Pull requests read and write, Metadata and Issues read, and
      organization Members read.
- [ ] **Events**: only **Pull request** and **Pull request review**
      ([Events to subscribe to](#events-to-subscribe-to)).
- [ ] **Members is approved in every organization.** An organization that
      installed the App before Members was added must approve the new
      permission; until its owner does, team suggestions stay empty there.
      Any permission added after install needs the same approval: without
      Pull requests write, no Entry comment posts
      ([troubleshooting.md](./troubleshooting.md#no-entry-comment-appears)).
- [ ] **Credentials are in `.env`**, never the config file or the
      repository: `GITHUB_APP_ID`, one of `GITHUB_APP_PRIVATE_KEY` or
      `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_OAUTH_CLIENT_ID`,
      `GITHUB_OAUTH_CLIENT_SECRET` and `GITHUB_WEBHOOK_SECRET`
      ([Identity / secrets](#identity--secrets-all-env-never-the-db-or-repo)).
      Optionally `GITHUB_APP_SLUG`, so Home can link a viewer with no
      installation to the install page.
- [ ] **The App is installed** on each account and organization, with the
      repositories you want briefed
      ([Installing across multiple repos](#installing-across-multiple-repos)).
- [ ] **The logo is uploaded**, if you want one, with `#020203` as the
      badge background color ([Logo](#logo)).

Then work through
[Hardening before real exposure](./compose.md#hardening-before-real-exposure):
Postgres credentials, TLS, and a rate limit on the webhook route.
