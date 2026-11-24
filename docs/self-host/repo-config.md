# Repo-local configuration: the `.mergebrief/` directory

A repository can commit a `.mergebrief/` directory to shape its own briefs.
This is the **code-owner's** surface, distinct from the
operator's instance config (`mergebrief.config.yaml`, env-located, never in
the repo): instance config decides provider/model/spend and refuses boot when
invalid; repo config decides policy/text/workflow and degrades **that
repo's** briefs loudly when invalid, never the instance.

```
.mergebrief/
  instructions.md    # text guidance to generation (semi-trusted, bounded)
  settings.yaml      # workflow behavior (v1: entryCommentOnDrafts, tracker or trackers, trustedBots, triggerConditions)
  policy.yaml        # risk policy: custom attributes + display de-emphasis
  rules/             # RESERVED for future generated output; leave empty
```

Every file is read from the **default branch only**, fetched fresh per
generation, so a PR can never weaken its own scrutiny by editing config on its
head. A PR that changes a config file is analyzed like any other diff; the
change applies after merge.

Every brief records exactly which config shaped it: per-file
`path + blob SHA + outcome` (`applied` / `absent` / `invalid` /
`over-budget` / `fetch-failed`) on the generation record and the brief, an
understated "Repo config @ sha" chip in the header (warning state on any
error, visible to author and reviewer), and a permanent copy on the
Receipt.

## `instructions.md` (16 KB budget)

Free-form text the generator may follow **only** within the enumerated
instruction classes; see the authoring guide
(`docs/repo-config/authoring.md`) and the template
(`docs/repo-config/instructions-template.md`). Text shapes presentation and
comprehension; it can never mint a risk attribute, change a label
vocabulary, or alter the output schema. That asymmetry is why `policy.yaml`
exists separately. Over 16 KB the file is rejected whole (loudly), never
truncated.

## `settings.yaml` (4 KB, versioned)

```yaml
version: 1
entryCommentOnDrafts: true   # default
```

`entryCommentOnDrafts`: the branded Entry comment posts on draft PRs by
default, the same as on ready ones. A repo that keeps drafts private opts
out with `false`; the comment then posts when the PR flips to
ready-for-review, and an existing draft Entry is removed on the next run.
Generation runs for drafts unless a trigger condition holds them
([`readyForReview: on`](#triggerconditions-what-a-push-must-meet-before-it-generates),
here or in the instance config); this key gates the comment only. When the settings file cannot be
fetched the comment stays off drafts for that run and nothing is removed.

### `trackers:`, where this repo's tickets live

```yaml
version: 1
trackers:
  - kind: notion
    keyPrefix: ACME         # notion: required; keys never match without it
    databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9   # notion: required; database or data source id, dashes optional
  - kind: notion
    keyPrefix: DS           # a second board: its own prefix, its own database
    databaseId: 0000000000004000a000000000000000
  - kind: jira
    projectKeys: [WEB, OPS] # jira: required; 1 to 50 project keys
  - kind: github
    issuesRepo: owner/name  # optional: where a bare #N resolves
```

`tracker:` with one block is the same thing for a repo with one board, and
every existing file keeps working unchanged. A file carries one spelling or
the other, never both.

A pull request reads issues in its own repository and in `issuesRepo`, so
whoever writes this file chooses that second repository. Reaching any other
repository takes the instance's `siblingRepos`, which this file cannot set.
Either way an issue in another repository is read only when that repository
is at least as widely visible as the pull request's
([trackers.md](trackers.md#credential-and-reach)).

An instance whose repos share boards lists them once in
`mergebrief.config.yaml`'s `trackers:` instead (see
[generators.md](generators.md)). A repo file that names any tracker
replaces that list whole for the repo; a repo with no file reads the
instance's.

```yaml
version: 1
tracker:
  kind: notion
  keyPrefix: ACME
  databaseId: 1a2b3c4d5e6f40718293a4b5c6d7e8f9
```

The brief's Intent check names one **primary ticket** per PR, found in the
description, title or branch name, and reads it from its ticket
tracker (see [trackers.md](trackers.md)). This block tells it which
trackers the repo uses:

- `PREFIX-N` keys match **only** a configured `keyPrefix` or Jira project
  key (case-insensitive, word-bounded), each on the board or Jira site its
  entry names. With no entry, keys never match. A prefix or project key may
  appear once; at most one `github` entry and one `jira` entry; at most 8
  entries. A `jira` entry reads only where the instance config names the
  site ([trackers.md](trackers.md#jira)).
- Jira issue links match in the description and title when they point at a
  listed project on the instance's Jira site or one of its `linkHosts`.
- GitHub issue URLs match wherever the deployment can read GitHub. The
  short forms, `#N`, `owner/repo#N` and a branch starting `N-` (or
  `type/N-slug`), match only when no tracker is listed or a `github` entry
  is: in a repo that lists Notion boards alone, a bare number is nearly
  always another pull request and stays text. A bare `#N` resolves against
  `issuesRepo` when set, else the PR's own repo.
- When a PR names several references, ones on a listed tracker come
  first: in a Notion repo, `[ACME-12]` in the title outranks `#467`
  in the description, which is usually a pull request. Within that pool
  the title wins, then the branch name, then the description, across
  boards and trackers alike: `[ACME-12]` in the title outranks a `WEB-3`
  the description mentions in passing. A closing keyword (`Fixes WEB-3`)
  puts its reference first among the description's own and never above
  the title or the branch name.
- An invalid block rejects the whole file, like any other key.

### `trustedBots:`, bots whose PRs generate without a click

```yaml
version: 1
trustedBots:
  - renovate[bot]
  - dependabot[bot]
  - Copilot
```

A PR opened by a bot account gets a brief automatically only when the
bot's login is on this list. Write the login exactly as GitHub shows it on
the PR: a GitHub App bot carries the `[bot]` suffix (`renovate[bot]`, not
`renovate`), and GitHub's Copilot coding agent is plain `Copilot`. The
login before any suffix is at most 39 characters of letters, digits and
hyphens. Case does not matter: `Renovate[bot]` and `renovate[bot]` name
the same bot, and listing one bot twice in any casing rejects the whole
file. At most 32 entries. A bad entry rejects the whole file, like any
other key.

The list is read from the default branch only, so a bot's PR cannot add
the bot to it.

A PR from an unlisted bot waits for a collaborator with push access. The
PR's page in MergeBrief shows them a Generate button; one click generates
the brief. MergeBrief also posts a comment on the PR saying a brief is
available on demand, unless the PR is a draft and this file turns
`entryCommentOnDrafts` off or cannot be read.

### `triggerConditions:`, what a push must meet before it generates

```yaml
version: 1
triggerConditions:
  readyForReview: on
  size:
    changedLines: { max: 1500 }
  bots:
    unblocked: finished
  labels: [needs-brief]
```

Every condition must pass before a push generates. Inside an `any:` group, one passing member is enough. With no conditions set here or on the instance, every push generates.

#### A held push

A push that misses a condition is **held**. Nothing runs and nothing is spent. It generates by itself once every condition passes, and MergeBrief checks it again when:

- a label is added or removed, the pull request moves to draft or out of it, its title or base branch is edited, or a review is requested or a request withdrawn;
- someone submits a review;
- a check run finishes or a commit status lands on the push, while a `bots` or `ci` condition holds it. MergeBrief waits about 45 seconds first, so a burst of CI results costs one check.

Anyone with push access can skip the wait, from the pull request's page in MergeBrief or its row menu in the Inbox:

- **Generate brief** generates this push now. `mergebrief generate <number>` does the same from the CLI.
- **Generate on every push** generates this push now and skips the conditions for every later push of the pull request. On the page it sits in the menu beside Generate brief. The Inbox row menu shows it as a checked item while it is on, and that is where you turn it off. A pull request whose author needs a Trigger approval still waits for one.

The Entry comment follows the hold without notifying anyone again. A held push edits an existing Entry comment in place, and a pull request with no Entry comment gets one posted. The comment names each unmet condition and whose setting it is, with a Generate link and a link to the last brief. When the push generates, the comment turns to the generating line the same quiet way, and the ready brief is the one notification.

#### Kinds

| Key | Value | Met when |
| --- | --- | --- |
| `readyForReview` | `on` | The pull request is not a draft. |
| `size` | `changedLines`, `additions` and/or `deletions`, each `{ min, max }` (inclusive, either or both) | Every bound holds for GitHub's totals for the whole pull request. `changedLines` is additions plus deletions. |
| `bots` | A map of `unblocked`, `coderabbit`, `claude`, `greptile` or `copilot` to `finished`, `approved` or `clean` | Every listed bot gave that verdict on this push ([What a `bots` condition waits on](#what-a-bots-condition-waits-on)). |
| `reviewRequested` | `on` | A review was requested from a person or a team, or someone on the repository's team other than the author has reviewed ([Who counts for `reviewRequested`](#who-counts-for-reviewrequested)). |
| `ci` | `required`, or `{ checks: [names] }` | The checks pass by GitHub's merge rule on this push ([What a `ci` condition counts](#what-a-ci-condition-counts)). |
| `paths` | A list of globs, in the glob language `policy.yaml`'s `paths` uses | A changed file matches one, case as written ([What a `paths` condition sees](#what-a-paths-condition-sees)). This file only; the instance config refuses it. |
| `labels` | A list of label names | The pull request carries one of them. Case is ignored, as GitHub ignores it in label names. |
| `titleKeywords` | A list of words | The title contains one of them as a whole word, ignoring case: `wip` matches `[WIP] Add widgets` but not `Wipe the cache`. A phrase matches as written, and a keyword in a script written without spaces, such as Chinese, Japanese or Thai, matches anywhere in the title. |
| `baseBranches` | A list of branch names | The pull request targets one of them directly, exact name and case. A stacked PR into another branch stays held until it retargets. |
| `never` | `on` | Never: every push waits for a Generate click. It stands alone. |
| `any` | A map of two or more of the kinds above, `never` excepted | One of them is met. |

`reviewRequested` stays met for the rest of the pull request once met, and `paths` once a check sees it met, inside an `any` group too. Every other kind is checked again on each push, so moving a pull request back to draft or removing a label holds its next push.

#### How the instance's conditions merge with yours

The instance's conditions apply too, merged per kind:

- A kind you set here replaces the instance's. A list is one value, so your `labels` replaces the instance's list instead of adding to it.
- A kind you leave out is inherited.
- `<kind>: off` drops one inherited kind, and `triggerConditions: off` drops them all. An empty block is invalid.
- A kind's place travels with its value, so one you set inside `any:` sits in the group even where the instance set it outside.
- There is one `any:` group. The instance's inherited members and yours join it, and one passing member from either is enough.

For example, with this instance config and this repository file:

```yaml
# mergebrief.config.yaml
triggerConditions:
  readyForReview: on
  size: { changedLines: { max: 1500 } }

# .mergebrief/settings.yaml
version: 1
triggerConditions:
  size: off
  any:
    labels: [needs-brief]
    titleKeywords: [brief]
```

a push in this repository generates once its pull request is ready for review (inherited) and either carries the `needs-brief` label or has `brief` in its title. The size limit no longer applies.

The block is read from the default branch only, so a pull request's own edit to it applies once merged. A bad block rejects the whole file, and a file that cannot be read or is rejected applies the instance's conditions alone.

#### Who counts for `reviewRequested`

The condition is met once either of these happens:

- A review is requested from a person or a team.
- Someone on the repository's team other than the author reviews: a repository owner, organization member or collaborator, anyone with write access, or on a private repository anyone at all.

A bot's request or review does not count. On a public or internal repository, a review from anyone else does not count either, since anyone can review there. Once met, it stays met for the rest of the pull request: GitHub drops a request once that reviewer reviews, and a request removed later still counts.

#### What a `ci` condition counts

The checks pass by GitHub's merge rule on this push: each check's latest run counts, and success, neutral and skipped pass. A name that both a check run and a status report passes only when both do.

- **`required` reads the base branch's rulesets only.** Classic branch protection is not read and counts as nothing required, so `required` passes at once there. It also passes at once with no required check, and on a private repository on GitHub Free, which has no rulesets. On such a branch, list the checks with `{ checks: [names] }` or move the rule to a ruleset.
- **A source the App may not read holds the check.** When Checks or Commit statuses is not granted, a name that reads as passed, or reads nothing, on the other source holds as missing the permission, never as passed. The held list then asks for that permission in place of listing the missing names. A name already failed or running on the source the App can read shows as that, beside the permission line.
- **A check a ruleset pins to one App.** GitHub accepts such a check from that App only, by a check run or a commit status. MergeBrief counts that App's latest run under the name and ignores every status, so the run decides even when the Commit statuses read is refused. Only when the App has no run there does it count the latest status an App's bot account posted under the name, so a status a person posts never releases the push. A status does not say which App's bot posted it, so in that case another App posting the same name counts too, a workflow's status as `github-actions[bot]` included. With no run from its App, a pinned check needs Checks and Commit statuses read, like any other.

#### What a `paths` condition sees

- A renamed file matches by its new path or its old one, and a deleted file by the path it had.
- GitHub lists at most 3,000 changed files, so a pull request changing more matches only the files GitHub lists, inside an `any` group too.
- The file list is read only when `paths` decides the push. While another condition outside an `any` group, or an `any` group without `paths`, holds the push, the list is not read, and the held list leaves `paths` out until the others pass, along with any `any` group that holds it.
- Once a check sees a changed file match, `paths` stays met for the rest of the pull request, even after that file is reverted or renamed away, until this list of globs changes. A file that matched only while another condition held the push, then was reverted, never counted.

#### What a `bots` condition waits on

A bot is told by its own App or bot account, never by a check's name, and only what it reports on the held push counts:

- `finished`: it finished any check run, status or review on this push, whatever the outcome.
- `approved`: its latest approval, change request or dismissed review on this push approves. A later comment leaves the approval standing, and a dismissal never lets an older approval stand again. `claude` and `copilot` never approve.
- `clean`: Claude's latest check run on this push says no issues or counts no `normal` findings. While a rerun is still going, it is running. Only `claude` reports `clean`.

A bot that does not review later pushes leaves every later push held until someone clicks Generate, so each listed bot needs its own setting for that:

- **Greptile**: `autoReview` reviews a pull request only when it opens unless you set it to review new pushes. Its check run posts only with `statusCheck` on.
- **Unblocked**: turn on Re-reviews. Its `Unblocked Review` commit status posts only with its commit status setting on.
- **CodeRabbit**: `auto_incremental_review`, on by default.
- **Claude** (Claude Code Review): the repository's review trigger must run after every push, its default; once on pull request creation, or manual, leaves later pushes held. It skips drafts and fork pull requests, so `claude` holds there.
- **Copilot**: turn on Review new pushes.

`approved` waits for a bot's own auto-approve setting, off by default wherever a bot has one. Greptile and Unblocked approve only a review that found nothing, so for them `approved` already means a clean review. An approval from CodeRabbit or Copilot is not documented to mean that, and a `@coderabbitai approve` comment approves without a review.

Unblocked, CodeRabbit, Claude and Greptile report through check runs and statuses, which the App reads with its Checks and Commit statuses permissions. An installation missing either one holds those bots as missing the permission while they have not reported ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these)). A pull request review from the bot lifts that hold, and so does a run or status through whichever of the two reads the App still has. `clean` reads only Claude's check runs, so it needs Checks alone: a refused Commit statuses read changes nothing for it, and with Checks refused it holds as missing the permission even after Claude reviews. Copilot reports through reviews and is unaffected.

## `policy.yaml` (32 KB, versioned)

```yaml
version: 1
attributes:
  touches-billing:                 # lower-kebab-case, ≤ 50 chars, ≤ 20 entries
    criteria: >                    # ≤ 4,000 chars, model-evaluated
      modifies invoicing, payment, or ledger code
    implication: needs a finance-aware reviewer   # optional, ≤ 500 chars
    paths:                         # optional glob scope (deterministic pre-filter)
      - services/billing/**
deEmphasize:                       # optional display tuning: quiet, never suppress
  - attribute: widens-error-handling
  - attribute: no-tests
    paths: [generated/**]
```

- Custom attributes are **flat facts**: no tier, severity, or weight can
  exist (unknown keys reject the whole file).
- Names colliding with a built-in, parked candidate, or reserved word are
  ignored with a disclosure chip: **built-in wins**, identically day-one or
  after an upgrade.
- **De-emphasis, never suppression**: detection always runs and every
  attribute lands in the artifact and Receipt; de-emphasis only quiets the
  render and drops the attribute from the jump-rail. The floor attributes,
  `touches-auth`, `removes-validation`, `relaxes-permissions`, `adds-secret`,
  `changes-package-source`, cannot be de-emphasized, and a quiet attribute co-firing with a floor attribute
  renders loud.
- Glob scope language: `**` spans directories, `*` within a segment, `?`
  one character.

## Failure semantics

Invalid YAML, unknown keys, an unknown/missing `version`, or an over-cap
file → the file is rejected **whole** (never partially used); generation
proceeds without it and the error shows on the origin chip to both
author and reviewer. A GitHub fetch failure fails **open**: the brief
generates without repo config, recorded loudly as `fetch-failed`.

## Local-only mode (CLI): first slice built

The dotdir also serves a second mode: the `categorize` and `delta` CLIs
read `.mergebrief/settings.yaml` from the **working tree** they run in
(your own machine, your own trust context). Today they read the `trackers:`
block only, version-gated, ignoring other keys; a file that does not parse
yields no tracker and one warning line, never a failed run. Instructions
and policy still come only from the server's default-branch fetch.

## Related instance block: `drafts:` (operator-side)

`mergebrief.config.yaml` (instance config) carries a `drafts` block, the
operator's draft-PR spend knob:

```yaml
drafts:
  debounceSeconds: 900  # optional draft REgeneration window; unset = normal 60s
```

Drafts generate like any pull request. To hold a draft until it is marked
ready, set `readyForReview: on` under
[`triggerConditions:`](#triggerconditions-what-a-push-must-meet-before-it-generates),
in the instance config or in a repository's own settings file. The removed
`drafts.generate` key refuses boot and names that replacement.

`debounceSeconds` damps WIP push-storm spend: a draft's first push in a
storm fixes the start time and later pushes within the window only update
the head the run will brief, so the long window bounds how late a run can
start rather than deferring it. A draft's first brief
always uses the normal window, and `ready_for_review` always enqueues on a
short (~10s) flip window so a just-readied PR is fresh when the reviewer
arrives.
