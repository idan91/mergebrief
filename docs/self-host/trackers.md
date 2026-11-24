# Connect Notion, Jira or GitHub Issues

A brief's Intent check compares a pull request with its **primary ticket**: one ticket the pull request names in its title, branch name or description, as a key (`ACME-12`), an issue number (`#12`) or a link. MergeBrief fetches that ticket and says how the diff relates to its goal. GitHub Issues works with no setup. Notion and Jira each need a credential on the instance and a list of the boards or projects to read.

The read is never a gate: a ticket that cannot be fetched is reported as unread, and the brief is written from the diff alone.

Run every command in the folder that holds `docker-compose.yml`, `.env` and `mergebrief.config.yaml`.

## GitHub Issues

Nothing to set up: a repository that lists no tracker reads GitHub Issues. The App needs the **Issues: read** permission ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these)); without it the brief reports the ticket as refused.

**Check:** open a pull request titled `Fix login timeout (#12)`, where `#12` is an open issue in the same repository. Its brief's **Intent check** has a **Ticket alignment** card naming `#12` with the issue's title, a "Referenced in the PR title" line, and a read of how the diff matches.

To read issues from a separate tickets repository, a repository names it as `issuesRepo` ([settings.md](../repo-config/settings.md#several-boards-jira-or-github-issues)). To let references resolve in every repository the installation covers, turn on `siblingRepos` in the instance config:

```yaml
# mergebrief.config.yaml
trackers:
  - kind: github
    siblingRepos: true # default false
```

Only the worker reads `trackers` ([Apply a change](./configuration.md#apply-a-change)):

```sh
docker compose restart worker
```

`siblingRepos` applies to every repository on the instance, and only the instance config may set it: a `.mergebrief/settings.yaml` that sets it is rejected whole. An issue in another repository is still read only when that repository is at least as widely visible as the pull request's ([Credential and reach](#credential-and-reach)).

## Connect Notion

### 1. Create the integration

1. Open <https://www.notion.so/profile/integrations> as a workspace owner and create a new **internal** integration in the workspace that holds the board.
2. Under **Capabilities**, keep **Read content** on and turn every write capability off. Turn **Read user information without email addresses** on if you want assignee names in the ticket header.
3. Copy the token (`ntn_…`; older `secret_…` tokens also work).

### 2. Share the board with it

On the board, open `•••`, then **Connections**, and add the integration. Sharing the board database shares every row. A ticket that links to a second database, such as a related board or a parent epic, needs that database shared too.

### 3. Find the board's ids

- **`databaseId`:** the 32-hex database id in the board's URL, or the data source id from `•••`, **Manage data sources**, **Copy data source ID**. Dashes are optional. A database with several data sources resolves to the one whose schema carries the `keyPrefix`; when more than one does, use the data source id.
- **`keyPrefix`:** the prefix of the board's **ID** property, the unique id Notion numbers rows with: `ACME` for `ACME-12`.

Then [add it to the instance](#add-the-credentials-and-boards-to-the-instance).

## Connect Jira

Only Jira Cloud is read; Data Center and Server are not. MergeBrief sends the token only to Atlassian and never writes to Jira.

### 1. Choose the account

The token reaches every project its account can browse on the site, whatever its scope. Where your organization can create one, use a service account (Atlassian Administration, **Directory**, **Service accounts**) with access to only the projects briefs should quote. Otherwise use a person's account that can browse them.

### 2. Create an API token with one scope

1. Open <https://id.atlassian.com/manage-profile/security/api-tokens> as that account and choose **Create API token with scopes**. For a service account, open it in Atlassian Administration and choose **Create credentials**, then **API token**.
2. Name the token and set its expiry, 365 days at most.
3. Pick **Jira**, then the scope `read:jira-work` and nothing else.
4. Copy the token. Atlassian does not show it again.

A classic token with no scopes also works, but it can do everything its account can, writes included; the worker warns at boot when it sees one.

Then [add it to the instance](#add-the-credentials-and-boards-to-the-instance).

## Add the credentials and boards to the instance

1. **Put the credentials in `.env`.** Add only the lines for the trackers you use:

   ```dotenv
   NOTION_TOKEN=ntn_your-integration-token
   JIRA_EMAIL=you@example.com
   JIRA_API_TOKEN=your-jira-api-token
   ```

2. **List the trackers in `mergebrief.config.yaml`.** `contextSources:` lists the trackers that need a credential, and `trackers:` names the boards and projects every repository reads unless it lists its own:

   ```yaml
   # mergebrief.config.yaml
   contextSources:
     - type: notion            # reads NOTION_TOKEN
     - type: jira              # reads JIRA_EMAIL and JIRA_API_TOKEN
       site: acme.atlassian.net   # the Jira Cloud host alone: no scheme, path or port
   trackers:
     - kind: notion
       keyPrefix: ACME
       databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
     - kind: jira
       projectKeys: [WEB, OPS]
   ```

   Leave out the entries you do not use. `contextSources:` is one list with at most one entry per tracker: with both Notion and Jira, put both entries under the one key. Writing `contextSources:` twice is a duplicate YAML key, and the worker and the api refuse to boot. A `notion` or `jira` entry under `trackers:` refuses boot unless `contextSources:` has an entry of the same type.

3. **Apply both files:**

   ```sh
   docker compose up -d
   ```

   `up -d` recreates the services with the new `.env`, and they read the config file as they start. If you changed only `mergebrief.config.yaml`, `docker compose restart worker` is enough ([Apply a change](./configuration.md#apply-a-change)).

4. **Check the worker started.** `docker compose ps -a` shows `worker` as `Up`. A worker at `Exited (0)` names the problem on the last line of `docker compose logs worker`: an unset variable, a `site` where no Jira site answers, or a duplicate key ([A service exits with code 0](./troubleshooting.md#a-service-exits-with-code-0)).

The file names the variables, never their values. Under other names, set them on the entry: `tokenEnv` for Notion, `emailEnv` and `tokenEnv` for Jira. Every key is in [configuration.md](./configuration.md#contextsources-trackers).

### Check that a ticket is read

Open a pull request whose title starts with a ticket key, such as `[ACME-12] Add invoice export`, or push to one. Its brief's **Intent check** has a **Ticket alignment** card with a **Notion** or **Jira** badge, the key linked to the ticket, its title, and a read of how the diff matches.

If the card says "ACME-12 could not be read." instead, the sentence after it gives the reason ([When the ticket is unread](#when-the-ticket-is-unread)). A key that matches no listed prefix or project is not a reference at all, so no card appears.

## Point one repository at its own boards

A repository can list its own boards and projects in `.mergebrief/settings.yaml` on its default branch. Its list replaces the instance's `trackers:` whole; the credentials stay the instance's:

```yaml
# .mergebrief/settings.yaml
version: 1
trackers:
  - kind: notion
    keyPrefix: DS
    databaseId: 0000000000004000a000000000000000
  - kind: jira
    projectKeys: [ACME]
```

[Connect your ticket tracker](../repo-config/settings.md#connect-your-ticket-tracker) covers the repository side: one board, several boards, and how the primary ticket is found.

## When the ticket is unread

The card and the CLI carry one of five codes:

| Code | The card says | What happened | What to do |
| --- | --- | --- | --- |
| `not-found` | "returned not found" | The tracker answered "no such page". For Notion this also covers a board not shared with the integration and a page outside the repository's boards. For Jira it covers an issue that does not exist, one the account cannot see, an unknown project, and an issue moved to a project the repository does not list. | Check the key or URL. For Notion, share the board and any related database with the integration. For Jira, check the account's access and the `projectKeys` list. |
| `no-credential` | "refused the read" | The tracker refused the credential (`401`), or it lacks a permission (`403`): an expired or revoked token, a Notion integration without **Read content**, a Jira token without `read:jira-work`. | Replace the token in `.env`, then `docker compose up -d`. For Notion, also check that the integration has **Read content**. |
| `timeout` | "did not answer in time" | No usable answer within the 10-second budget, including network errors and `5xx` answers, or a Jira site whose cloud id could not be looked up. | Nothing to configure; the next push reads again. Sustained timeouts point at the worker's connectivity. |
| `rate-limited` | "rate-limited the read" | The tracker answered `429`. | Nothing to configure. If it persists, something else shares the integration or token. |
| `unsupported` | "No ... reader is configured on this deployment" | A Notion or Jira reference with no `contextSources:` entry of its type, or a Jira key in a brief started from a pasted pull request URL. | Add the entry and its credential, or leave it: the brief still generates. |

None of these fails a generation. The worker logs one `warn` with `{ tracker, reason, key }`.

## Reference

### What the read uses

- **Metadata only.** The read sees the pull request's title, description and branch name to find the reference. It never sends the diff to a tracker.
- **One ticket per brief.** Only the primary is fetched; other references stay ordinary text.
- **Every readable tracker counts.** A repository's tracker list ranks its own references first, but any tracker the deployment can read is read too, so a Notion repository whose pull request links a GitHub issue URL still reads it. A bare `#12` or `owner/repo#12` counts only in a repository whose list names GitHub or lists no tracker. A Jira key or link counts only where the list names its project, and a Notion key or page link only where it names its board.
- **Only what the reviewer sees.** References come from the description as GitHub renders it: HTML comments, link reference definitions, HTML tags and attributes, images, link titles and hidden table cells count for nothing. A URL counts only where a link starts. A key inside a link is part of the link; the same key as the link's visible text still counts.
- **Text, capped.** The ticket body reaches the model as untrusted text, capped at 20,000 characters, with fence markers stripped. Comments are not read.
- **Fresh every run.** Nothing is cached; a ticket edited between two pushes is read again.
- **Installed repositories only** for Notion and Jira. A brief started from a pasted pull request URL runs on the viewer's own GitHub access and is never offered the instance's Notion or Jira credential.

### Credential and reach

GitHub Issues are read with the credential the job already holds:

| Where | Credential | Reach |
| --- | --- | --- |
| Worker, installed repository | the App installation's token | the pull request's repository and its `issuesRepo`; every repository the installation covers with `siblingRepos: true`; never an issue from a repository less widely visible than the pull request's |
| Worker, pasted pull request | the viewer's token, or `MERGEBRIEF_URL_FALLBACK_TOKEN` when the job's owner owns it | the pull request's own repository only |

- **Visibility, not membership.** An issue in another repository is read only when that repository is at least as widely visible as the pull request's: private, internal, public, in that order. A private issue is never read for an internal or public pull request. Two private repositories with different members still read each other's issues, so point `issuesRepo` at a repository every reader of the pull request may see, and leave `siblingRepos` off where members differ.
- **`issuesRepo` belongs to the repository.** Whoever can write the default branch's `.mergebrief/settings.yaml` can point it at any repository the installation covers. A pull request author can name any issue in it, including one they cannot see.
- **Moved and renamed.** A transferred issue, or a reference to a repository by its old name, is `not-found`: the worker refuses GitHub's redirect.
- **Outside the installation.** A private repository outside it answers 404, so the brief cannot tell "does not exist" from "cannot see". GitHub documents that an installation token can read public repositories' issues.

### Notion

- A Notion page URL is read only when the page sits directly in a board the repository's list names; a sub-page nested under a row is `not-found`.
- The model sees one header line (`title · Status · Type · Priority · assignees · key`, whatever the row has) and the page body, one line per block, nested blocks indented. `Status`, `Type` and `Priority` are matched by property name, ignoring case; formulas, relations and rollups are left out.
- Each read has a 10-second budget and at most 50 child-block requests; a deeper page keeps what was read. Redirects are not followed. Notion's rate limit, about three requests a second per integration, is never retried inside a generation.

### Jira

- One instance reads one Jira site. `linkHosts` lists up to 4 custom domains whose issue links count as the site's; an `atlassian.net` host there refuses boot.
- **Which issues count:** a key such as `ACME-12` in the description, title or branch name, matched without case, or a link on the site or a `linkHosts` host whose last issue-key path segment, or `selectedIssue` query value, names a listed project. An issue moved to another listed project is quoted under its new key.
- **What the model sees:** a header line (`summary · status · type · priority · assignee · labels · key`), a `Parent: KEY summary` line when the parent sits in a listed project, and the description, one line per block, with an image or file shown as an `[attachment]` marker. Comments, attachment contents, linked issues, subtasks, sprints and custom fields are not read, so acceptance criteria kept in a custom field are not seen.
- **Token expiry:** at most 365 days. Replace it before then and run `docker compose up -d`.

#### What the worker asks Atlassian

- **Per brief:** one request to `api.atlassian.com` for the primary ticket, with the email and token.
- **Per worker process:** one lookup of the site's cloud id at `https://<site>/_edge/tenant_info`, with no credential, tried again after a failure.
- **Budget:** the lookup and the read share 10 seconds. No redirect is followed, and a `429` is never retried inside a generation.
- **At boot:** a `site` where no Jira site answers refuses boot; one that cannot be reached lets boot go on. The worker then asks once what the token can do, and logs `jira.token.check` when Atlassian refuses it or it can do more than read ([observability.md](./observability.md#event-vocabulary)). No line is not proof that the token is scoped right.

### Links in the description

Beside the primary ticket, the worker fetches up to five other `http` or `https` links from the visible pull request description as context. Each page's text is capped, and so is all of it together; both limits, and what an HTML page loses first, are in [`linkFetch`](./configuration.md#linkfetch).

The worker skips a link with credentials in it, a port other than 80 or 443, a `localhost` or `.local` host, and any private, link-local, reserved, multicast, documentation or cloud-metadata address. A host name resolves through DNS directly, never `/etc/hosts`, and is checked again at connect time against every address it resolves to. Redirects are not followed, link fetches never use a proxy, and only a text body (`text/*`, JSON or XML) without a content encoding is read. The instance's `linkFetch` block turns link fetches off or limits them to listed hosts ([configuration.md](./configuration.md#linkfetch)).

### Local runs

The `categorize` and `delta` dev CLIs read GitHub issues through `gh api`, with the same login that fetches the pull request, and read `NOTION_TOKEN`, `JIRA_EMAIL` and `JIRA_API_TOKEN` from `tools/categorizer/.env`. They take the instance config with `--config`. `--context <file>` replaces the fetch for a ticket they cannot reach.
