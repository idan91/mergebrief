# Trackers: where the primary ticket is read from

The Intent check names one **primary ticket** per PR (a `PREFIX-N` key, a
`#N` issue number, or a tracker URL found in the PR description, title or
branch name), fetches it, and reads how the diff relates to the ticket's goal.
The read is a fallible read shown to author and reviewer alike: it is never an
approval, never a gate, and a ticket that cannot be fetched is reported as
unread, never guessed.

Two halves of configuration:

- **Instance side**: `mergebrief.config.yaml`'s `trackers:` list names
  the boards and Jira projects every repo on the instance reads by default,
  and its `contextSources:` block lists the trackers that need a deployment
  credential (Notion and Jira), by env-var NAME. See
  [generators.md](generators.md).
- **Repo side**: `.mergebrief/settings.yaml`'s `trackers:` list (or
  `tracker:` for one) replaces the instance list for that repo. Non-secret,
  committed with the repo. See [repo-config.md](repo-config.md).

## What the read is, and is not

- **A read, never a gate.** An unreadable ticket is reported on the brief
  (`primaryTicket.status: unread` with a reason) and generation continues
  from the diff alone. Nothing blocks, nothing fails, nothing is retried
  across runs.
- **Every readable tracker is read.** The repo's `trackers:` list names the
  trackers whose references rank first, GitHub when there is none, and
  the deployment must be able to read them. Any other tracker the deployment
  can read is read too, so a Notion repo whose PR links a GitHub issue URL
  still reads the issue. A bare `#12` or `owner/repo#12` counts only in a
  repo whose list names GitHub or that lists no tracker. A reference to a
  tracker the deployment cannot read stays ordinary text. A Jira key or link
  counts only in a repo whose list names its project, and a Notion key or
  page link only in a repo whose list names its board.
- **One fetch per brief.** Only the primary is fetched; other references in
  the PR stay ordinary text. The primary's URL is dropped from the generic
  link chaser so it is never fetched twice.
- **Metadata only.** The read sees the PR title, description and branch
  name to resolve the reference. It never sends the diff anywhere.
- **Only what the reviewer sees.** References and links come from the
  description as GitHub renders it. Text GitHub hides counts for nothing:
  HTML comments, link reference definitions, HTML tags and their attributes,
  images, link titles, reference labels, fence info strings and table cells
  past the header's columns. Where telling hidden text from shown text would
  take a full Markdown parse, the worker skips more, never less. A GitHub,
  Notion or Jira URL counts only where a link starts: at the start of the
  text, after whitespace or `<`, or as a Markdown link target, never inside
  another URL.
  A `PREFIX-N` key inside a link is part of the link, not a reference; the
  same key as a link's visible text still counts.
- **Text, capped.** The ticket body is injected as untrusted text under the
  same 20,000-character cap as chased links; fence markers inside it are
  stripped. Comments are not read.
- **Fresh every run.** No cache; a ticket edited between two generations is
  re-read.

## Links in the description

Beside the primary ticket, the worker fetches up to five other http(s) links
from the visible PR description as context. A longer page is cut at 20,000 characters,
and all of them together at `linkFetch.maxTotalChars` (40,000 by default). An HTML
page first loses its comments and its `head`, `script`, `style`, `template` and `noscript` elements,
which hold no text a reader sees, and the worker reads up to 200,000 characters of
it to find the text. It skips
a link with credentials in it, a port other than 80 or 443, a `localhost` or
`.local` host, and any private, link-local, reserved, multicast, documentation
or cloud-metadata address. A host name resolves through the DNS servers
directly, never `/etc/hosts`, and is checked again at connect time against
every address it resolves to. Redirects are not followed, and only a text
body (`text/*`, JSON or XML) sent without a content encoding is read.
Link fetches always connect directly and never use node's env proxy
(`NODE_USE_ENV_PROXY`). The instance's `linkFetch` block turns link fetches
off or limits them to listed hosts
([configuration.md](./configuration.md#linkfetch)).

## GitHub Issues

Built in, and the default: a repo with no `trackers:` list reads GitHub. Nothing to configure and no config entry: the read runs
wherever a GitHub credential is already bound.

### What is read

`GET /repos/{owner}/{repo}/issues/{number}`: title, state (with the close
reason when closed), label names, milestone title and the body. The brief
shows the title and a `state · labels · milestone` line beside the quoted
goal.

A number that resolves to a **pull request** is reported as `not-found`:
GitHub shares one number space between issues and PRs, and a PR is not a
ticket.

### What the model sees

One issue, as text: a header line (`title · state · labels · milestone`,
empty pieces omitted, the close reason beside a closed state) and the issue
body, capped at 20,000 characters.

### Credential and reach

| Where | Credential | Reach |
| --- | --- | --- |
| Worker (App installation) | the installation token already minted for the job | the pull request's repository and its `issuesRepo`; every repository the installation covers with `siblingRepos: true`; never an issue from a repository less widely visible than the pull request's |
| Worker (URL job) | the viewer's token, or `MERGEBRIEF_URL_FALLBACK_TOKEN` when the job's owner owns it | the pull request's own repository only, whatever else that token can read |
| `categorize` and `delta` dev CLIs | `gh`: `GH_TOKEN` / `GITHUB_TOKEN`, or `gh auth login` | whatever the logged-in account can read |

**The App needs `Issues: read`** ([github-app.md](github-app.md)). Without it
GitHub answers `Get an issue` with a 403, even when the App holds
`Pull requests: write`, and the brief reports the ticket as refused.

Installation reach, in practice:

- By default an installation job reads issues only in the pull request's
  own repository and the `issuesRepo` its tracker list names. A ticket in
  any other **sibling repository** of the installation (`owner/repo#N` or an
  issue URL) is `not-found`, unsent. A PR author can still name any issue in
  the `issuesRepo`, including one in a repository they cannot see.
- An issue in **another repository** is read only when that repository is at
  least as widely visible as the pull request's, under `issuesRepo` and
  `siblingRepos` alike: everyone who can read a repository can read its
  briefs. GitHub's three visibilities rank private, internal, public. A
  private issue is never read for an internal or public pull request, and an
  internal issue never for a public one; a private issue is read for a
  private pull request, and a public issue for any. The worker asks GitHub
  for the issue repository's visibility and, unless it is public, for the
  pull request's. A refused ticket is `not-found`, unsent; when either
  question fails, the ticket is unread with that failure's reason. The dev
  CLIs do not apply this rule.
- The rule compares visibility, not membership. Two private repositories
  with different members still read each other's issues, and a private
  repository with an outside collaborator still reads an internal one. Point
  `issuesRepo` at a repository every reader of the pull request may see, and
  leave `siblingRepos` off where members differ between repositories.
- `issuesRepo` comes from the repo's `.mergebrief/settings.yaml` when that
  file names trackers, else from the instance's `trackers:` list. Whoever
  can write the repo's default branch can point it at any repository the
  installation covers; trust it as you trust the rest of the repo's settings.
- To read sibling repositories, turn `siblingRepos` on in the instance
  config's `github` tracker entry:

  ```yaml
  # mergebrief.config.yaml
  trackers:
    - kind: github
      siblingRepos: true # default false
  ```

  It is instance-only: it applies to every repo on the instance, whatever
  that repo's own tracker list says, and a `.mergebrief/settings.yaml` that
  sets it is rejected whole. A value other than `true` or `false` refuses
  boot.
- A ticket **transferred** to another repository is `not-found` under
  every binding, `siblingRepos: true` included: GitHub answers the old
  address with a 301 to the new repository, and the worker refuses the
  redirect without following it, so a bound checked against the old
  repository never lets the new one's text through. The same holds for a
  reference, or an `issuesRepo`, that still names a **renamed** repository
  by its old name: use the current name.
- A ticket in a **private repository outside** the installation is
  `not-found`: GitHub answers 404, not 403, so the brief cannot tell
  "does not exist" from "cannot see".
- A ticket in a **public repository outside** the installation: GitHub's
  documented behaviour is that an installation token can read public
  repositories' issues. **Unverified** on this deployment: no live call has
  been made to confirm it. Treat a `not-found` on a public repo as
  something to check, not a bug in the read.

### What the reasons mean

| Reason | GitHub said | CLI equivalent |
| --- | --- | --- |
| `not-found` | 404, a 301 for a transferred issue or a renamed repository, or the number is a pull request; also an issue in a repository less widely visible than the pull request's | `gh` reported `HTTP 404` |
| `no-credential` | 401, or a 403 that is not a rate limit | `gh` exit 4 (not logged in), or `HTTP 401` / `HTTP 403` |
| `rate-limited` | 429, or a 403 carrying rate-limit headers | `gh` reported `HTTP 429`, or a 403 whose text says rate limit |
| `timeout` | no answer inside the read's budget, or a 5xx | same, or `gh` exited for another reason |
| `unsupported` | no read for this tracker on this deployment | `gh` is not installed |

The CLIs print the unread line to stderr and still exit 0; the worker logs
one `warn` with `{ tracker, reason, key }`.

### Local runs

`categorize` and `delta` read the issue through `gh api`, so the same
login that fetches the PR fetches the ticket, and `gh` follows a
transferred issue to its new repository. `--context <file>` replaces the
fetch entirely for a ticket `gh` cannot reach.

## Notion

Reading a Notion ticket needs an internal integration token. The integration
is yours: MergeBrief never stores the token, never writes to Notion, and reads
only the one page the PR names.

### 1. Create the internal integration

1. Open <https://www.notion.so/profile/integrations> as a workspace owner and
   create a new **internal** integration in the workspace that holds the
   board.
2. Under **Capabilities** keep **Read content** on and turn every write
   capability off. Turn **Read user information without email addresses** on
   if you want assignee names in the ticket header; without it the header
   shows no assignees.
3. Copy the token (`ntn_…`; older `secret_…` tokens also work).

### 2. Share the board with the integration

Sharing a page grants its children, so share the board **database** once and
every row is readable. The integration reaches whatever you share with it,
and each repository reads only the boards its effective `trackers:` list
names (its own list, else the instance's), page URLs included. On the board:
`•••` → **Connections** → add the integration. A ticket that links to a second database (a related board, a
parent epic elsewhere) needs that database shared too.

An unshared board and a mistyped id look the same to the API: both return
`object_not_found`, which MergeBrief reports as `not-found`.

### 3. Give the worker the token

Put the token in the worker's environment as `NOTION_TOKEN` (or any name you
choose) and list the Notion source in the instance config:

```yaml
# mergebrief.config.yaml
contextSources:
  - type: notion
    tokenEnv: NOTION_TOKEN # NAME of the env var; default NOTION_TOKEN
```

The file names the variable, never a value. A listed `notion` entry whose
variable is unset refuses boot, the same way a missing generator key does. No
`contextSources:` block means the built-in reads only: URLs in the PR
description and GitHub issues still work; Notion keys and Notion URLs do not.

Only installation jobs read Notion. A URL-box brief runs on the viewer's own
GitHub grant and is never offered the deployment's integration, so a repo's
`tracker:` block cannot point it at a page the viewer could not open.

The local CLIs read the same variable from `tools/categorizer/.env` and take
the config with `--config`; see [cli.md](cli.md).

### 4. Point the repo at the board

```yaml
# .mergebrief/settings.yaml
version: 1
tracker:
  kind: notion
  keyPrefix: ACME # keys match only this prefix
  databaseId: 1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9 # data source id or database id
```

A repo whose tickets live on several boards lists them under `trackers:`
instead, one entry per board with its own `keyPrefix` and `databaseId`; see
[repo-config.md](repo-config.md).

`databaseId` takes either id Notion offers for the board: the data source id
from `•••` → **Manage data sources** → **Copy data source ID**, or the
32-hex database id in the board's URL. Dashes are optional. A database
with several data sources resolves to the one whose schema carries
`keyPrefix`; when more than one does, the read reports the ticket as not
found and asks for the data source id instead.

`keyPrefix` is the prefix of the board's **ID** property (the unique-id
property Notion numbers rows with). A key like `ACME-12` matches only when
the prefix equals a listed `keyPrefix`; without one keys never match. A
Notion page URL in the PR is read only when the page sits directly in a
board the repository's effective `trackers:` list names; any other page, a
sub-page nested under a row included, is `not-found`. A repository that
lists no Notion board reads no Notion page link.

### What the model sees

One page, as text: a header line (`title · Status · Type · Priority ·
assignees · key`, whatever the row has) and the page body, one line per
block, nested blocks indented, capped at 20,000 characters. Property names
`Status`, `Type` and `Priority` are matched by name, case-insensitively;
every people property contributes its names. Formulas, relations and rollups
are left out.

Every read is fresh, under a 10-second budget for the whole page and at most
50 child-block requests; a page nested deeper keeps what was read. Requests
never follow a redirect. Notion's
rate limit (about three requests a second per integration) is never retried
inside a generation: a `429` is reported and the brief proceeds without the
ticket.

## Jira

Reading a Jira ticket needs an Atlassian account's email and an API token.
The token is yours and never leaves your deployment: MergeBrief has no hosted
service, the worker sends the token only to Atlassian, and MergeBrief never
writes to Jira. Only Jira Cloud is read; Data Center and Server are not.

The example below follows one company. Dana's tickets live on
`acme.atlassian.net`. Everyone can open project `ACME`; only HR can open
`HR`. Dana's repository lists the projects `ACME` and `WEB`.

### 1. Choose the account that owns the token

Where your organization can create one, use a service account: in Atlassian
Administration, **Directory**, then **Service accounts**. Give it the Jira
role and access to only the projects the briefs should quote. Otherwise use a
person's account that can browse those projects.

MergeBrief was checked with a person's token. Atlassian documents a service
account's token as working the same way; that was not tested here.

### 2. Create an API token with scopes

1. Open <https://id.atlassian.com/manage-profile/security/api-tokens> as that
   account and choose **Create API token with scopes**.
2. Name the token and set its expiry, 365 days at most.
3. Pick **Jira**, then the scope `read:jira-work` and nothing else.
4. Copy the token. Atlassian does not show it again.

For a service account, open the account in Atlassian Administration, choose
**Create credentials**, then **API token**, and pick the same scope.

A classic API token, one with no scopes, also works, but it can do
everything its account can, writes included. The worker warns at boot when
it sees one.

### 3. Give the worker the email and the token

Put the account's email in the worker's environment as `JIRA_EMAIL` and the
token as `JIRA_API_TOKEN`, or under names you choose and give in the next
step. The Instance config names the variables and never holds a value.

### 4. Name the site in the Instance config

```yaml
# mergebrief.config.yaml
contextSources:
  - type: jira
    site: acme.atlassian.net # the Jira Cloud host alone: no scheme, path or port
    emailEnv: JIRA_EMAIL # NAME of the env var; default JIRA_EMAIL
    tokenEnv: JIRA_API_TOKEN # NAME of the env var; default JIRA_API_TOKEN
    linkHosts: # optional: custom domains whose issue links count too
      - jira.acme.example
```

`site` is one `.atlassian.net` host. One deployment reads one Jira site: the
list takes one `jira` entry. `linkHosts` takes at most 4 bare host names, none
of them an `atlassian.net` host. A listed `jira` entry whose email or token
variable is unset refuses boot, and so does a `site` where no Jira site
answers.

### 5. Point the repository at its projects

```yaml
# .mergebrief/settings.yaml
version: 1
tracker:
  kind: jira
  projectKeys: [ACME, WEB] # 1 to 50 project keys
```

A repo with other trackers lists this entry under `trackers:` beside them,
one `jira` entry per list; a project key may not also be another tracker's
prefix on the same list. Projects every repository shares go in the Instance
config's `trackers:` instead; a `jira` entry there refuses boot without the
`contextSources:` entry. See [repo-config.md](repo-config.md).

### What the token can reach

The token reaches every project its account can browse on that one site,
whatever its scope: the scope limits what the token may do, not which
projects it sees. Choose an account that sees only the projects the briefs
should quote. If Dana's token belongs to someone in HR, a repository that
lists `HR` can make its briefs quote HR tickets.

The token expires within 365 days at most. Replace it before then and
restart the worker.

### Which issues a PR can make the brief read

Only issues of a listed project:

- **By key**: `ACME-12` in the description, title or branch name. Keys
  match case-insensitively.
- **By link**: in the description or title, on the site or a `linkHosts`
  host. The last path segment that is an issue key decides, as in
  `https://acme.atlassian.net/browse/ACME-12`. A link with no key in its
  path counts by its `selectedIssue` query value, which a board or backlog
  link carries.

In Dana's repository `HR-7` and a link to it stay ordinary text, because
`HR` is not listed. A key inside a link is part of the link. An issue moved
to another listed project is quoted under its new key; moved to a project
the repository does not list, it is reported `not-found`.

Only installation jobs read Jira. A brief started from a pasted PR URL runs
on the viewer's own GitHub grant and is never offered the deployment's
token. A Jira key there is reported `unsupported`, and a Jira link stays
ordinary text.

### What the model sees

One issue, as text: a header line (`summary · status · type · priority ·
assignee · labels · key`, whatever the issue has), a `Parent: KEY summary`
line when the issue's parent sits in a listed project, then the description.
The description is one line per block: lists and nested content indented,
numbered lists keep their numbers, code blocks keep their fences, a table is
one row per line, an image or file becomes an `[attachment]` marker, and a
mention becomes the name Jira shows for it. The parent line and the
description together are capped at 20,000 characters.

Not read: comments, the contents of attachments, linked issues, subtasks,
sprints and custom fields. Acceptance criteria kept in a custom field are
not seen.

### What the worker asks Atlassian

- **Per brief**: one request to `api.atlassian.com` for the primary ticket,
  sent with the email and token.
- **Per worker process**: one lookup of the site's cloud id at
  `https://<site>/_edge/tenant_info`, sent with no credential. A lookup that
  fails is tried again on the next read, and so is a cloud id Atlassian no
  longer knows.
- **Budget**: the lookup and the read share a 10-second budget. No redirect
  is followed. A `429` is reported and never retried inside a generation.
- **At boot**: a `site` where no Jira site answers refuses boot; a site that
  cannot be reached lets boot go on. The worker then asks once what the
  token can do, and logs `jira.token.check` when Atlassian refuses the
  token or shows it can do more than read
  ([observability.md](observability.md#event-vocabulary)). No line is not
  proof: a check that gets no clear answer logs nothing, and so does a
  token whose scopes leave out `read:jira-work`, whose reads then report
  `no-credential`.

### Local runs

`categorize` and `delta` read `JIRA_EMAIL` and `JIRA_API_TOKEN` (or the names
the entry gives) from `tools/categorizer/.env`, and the site from the file
`--config` names; see [cli.md](cli.md).

## When the ticket is unread

The card and the CLI carry one of five codes. What each means for you:

| Code | What happened | What to do |
| --- | --- | --- |
| `not-found` | The tracker answered "no such page". For Notion this also covers a board that is not shared with the integration, and a page URL whose page sits outside the repository's boards. For Jira it covers an issue that does not exist, one the account cannot see and an unknown project, which Jira answers alike, and an issue moved to a project the repository does not list. | Check the key or URL; share the board (and any related database) with the integration. For Jira, check the key, the account's access to the project, and the `projectKeys` list. |
| `no-credential` | The tracker refused the token (`401`), or the integration lacks the capability (`403`). For Jira, Atlassian refused the email and token (`401` or `403`), including an expired or revoked token and a token without the `read:jira-work` scope. | Rotate or fix the token in the worker's env; check the integration's **Read content** capability. For Jira, replace or fix the token, then restart the worker. |
| `timeout` | No usable answer within the 10-second budget, including network errors and `5xx` answers. For Jira, also a site whose cloud id could not be looked up. | Nothing to configure; a later revision reads again. Sustained timeouts point at connectivity from the worker. |
| `rate-limited` | The tracker answered `429`. | Nothing to configure; it clears on the next revision. If it persists, the integration or Jira token is shared with something else that spends its quota. |
| `unsupported` | No read for that tracker on this deployment: a Notion key or URL, or a Jira key, without a `contextSources:` entry of its type. For Jira, also a key in any brief started from a pasted PR URL. | Add the `notion` or `jira` entry and its credential, or leave it: the brief still generates. |

None of these fail a generation. The brief is produced from the diff; only
the alignment read is absent.

Atlassian documents a CAPTCHA challenge on an account after repeated failed
logins. How that shows in a Jira read was not tested with MergeBrief.
