# Settings: `settings.yaml`

`.mergebrief/settings.yaml` holds your repository's workflow settings: which pushes get a brief, whether the Entry comment posts on drafts, where your tickets live, and which bots' pull requests generate without a click. The file is at most 4 KB, starts with `version: 1`, and takes only the keys below. Any other key, or a bad value under any key, rejects the whole file ([How MergeBrief reads the files](./README.md#how-mergebrief-reads-the-files)).

```yaml
version: 1
entryCommentOnDrafts: true
trackers:
  - kind: github
trustedBots:
  - renovate[bot]
triggerConditions:
  readyForReview: on
```

Each task below ends with a way to see it worked. To confirm the file applied at all, see [Check that your config applied](./README.md#check-that-your-config-applied).

## Choose which pushes get a brief

`triggerConditions:` makes a push wait for conditions you choose, such as the pull request being out of draft or CI passing. It has its own page of recipes: [Choose which pushes get a brief](./trigger-conditions.md).

## Keep the Entry comment off drafts

The Entry comment is the comment MergeBrief posts on a pull request with a link to its brief. By default it posts on drafts too. To keep drafts quiet until they are ready:

```yaml
version: 1
entryCommentOnDrafts: false
```

The comment then posts when the pull request is marked ready for review, and an Entry comment already on a draft is removed on the next run. When the settings file cannot be fetched, the comment stays off drafts for that run and nothing is removed.

This key gates the comment only: drafts still generate briefs. To hold their generation too, add [`readyForReview: on`](./trigger-conditions.md#hold-drafts-until-they-are-ready-for-review).

To check: open a draft pull request. It gets no Entry comment; marking it ready for review posts one.

## Connect your ticket tracker

The brief's Intent check compares a pull request with its **primary ticket**, the one ticket it names in its title, branch name or description. This block tells MergeBrief which trackers your repository uses. A Notion board or Jira site also needs a credential the operator sets up on the instance; see [trackers.md](../self-host/trackers.md) for each tracker's setup.

### One Notion board

```yaml
version: 1
tracker:
  kind: notion
  keyPrefix: ACME
  databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
```

`keyPrefix` is the key prefix your tickets use (`ACME-12`): a letter, then up to 19 letters, digits or underscores. `databaseId` is the board's database id or data source id, with or without dashes ([Notion setup](../self-host/trackers.md#4-point-the-repo-at-the-board)).

### Several boards, Jira or GitHub Issues

List one entry per board under `trackers:` instead:

```yaml
version: 1
trackers:
  - kind: notion
    keyPrefix: ACME
    databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
  - kind: notion
    keyPrefix: DS
    databaseId: 0000000000004000a000000000000000
  - kind: jira
    projectKeys: [WEB, OPS]
  - kind: github
    issuesRepo: acme/tickets
```

- A `notion` entry needs `keyPrefix` and `databaseId`.
- A `jira` entry lists 1 to 50 project keys, and reads only where the instance config names the Jira site ([Jira setup](../self-host/trackers.md#jira)).
- A `github` entry takes an optional `issuesRepo`, the `owner/name` repository where a bare `#N` resolves.
- At most 8 entries, one `github` entry and one `jira` entry. A prefix or project key appears once across the list, compared without case.
- A file carries `tracker:` or `trackers:`, never both.

To check: open a pull request with a ticket key in its title, such as `[ACME-12] Add invoice export`. Its brief's Intent check names that ticket.

### Your list and the instance's

An operator whose repositories share boards lists them once in `mergebrief.config.yaml`'s `trackers:`. A repository with no tracker in its file reads the instance's list. A file that names any tracker replaces that list whole for this repository.

A pull request reads issues in its own repository and in `issuesRepo`, so whoever writes this file chooses that second repository. Reaching any other repository takes the instance's `siblingRepos`, which this file cannot set. Either way an issue in another repository is read only when that repository is at least as widely visible as the pull request ([Credential and reach](../self-host/trackers.md#credential-and-reach)).

### How the primary ticket is found

- `PREFIX-N` keys match **only** a configured `keyPrefix` or Jira project key, ignoring case, as a whole word, each on the board or Jira site its entry names. With no entry, keys never match.
- Jira issue links match in the description and title when they point at a listed project on the instance's Jira site or one of its `linkHosts`.
- GitHub issue URLs match wherever the deployment can read GitHub. The short forms, `#N`, `owner/repo#N` and a branch starting `N-` (or `type/N-slug`), match only when no tracker is listed or a `github` entry is: in a repository that lists Notion boards alone, a bare number is nearly always another pull request and stays text. A bare `#N` resolves against `issuesRepo` when set, else the pull request's own repository.
- When a pull request names several references, ones on a listed tracker come first: in a Notion repository, `[ACME-12]` in the title outranks `#467` in the description, which is usually a pull request. Within that pool the title wins, then the branch name, then the description, across boards and trackers alike: `[ACME-12]` in the title outranks a `WEB-3` the description mentions in passing. A closing keyword (`Fixes WEB-3`) puts its reference first among the description's own and never above the title or the branch name.

## Let a bot's pull requests generate without a click

A pull request opened by a bot gets a brief by itself only when the bot's login is listed here.

```yaml
version: 1
trustedBots:
  - renovate[bot]
  - dependabot[bot]
  - Copilot
```

- Write the login exactly as GitHub shows it on the pull request. A GitHub App bot carries the `[bot]` suffix (`renovate[bot]`, not `renovate`), and GitHub's Copilot coding agent is plain `Copilot`.
- Write one login per `- ` line as above. The one-line form `trustedBots: [renovate[bot]]` is not valid YAML and rejects the file; quote each login if you want it on one line (`["renovate[bot]"]`).
- The login before the suffix is at most 39 letters, digits and hyphens. Case does not matter, and listing one bot twice in any casing rejects the file. At most 32 entries.

The list is read from the default branch only, so a bot's pull request cannot add the bot to it.

A pull request from an unlisted bot waits for a collaborator with push access. Its page in MergeBrief shows them a Generate button; one click generates the brief. MergeBrief also posts a comment on the pull request saying a brief is available on demand, unless the pull request is a draft and this file turns `entryCommentOnDrafts` off or cannot be read.

To check: the bot's next pull request gets a brief and an Entry comment without anyone pressing Generate. Listed bots still meet your [trigger conditions](./trigger-conditions.md) like anyone else.

## Keys

| Key | Default | Value |
| --- | --- | --- |
| `version` | required | `1` |
| `entryCommentOnDrafts` | `true` | `true` or `false` ([Keep the Entry comment off drafts](#keep-the-entry-comment-off-drafts)) |
| `tracker` | the instance's list | One tracker entry ([Connect your ticket tracker](#connect-your-ticket-tracker)) |
| `trackers` | the instance's list | 1 to 8 tracker entries |
| `trustedBots` | none | Up to 32 bot logins ([Let a bot's pull requests generate without a click](#let-a-bots-pull-requests-generate-without-a-click)) |
| `triggerConditions` | the instance's conditions | A map of conditions, or `off` ([Choose which pushes get a brief](./trigger-conditions.md)) |
