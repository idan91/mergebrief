# Register the GitHub App

MergeBrief reads pull requests, posts its Entry comment (the one comment that links a pull request to its brief) and signs reviewers in through a GitHub App you register yourself. There is no shared App: each instance has its own.

This page walks GitHub's registration form from top to bottom, then collects the credentials and installs the App. It takes about 15 minutes. The reference sections at the end explain each setting.

## Before you start

You need the origin reviewers will browse, with no trailing slash. It becomes `PUBLIC_BASE_URL` in `.env`, and three App fields are built from it:

| Where you run it | `PUBLIC_BASE_URL` |
| --- | --- |
| A server with a domain | `https://brief.example.com`, served through a reverse proxy ([compose.md](./compose.md#2-terminate-tls-at-a-reverse-proxy)) |
| Your own machine, for a trial | The tunnel's public URL, such as `https://abc123.ngrok-free.app` ([compose.md](./compose.md#try-it-locally-through-a-tunnel)) |

GitHub delivers webhooks only to a public URL, so a local trial needs the tunnel running before you register.

Generate the webhook secret now and keep the output for the App form and for `.env`:

```sh
openssl rand -hex 32
```

## Register the App

### Open the registration form

- For an App your organization owns (recommended): `https://github.com/organizations/<org>/settings/apps/new`. You need to be an owner of the organization, or a GitHub App manager in it.
- For an App on your personal account: `https://github.com/settings/apps/new`.

Both open GitHub's **Register new GitHub App** form. The same form is under **Settings**, **Developer settings**, **GitHub Apps**, **New GitHub App**.

### Name the App and set the homepage

1. **GitHub App name**: any name GitHub accepts, such as `MergeBrief Acme`. GitHub turns it into the App's slug (`mergebrief-acme`), which you can set later as `GITHUB_APP_SLUG`.
2. **Description**: optional.
3. **Homepage URL**: your `PUBLIC_BASE_URL`.

### Set the callback URL and sign-in options

Under **Identifying and authorizing users**:

1. **Callback URL**: your `PUBLIC_BASE_URL` followed by `/api/auth/github/callback`, such as `https://brief.example.com/api/auth/github/callback`. It must match character for character: the api builds the redirect from `PUBLIC_BASE_URL`, and any difference is a `redirect_uri` error at sign-in.
2. **Expire user authorization tokens**: leave it checked. With it off, GitHub issues no refresh token and every sign-in fails.
3. **Request user authorization (OAuth) during installation**: leave it unchecked. People sign in from MergeBrief's own sign-in button.
4. **Enable Device Flow**: leave it unchecked. MergeBrief does not use it.

### Leave the setup URL empty

Under **Post installation**, leave **Setup URL** empty and **Redirect on update** unchecked. MergeBrief has no setup page.

### Set the webhook

Under **Webhook**:

1. **Active**: checked.
2. **Webhook URL**: your `PUBLIC_BASE_URL` followed by `/api/webhooks/github`, such as `https://brief.example.com/api/webhooks/github`.
3. **Webhook secret**: the `openssl rand -hex 32` output from [Before you start](#before-you-start). The api and worker refuse to boot on a secret under 32 characters.
4. **SSL verification**: leave it enabled.

GitHub refuses a `localhost` or private-network webhook URL. If your instance is not running yet, register anyway: deliveries fail until it is up, and you redeliver one in [Check the App](#check-the-app).

### Set the permissions

Under **Permissions**, open **Repository permissions** and set exactly these. Leave every other one at **No access**.

| Repository permission | Access | What MergeBrief uses it for |
| --- | --- | --- |
| Contents | Read and write | Reads diffs and files. Write marks a draft ready for review and stores images reviewers attach |
| Metadata | Read-only | Selected for you; GitHub requires it |
| Pull requests | Read and write | Reads pull requests, posts the Entry comment, and submits reviewers' reviews and comments |
| Issues | Read-only | Reads the GitHub issue a pull request names as its ticket |
| Checks | Read-only | Reads check runs for the `bots` and `ci` trigger conditions |
| Commit statuses | Read-only | Reads commit statuses for the same two conditions |

Then open **Organization permissions** and set **Members** to **Read-only**, for team suggestions when a reviewer types `@`. Set no **Account permissions**.

Why each one, and what breaks without it: [Permissions: least privilege, exactly these](#permissions-least-privilege-exactly-these).

### Subscribe to events

Under **Subscribe to events**, check these four and nothing else:

- **Pull request**
- **Pull request review**
- **Check run**, which appears once **Checks** is set
- **Status**, which appears once **Commit statuses** is set

GitHub sends install, uninstall, repository and authorization-revoked events to every App without a checkbox, so these four are the complete set.

### Choose where it can be installed

Under **Where can this GitHub App be installed?**, pick **Only on this account**. On an organization's App, that limits sign-in to the organization's members ([Who can install and sign in](#who-can-install-and-sign-in)).

### Create the App

Click **Create GitHub App**. GitHub opens the App's settings on the **General** tab.

**Check:** the **About** section shows an **App ID** and a **Client ID**.

## Collect the credentials

Everything below is on the App's **General** tab. Each value goes in `.env` beside `docker-compose.yml`, never in the config file or a repository ([Fill in `.env`](./compose.md#fill-in-env)).

| Value | Where to find it | `.env` key |
| --- | --- | --- |
| App ID | **About**, a number | `GITHUB_APP_ID` |
| Client ID | **About**, a string, not the App ID | `GITHUB_OAUTH_CLIENT_ID` |
| Client secret | **Client secrets**, **Generate a new client secret**. GitHub shows it once: copy it now | `GITHUB_OAUTH_CLIENT_SECRET` |
| Private key | **Credentials** in the left sidebar, then **Key pairs**, **New key**. Your browser downloads the key as a PEM file | `GITHUB_APP_PRIVATE_KEY` (the contents) or `GITHUB_APP_PRIVATE_KEY_PATH` (a mounted file) |
| Webhook secret | The value you generated in [Before you start](#before-you-start) | `GITHUB_WEBHOOK_SECRET` |
| Slug, optional | The App's public page, `https://github.com/apps/<slug>` | `GITHUB_APP_SLUG`, so Home can link a viewer with no installation to the install page |

Keep the `.pem` file private (`chmod 600`). If a client secret or private key leaks, generate a new one and delete the old one on this page ([operations.md](./operations.md#rotating-secrets)).

## Install the App

1. In the App's settings, open **Install App**.
2. Click **Install** beside your organization or account.
3. Pick **All repositories**, or **Only select repositories** and choose the ones to brief.
4. Click **Install**.

To change the repositories later, open the account's **Settings**, then **GitHub Apps** for an organization or **Applications** for a personal account, and **Configure** beside the App. Each account you install on is one installation, and MergeBrief keeps each repository's data separate under it.

Installing lets nobody in by itself. The instance answers only to the accounts its `mergebrief.config.yaml` lists, so list yourself and your organization ([List who may sign in](./compose.md#list-who-may-sign-in)).

## Check the App

Run these once the instance is up ([Start the stack](./compose.md#start-the-stack)).

1. **The webhook reaches the instance.** In the App's settings, open **Advanced**. Under **Recent Deliveries**, open the newest delivery, such as the `ping` GitHub sends when the App is created, click **Redeliver**, and confirm. The response shows `200`. With no delivery listed yet, push to a pull request on an installed repository and look again. A `401` means the secret in `.env` differs from the App's ([troubleshooting.md](./troubleshooting.md#webhook-deliveries-answer-401)).
2. **Sign-in works.** Open your `PUBLIC_BASE_URL`, sign in with GitHub and authorize the App. You land on Home, signed in. A `redirect_uri` error from GitHub means the callback URL and `PUBLIC_BASE_URL` differ.

The brief itself is the last check: [Check it end to end](./compose.md#check-it-end-to-end).

## Upload a logo

A new App shows GitHub's generated identicon until you upload a logo. [`github-app-logo.png`](../media/github-app-logo.png) is a 512px PNG of the MergeBrief mark in vermilion on near-black; its SVG source sits in the same folder.

1. In the App's settings, on the **General** tab, find **Display information**.
2. Click **Upload a logo** and pick `github-app-logo.png`. Keep the whole square when GitHub offers a crop, then click **Set new avatar**.
3. In **Badge background color**, which appears once a logo is uploaded, enter `#020203`, the logo's own ground.

## Reference

### Permissions: least privilege, exactly these

- **Contents: write** is for two things only. GitHub's `markPullRequestReadyForReview` mutation, behind the author's **Mark ready for review**, answers `FORBIDDEN` without it. Images a reviewer attaches to a comment are pushed to an orphan `mergebrief/attachments` branch ([attachments.md](./attachments.md)); no other branch is touched, and the App never writes code. A ruleset on `mergebrief/*` can refuse that push. With Contents at read-only, briefs still generate, but **Mark ready for review** and attaching an image both fail with `403 github-permission`.
- **Pull requests: write** posts the Entry comment and authorizes a reviewer's review, inline comments and replies. Without it, briefs generate and no Entry comment appears ([troubleshooting.md](./troubleshooting.md#no-entry-comment-appears)).
- **Issues: read** reads the issue a pull request names as its ticket ([trackers.md](./trackers.md#github-issues)). Without it, a GitHub ticket reads as refused on the brief, and generation continues.
- **Checks: read** and **Commit statuses: read** feed the `bots` and `ci` [trigger conditions](../repo-config/trigger-conditions.md), and are what make the **Check run** and **Status** events available.
- **Members: read** (organization) lists the teams a reviewer can `@mention`. The read runs on the reviewer's own token, so a reviewer sees only the teams GitHub shows them. Without it, people are still suggested and a typed `@org/team` still reaches GitHub. [Who triggers a brief](#who-triggers-a-brief) does not depend on it.

Deliberately not enabled:

- **Issues: write**. A comment on a pull request's conversation uses the issue-comments endpoint, which **Pull requests: write** already authorizes.
- **Checks: write** and **Commit statuses: write**. MergeBrief reads check runs and statuses and never posts one.
- Any other write permission.

### What each event does

- **Pull request** starts a brief on open and on every push, for an author on the team ([Who triggers a brief](#who-triggers-a-brief)). The same event carries a draft flip, a label added or removed, a review requested or withdrawn, and a title or base edit, which re-check a push a [trigger condition](../repo-config/trigger-conditions.md) holds. A review request or a base edit queues a full generation, which checks the conditions itself.
- **Pull request review** queues a regeneration and advances the reviewer's Checkpoint when the reviewer is on the team, by the same rule as authors.
- **Check run** re-checks a push held at that commit for the `bots` and `ci` conditions once the run finishes; a run that starts unfinished changes nothing. A fork pull request's run names no pull request, so MergeBrief finds the open pull requests whose held push is that commit.
- **Status** does the same for a commit status in any state.

### Reviewer sign-in

A reviewer signs in with GitHub through this App, and their reviews, comments and replies are authored as them, on their own user token. That token carries no OAuth scopes: GitHub bounds it by the App's permissions and by what the reviewer can reach on GitHub. A permission left off the App is missing for reviewers too.

If **Expire user authorization tokens** is off, every sign-in fails, and the api logs it only at `debug`, as `sign-in refused: GitHub rejected the code`. Check that setting first when sign-in fails for everyone.

Signing out, **Sign out everywhere** and revoking a MergeBrief API token revoke the reviewer's GitHub token at GitHub, through the App's client id and secret, once no session and no live API token still uses that sign-in. A refused or unanswered revoke is logged as `grant.revoke.fail`, and the sign-out completes anyway. MergeBrief never uses the stored copy again; it is deleted at once, or with the last revoked or expired API token that still lists it. The stored copy is encrypted at rest ([Tokens at rest](./operations.md#tokens-at-rest)).

When a user revokes the App in their GitHub settings, GitHub sends an authorization-revoked event, and MergeBrief deletes every session, API token and stored GitHub credential that user held and records it in the audit log. They sign in again to come back.

### Who triggers a brief

A push generates a brief at once only when the pull request's author is on the repository's team. MergeBrief reads that from the delivery's `author_association`, GitHub's label for how the author relates to the repository:

- **A private (not internal) repository:** every author counts.
- **A public or internal repository:** `OWNER`, `MEMBER` (of the organization that owns it) and `COLLABORATOR` count at once.
- **Anyone else** (`CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN`, `NONE` or no association): one read of their repository permission, covered by Metadata, settles it. `write` or `admin` counts (GitHub reports `maintain` as `write`); `read`, `triage` and a read that fails or times out do not. A private organization member that GitHub reports as a contributor counts once they hold write access.

Any other author's pull request shows "Brief available on demand", and nothing is spent until someone with push access starts the first brief from MergeBrief. That approval holds for the pull request, so every later push generates as usual. An author promoted onto the team triggers normally from their next push. A later event whose read fails leaves a head that already triggered as it is.

A bot author is decided by the repository's `trustedBots` list in `.mergebrief/settings.yaml` ([Settings](../repo-config/settings.md#let-a-bots-pull-requests-generate-without-a-click)). A push that passes this check can still be held by an unmet trigger condition; anyone with push access can generate it from the pull request's page in MergeBrief or with `mergebrief generate <number>`.

### Who can install and sign in

GitHub's **Where can this GitHub App be installed?** setting decides more than the install page:

| Registered as | Who can install it | Who can authorize it |
| --- | --- | --- |
| Only on this account, owned by an organization | That organization | Its members |
| Only on this account, owned by a person | That person's account | GitHub's docs do not say |
| Any account | Anyone | Anyone |

The instance answers to its own list either way ([Who may start a brief](./generators.md#who-may-start-a-brief)): an install lets nobody in and starts no brief until the account is listed, so a stranger's install on an **Any account** App spends nothing.

### Update an App you registered earlier

A release that reads something new from GitHub needs a permission or event your App lacks; its release notes say which. Changing the App's settings does not reach an existing installation: GitHub asks each installation to accept the new permissions, and until it does, the installation keeps working on its old ones. An organization owner accepts on the installation's settings page.

Until an installation accepts:

- **Members**: team suggestions stay empty there.
- **Issues**: a GitHub ticket reads as refused on the brief.
- **Pull requests: write**: no Entry comment posts. A comment is not posted retroactively; the next push gets one.
- **Checks** and **Commit statuses**: see below.

### Accept the Checks and Commit statuses permissions

On an App registered before the `bots` and `ci` [trigger conditions](../repo-config/trigger-conditions.md) existed:

1. In the App's settings, open **Permissions & events**, and set **Checks** and **Commit statuses** to **Read-only**.
2. Under **Subscribe to events**, check **Check run** and **Status**.
3. Click **Save changes**, then accept the updated permissions on each installation's settings page.

Until an installation accepts, a `ci` condition holds a push as missing the permission whenever it has a check to read; a `ci: required` on a base with no required check still passes. A `bots` condition holds Unblocked, CodeRabbit, Claude or Greptile as missing the permission while they have not reported. Only a pull request review from the bot lifts that hold, and only for `finished` and `approved`. The brief view names the bot or CI it cannot check. `copilot` reports through reviews and is unaffected, and so is a repository with neither condition. Anyone with push access can still generate a held push from MergeBrief.

`claude: clean` reads check runs only, so it needs Checks alone, and holds as missing the permission until Checks is accepted, even after Claude reviews. Every other verdict on those four bots, and every `ci` check, needs both. With only one of the two granted, a run or status through the readable source also settles a bot, and a run from the App a ruleset pins a check to decides that check without the status read. Any other `ci` check that passes, or reports nothing, on the readable source holds as missing while the other source is unreadable, and the held push shows the line asking for the permission in place of those checks. A check that failed or is still running on the readable source shows as failed or running beside that line.

Accepting wakes nothing by itself: a push already held is checked again on the next commit status or finished check run GitHub reports on it, or the next review submitted on its pull request. A Generate click generates that push without checking it.
