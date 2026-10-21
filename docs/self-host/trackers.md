# Trackers: where the primary ticket is read from

The Intent check names one **primary ticket** per PR (a `PREFIX-N` key, a
`#N` issue number, or a tracker URL found in the PR description, title or
branch name), fetches it, and reads how the diff relates to the ticket's goal.
The read is a fallible read shown to author and reviewer alike: it is never an
approval, never a gate, and a ticket that cannot be fetched is reported as
unread, never guessed.

Two halves of configuration:

- **Instance side**: `mergebrief.config.yaml`'s `trackers:` list names
  the boards every repo on the instance reads by default, and its
  `contextSources:` block lists the trackers that need a deployment
  credential, by env-var NAME. See [generators.md](generators.md).
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
  can read is read too, so a Notion repo whose PR says only `Fixes #12`
  still reads the issue. A reference to a tracker the deployment cannot
  read stays ordinary text.
- **One fetch per brief.** Only the primary is fetched; other references in
  the PR stay ordinary text. The primary's URL is dropped from the generic
  link chaser so it is never fetched twice.
- **Metadata only.** The read sees the PR title, description and branch
  name to resolve the reference. It never sends the diff anywhere.
- **Text, capped.** The ticket body is injected as untrusted text under the
  same 20,000-character cap as chased links; fence markers inside it are
  stripped. Comments are not read.
- **Fresh every run.** No cache; a ticket edited between two generations is
  re-read.

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

### Credential and reach

| Where | Credential | Reach |
| --- | --- | --- |
| Worker (App installation) | the installation token already minted for the job | every repository the installation covers |
| Worker (URL-box job) | the viewer's token, or the operator PAT fallback when the job's owner owns `MERGEBRIEF_URL_BOX_TOKEN` | whatever that token can read |
| `categorize` and `delta` dev CLIs | `gh`: `GH_TOKEN` / `GITHUB_TOKEN`, or `gh auth login` | whatever the logged-in account can read |

**No permission change.** GitHub authorizes `Get an issue` under
`Issues: read` **or** `Pull requests: read`, and the App already holds
`Pull requests: write` ([github-app.md](github-app.md)). `Issues` stays
off.

Installation reach, in practice:

- A ticket in a **sibling repository** of the same installation
  (`owner/repo#N`, an issue URL, or `tracker.issuesRepo`) reads fine.
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
| `not-found` | 404, or the number is a pull request | `gh` reported `HTTP 404` |
| `no-credential` | 401, or a 403 that is not a rate limit | `gh` exit 4 (not logged in), or `HTTP 401` / `HTTP 403` |
| `rate-limited` | 429, or a 403 carrying rate-limit headers | `gh` reported `HTTP 429`, or a 403 whose text says rate limit |
| `timeout` | no answer inside the read's budget, or a 5xx | same, or `gh` exited for another reason |
| `unsupported` | no read for this tracker on this deployment | `gh` is not installed |

The CLIs print the unread line to stderr and still exit 0; the worker logs
one `warn` with `{ tracker, reason, key }`.

### Local runs

`categorize` and `delta` read the issue through `gh api`, so the same
login that fetches the PR fetches the ticket. `--context <file>` replaces
the fetch entirely for a ticket `gh` cannot reach.

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
every row is readable. On the board: `•••` → **Connections** → add the
integration. A ticket that links to a second database (a related board, a
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
Notion page URL in the PR needs no board: it resolves whenever a Notion token
is configured.

### What the model sees

One page, as text: a header line (`title · Status · Type · Priority ·
assignees · key`, whatever the row has) and the page body, one line per
block, nested blocks indented, capped at 20,000 characters. Property names
`Status`, `Type` and `Priority` are matched by name, case-insensitively;
every people property contributes its names. Formulas, relations and rollups
are left out.

Every read is fresh, under a 10-second budget for the whole page. Notion's
rate limit (about three requests a second per integration) is never retried
inside a generation: a `429` is reported and the brief proceeds without the
ticket.

## When the ticket is unread

The card and the CLI carry one of five codes. What each means for you:

| Code | What happened | What to do |
| --- | --- | --- |
| `not-found` | The tracker answered "no such page". For Notion this also covers a board that is not shared with the integration. | Check the key or URL; share the board (and any related database) with the integration. |
| `no-credential` | The tracker refused the token (`401`), or the integration lacks the capability (`403`). | Rotate or fix the token in the worker's env; check the integration's **Read content** capability. |
| `timeout` | No usable answer within the 10-second budget, including network errors and `5xx` answers. | Nothing to configure; a later revision reads again. Sustained timeouts point at connectivity from the worker. |
| `rate-limited` | The tracker answered `429`. | Nothing to configure; it clears on the next revision. If it persists, the integration is shared with something else that spends its quota. |
| `unsupported` | No read for that tracker on this deployment: a Notion key or URL without a `contextSources:` entry. | Add the `notion` entry and its token, or leave it: the brief still generates. |

None of these fail a generation. The brief is produced from the diff; only
the alignment read is absent.
