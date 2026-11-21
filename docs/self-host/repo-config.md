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
  settings.yaml      # workflow behavior (v1: entryCommentOnDrafts, trackers, trustedBots)
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
Generation itself always runs for drafts (subject to the instance `drafts:`
knob below); this gates the comment only. When the settings file cannot be
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

Every condition must pass, unless it sits in an `any:` group, where one
passing condition is enough. A push that misses one is **held**: nothing
runs and nothing is spent, it generates by itself once every condition
passes, and anyone with push access can generate it now from the PR's page
in MergeBrief. With no conditions set here or on the instance, every push
generates as before.

A held push edits an existing Entry comment in place, so nobody is notified
again; a PR with no Entry comment gets one posted. The comment names each
unmet condition and whose setting it is, with a Generate link and a link to
the last brief. When the push generates, the comment turns to the
generating line the same quiet way, and the ready brief is the one
notification.

| Key | Value | Met when |
| --- | --- | --- |
| `readyForReview` | `on` | The pull request is not a draft. |
| `size` | `changedLines`, `additions` and/or `deletions`, each `{ min, max }` (inclusive, either or both) | Every bound holds for GitHub's totals for the whole pull request. `changedLines` is additions plus deletions. |
| `bots` | A map of `unblocked`, `coderabbit`, `claude`, `greptile` or `copilot` to `finished`, `approved` or `clean` | Every listed bot gave that verdict on this push. `claude` and `copilot` never approve; only `claude` reports `clean`. |
| `reviewRequested` | `on` | A review is requested from a person or a team and not yet given; a request to a bot does not count. GitHub drops a request once that reviewer reviews. |
| `ci` | `required`, or `{ checks: [names] }` | The checks pass by GitHub's merge rule on this push. `required` reads the base branch's rulesets, not classic branch protection. |
| `paths` | A list of globs, in the glob language `policy.yaml`'s `paths` uses | A changed file matches one, case as written. A renamed file counts by its new path, a deleted file by the path it had. This file only; the instance config refuses it. |
| `labels` | A list of label names | The pull request carries one of them. Case is ignored, as GitHub ignores it in label names. |
| `titleKeywords` | A list of words | The title contains one of them as a whole word, ignoring case: `wip` matches `[WIP] Add widgets` but not `Wipe the cache`. A phrase matches as written, and a keyword in a script written without spaces, such as Chinese, Japanese or Thai, matches anywhere in the title. |
| `baseBranches` | A list of branch names | The pull request targets one of them directly, exact name and case. A stacked PR into another branch stays held until it retargets. |
| `never` | `on` | Never: every push waits for a Generate click. It stands alone. |
| `any` | A map of two or more of the kinds above, `never` excepted | One of them is met. |

The instance's conditions apply too, merged per kind: a kind you set here
replaces the instance's, a kind you leave out is inherited, and a list is
one value. A kind's place travels with its value, so one you set inside
`any:` sits in the group even where the instance set it outside. There is
one `any:` group: the instance's inherited members and yours join it, and
one passing member from either is enough. `<kind>: off` drops one inherited
kind, and `triggerConditions: off` drops them all. An empty block is
invalid. A bad block rejects the
whole file, and a file that cannot be read or is rejected applies the
instance's conditions alone. The block is read from the default branch
only, so a pull request's own edit to it applies once merged.

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
