# Choose which pushes get a brief

By default every push to an open pull request generates a brief. A `triggerConditions:` block in `.mergebrief/settings.yaml` makes a push wait until it meets conditions you choose: the pull request is out of draft, CI passed, a review bot finished, a label is on it, and so on. A push that misses a condition is **held**: nothing runs and nothing is spent until it passes, or until someone with push access presses Generate.

The rest of `settings.yaml` is on [Settings](./settings.md). The instance's operator can set conditions for every repository too; [yours merge over theirs](#how-the-instances-conditions-merge-with-yours).

## Check a recipe

Every recipe below is a whole `settings.yaml`. To try one:

1. Put it in `.mergebrief/settings.yaml` (add the block to the file you already have) and merge it to the default branch. MergeBrief reads the file from the default branch only, so the pull request that adds it is not held by it.
2. Push to a pull request that misses the condition.
3. Open the pull request in MergeBrief. Instead of a brief it shows **No brief for this push yet**, and lists each unmet condition marked **Repository** (yours) or **Instance** (the operator's). The Entry comment on GitHub lists the same reasons.
4. Meet the condition. The push generates by itself.

If the push generates at once instead, the file was probably rejected: open the last brief's details (the `i` button in its header) and look at the Repo config section ([Check that your config applied](./README.md#check-that-your-config-applied)).

## Hold drafts until they are ready for review

Draft pull requests wait. Marking one ready for review generates its latest push.

```yaml
version: 1
triggerConditions:
  readyForReview: on
```

A held draft shows **Needs this pull request marked ready for review**. Whether the Entry comment posts on drafts is a separate setting, [`entryCommentOnDrafts`](./settings.md#keep-the-entry-comment-off-drafts).

## Wait for required CI

A push waits until the checks your base branch requires have passed on it.

```yaml
version: 1
triggerConditions:
  ci: required
```

`required` reads the base branch's **rulesets** only. On a branch protected by classic branch protection, or with no required check, or in a private repository on GitHub Free, nothing counts as required and the condition passes at once. There, [name the checks](#wait-for-named-checks) instead.

A held push shows **Waiting for CI: build still running**, **CI failed: build**, or **Waiting for CI: build has not reported on this push**.

## Wait for named checks

A push waits until each named check has passed on it, whatever the branch requires.

```yaml
version: 1
triggerConditions:
  ci:
    checks: [build, test]
```

Write each name exactly as the check run or commit status reports it, case included. A GitHub Actions job reports its job name (`build`), not the `CI / build (pull_request)` line the pull request's checks list shows. A check that never reports holds the push until someone presses Generate. How a check passes is under [What a `ci` condition counts](#what-a-ci-condition-counts).

## Brief only pull requests above a size

Small pull requests get no brief by themselves; someone with push access can still press Generate.

```yaml
version: 1
triggerConditions:
  size:
    changedLines: { min: 200 }
```

`changedLines` is additions plus deletions across the whole pull request, as GitHub counts them. You can bound `additions` and `deletions` the same way, and set `min`, `max` or both on each; both bounds are inclusive. A held push shows **120 changed lines, under the 200 minimum**.

To skip very large pull requests instead, set a maximum:

```yaml
version: 1
triggerConditions:
  size:
    changedLines: { max: 1500 }
```

> [!WARNING]
> A pull request over a `max` never generates by itself while it stays that large. It waits for a Generate click.

## Brief only changes to some paths

A push generates only when the pull request changes a file under one of these paths.

```yaml
version: 1
triggerConditions:
  paths:
    - services/billing/**
    - packages/api/**
```

Globs are anchored at the repository root and case-sensitive. `**` spans directories, `*` stays inside one directory, so `*.sql` matches only SQL files at the root and `**/*.sql` matches them anywhere ([Glob patterns](./policy.md#glob-patterns)). Only a repository sets `paths`; the instance config refuses it. A held push shows **Changes no file matching one of** and your globs. See [What a `paths` condition sees](#what-a-paths-condition-sees) for renames and very large pull requests.

## Wait for a review bot

A push waits until a review bot has given its verdict on it, so the brief can sit beside the bot's review.

```yaml
version: 1
triggerConditions:
  bots:
    coderabbit: approved
```

Each bot takes `finished`, `approved` or `clean`:

| Bot key | Bot | `finished` | `approved` | `clean` |
| --- | --- | --- | --- | --- |
| `unblocked` | Unblocked | yes | yes | no |
| `coderabbit` | CodeRabbit | yes | yes | no |
| `greptile` | Greptile | yes | yes | no |
| `claude` | Claude Code Review | yes | no | yes |
| `copilot` | Copilot | yes | no | no |

List several bots to wait for all of them. Each bot must be set to review every push, or later pushes stay held: see [What a `bots` condition waits on](#what-a-bots-condition-waits-on) for each bot's setting and the GitHub App permissions it needs. A held push shows **Waiting for CodeRabbit to finish** or **CodeRabbit finished without approving**.

## Wait until someone requests a review

A push waits until a review is requested from a person or a team, so work in progress is not briefed.

```yaml
version: 1
triggerConditions:
  reviewRequested: on
```

Once met it stays met for the rest of the pull request. A review from someone on the repository's team also meets it ([Who counts for `reviewRequested`](#who-counts-for-reviewrequested)). A held push shows **Needs a review requested from someone**.

## Brief only pull requests with a label

A push generates only when the pull request carries one of these labels. Adding the label later generates the latest push.

```yaml
version: 1
triggerConditions:
  labels: [needs-brief]
```

Case is ignored, as GitHub ignores it in label names. A held push shows **Needs the label needs-brief**. To match a word in the title instead, use `titleKeywords`:

```yaml
version: 1
triggerConditions:
  titleKeywords: [brief, review-me]
```

A keyword matches as a whole word, ignoring case: `wip` matches `[WIP] Add widgets` but not `Wipe the cache`. A phrase matches as written, and a keyword in a script written without spaces, such as Chinese, Japanese or Thai, matches anywhere in the title.

## Brief only when someone asks

No push generates by itself. Someone with push access presses Generate on each one they want.

```yaml
version: 1
triggerConditions:
  never: on
```

`never` stands alone: a block that sets it with any other condition is rejected. A held push shows **Generates only when someone presses Generate**.

## Hold stacked pull requests until they target main

In a stack, each pull request targets the one below it. This holds every pull request that does not target `main` directly, so a stacked one generates once it is retargeted.

```yaml
version: 1
triggerConditions:
  baseBranches: [main]
```

Branch names match exactly, case included. A held push shows **Targets feature/login, not main**.

## Turn off the instance's conditions

Drop every condition the operator set, so every push in this repository generates:

```yaml
version: 1
triggerConditions: off
```

Or drop one inherited kind and keep the rest:

```yaml
version: 1
triggerConditions:
  size: off
```

A kind you set replaces the instance's, so you only need `off` for a kind you want gone. See [How the instance's conditions merge with yours](#how-the-instances-conditions-merge-with-yours).

## Accept any one of several conditions

Conditions outside `any:` must all pass. Inside `any:`, one passing member is enough. This generates a pull request that is labelled `needs-brief` or changes at least 500 lines, and in either case is out of draft:

```yaml
version: 1
triggerConditions:
  readyForReview: on
  any:
    labels: [needs-brief]
    size:
      changedLines: { min: 500 }
```

An `any:` group names at least two kinds. A held push shows **Needs one of these:** followed by each member's reason.

## Combine conditions

Every condition you list is required, unless it sits inside `any:`. A condition says what a push needs, never what excuses it: there is no "except" or "unless" form. To brief everything but one kind of pull request, require what the others have, as in [Hold stacked pull requests until they target main](#hold-stacked-pull-requests-until-they-target-main).

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

This push generates only when the pull request is out of draft, and changes at most 1,500 lines, and Unblocked finished on it, and it carries `needs-brief`.

> [!WARNING]
> Each line narrows the set. With this block, a labelled pull request over 1,500 lines never generates by itself, and neither does an unlabelled one of any size. Put alternatives in `any:`.

## Skip the wait on one pull request

Anyone with push access can generate a held push from the pull request's page in MergeBrief or its row menu in the Inbox:

- **Generate brief** generates this push now. `mergebrief generate <number>` does the same from the [CLI](../self-host/cli.md).
- **Generate on every push** generates this push now and skips the conditions for every later push of the pull request. On the page it sits in the menu beside Generate brief. The Inbox row menu shows it as a checked item while it is on, and that is where you turn it off. A pull request whose author needs a Trigger approval still waits for one.

## Reference

### Kinds

| Key | Value | Met when |
| --- | --- | --- |
| `readyForReview` | `on` | The pull request is not a draft. |
| `size` | `changedLines`, `additions` and/or `deletions`, each `{ min, max }` (inclusive, either or both) | Every bound holds for GitHub's totals for the whole pull request. `changedLines` is additions plus deletions. |
| `bots` | A map of `unblocked`, `coderabbit`, `claude`, `greptile` or `copilot` to `finished`, `approved` or `clean` | Every listed bot gave that verdict on this push ([What a `bots` condition waits on](#what-a-bots-condition-waits-on)). |
| `reviewRequested` | `on` | A review was requested from a person or a team, or someone on the repository's team other than the author has reviewed ([Who counts for `reviewRequested`](#who-counts-for-reviewrequested)). |
| `ci` | `required`, or `{ checks: [names] }` | The checks pass by GitHub's merge rule on this push ([What a `ci` condition counts](#what-a-ci-condition-counts)). |
| `paths` | A list of globs ([Glob patterns](./policy.md#glob-patterns)) | A changed file matches one, case as written ([What a `paths` condition sees](#what-a-paths-condition-sees)). This file only; the instance config refuses it. |
| `labels` | A list of label names | The pull request carries one of them, ignoring case. |
| `titleKeywords` | A list of words | The title contains one of them as a whole word, ignoring case. |
| `baseBranches` | A list of branch names | The pull request targets one of them directly, exact name and case. |
| `never` | `on` | Never: every push waits for a Generate click. It stands alone. |
| `any` | A map of two or more of the kinds above, `never` excepted | One of them is met. |

`reviewRequested` stays met for the rest of the pull request once met, and `paths` once a check sees it met, inside an `any` group too. Every other kind is checked again on each push, so moving a pull request back to draft or removing a label holds its next push.

### Rules the block must follow

A block that breaks any of these rejects the whole `settings.yaml`, its `trackers` and `trustedBots` included, and the instance's conditions apply alone until you fix it.

- `on` and `true` mean the same, as do `off` and `false`.
- A list (`paths`, `labels`, `titleKeywords`, `baseBranches`, `ci.checks`) holds 1 to 50 entries of at most 200 characters each, and no entry twice.
- `size` names at least one of `changedLines`, `additions` and `deletions`. Each bound is a whole number of 0 or more, and `min` is not above `max`.
- `bots` names at least one bot. `claude` and `copilot` never take `approved`; only `claude` takes `clean`.
- `any:` names at least two kinds and never `never`. A kind cannot sit both inside `any:` and outside it, `<kind>: off` is refused inside `any:`, and a kind switched off outside cannot be set inside.
- `never: on` stands alone.
- An empty block is refused. To set no conditions, write `triggerConditions: off`.
- Any other key is refused.

### A held push

A held push generates by itself once every condition passes. MergeBrief checks it again when:

- a label is added or removed, the pull request moves to draft or out of it, its title or base branch is edited, or a review is requested or a request withdrawn;
- someone submits a review;
- a check run finishes or a commit status lands on the push, while a `bots` or `ci` condition holds it. MergeBrief waits about 45 seconds first, so a burst of CI results costs one check.

The Entry comment follows the hold without notifying anyone again. A held push edits an existing Entry comment in place, and a pull request with no Entry comment gets one posted. The comment names each unmet condition and whose setting it is, with a Generate link and a link to the last brief. When the push generates, the comment turns to the generating line the same quiet way, and the ready brief is the one notification.

### How the instance's conditions merge with yours

The instance's conditions apply too, merged per kind:

- A kind you set here replaces the instance's. A list is one value, so your `labels` replaces the instance's list instead of adding to it.
- A kind you leave out is inherited.
- `<kind>: off` drops one inherited kind, and `triggerConditions: off` drops them all.
- A kind's place travels with its value, so one you set inside `any:` sits in the group even where the instance set it outside.
- There is one `any:` group. The instance's inherited members and yours join it, and one passing member from either is enough.

For example, with this instance config:

```yaml
# mergebrief.config.yaml
triggerConditions:
  readyForReview: on
  size: { changedLines: { max: 1500 } }
```

and this repository file:

```yaml
version: 1
triggerConditions:
  size: off
  any:
    labels: [needs-brief]
    titleKeywords: [brief]
```

a push in this repository generates once its pull request is ready for review (inherited) and either carries the `needs-brief` label or has `brief` in its title. The size limit no longer applies.

A file that cannot be read, or is rejected, applies the instance's conditions alone.

### Who counts for `reviewRequested`

The condition is met once either of these happens:

- A review is requested from a person or a team.
- Someone on the repository's team other than the author reviews: a repository owner, organization member or collaborator, anyone with write access, or on a private repository anyone at all.

A bot's request or review does not count. On a public or internal repository, a review from anyone else does not count either, since anyone can review there. Once met, it stays met for the rest of the pull request: GitHub drops a request once that reviewer reviews, and a request removed later still counts.

### What a `ci` condition counts

The checks pass by GitHub's merge rule on this push: each check's latest run counts, and success, neutral and skipped pass. A name that both a check run and a status report passes only when both do.

- **`required` reads the base branch's rulesets only.** Classic branch protection is not read and counts as nothing required, so `required` passes at once there. It also passes at once with no required check, and on a private repository on GitHub Free, which has no rulesets. On such a branch, list the checks with `{ checks: [names] }` or move the rule to a ruleset.
- **A source the App may not read holds the check.** When Checks or Commit statuses is not granted, a name that reads as passed, or reads nothing, on the other source holds as missing the permission, never as passed. The held list then asks for that permission in place of listing the missing names. A name already failed or running on the source the App can read shows as that, beside the permission line.
- **A check a ruleset pins to one App.** GitHub accepts such a check from that App only, by a check run or a commit status. MergeBrief counts that App's latest run under the name and ignores every status, so the run decides even when the Commit statuses read is refused. Only when the App has no run there does it count the latest status an App's bot account posted under the name, so a status a person posts never releases the push. A status does not say which App's bot posted it, so in that case another App posting the same name counts too, a workflow's status as `github-actions[bot]` included. With no run from its App, a pinned check needs Checks and Commit statuses read, like any other.

### What a `paths` condition sees

- A renamed file matches by its new path or its old one, and a deleted file by the path it had.
- GitHub lists at most 3,000 changed files, so a pull request changing more matches only the files GitHub lists, inside an `any` group too.
- The file list is read only when `paths` decides the push. While another condition outside an `any` group, or an `any` group without `paths`, holds the push, the list is not read, and the held list leaves `paths` out until the others pass, along with any `any` group that holds it.
- Once a check sees a changed file match, `paths` stays met for the rest of the pull request, even after that file is reverted or renamed away, until this list of globs changes. A file that matched only while another condition held the push, then was reverted, never counted.

### What a `bots` condition waits on

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

Unblocked, CodeRabbit, Claude and Greptile report through check runs and statuses, which the App reads with its Checks and Commit statuses permissions. An installation missing either one holds those bots as missing the permission while they have not reported ([github-app.md](../self-host/github-app.md#permissions-least-privilege-exactly-these)). A pull request review from the bot lifts that hold, and so does a run or status through whichever of the two reads the App still has. `clean` reads only Claude's check runs, so it needs Checks alone: a refused Commit statuses read changes nothing for it, and with Checks refused it holds as missing the permission even after Claude reviews. Copilot reports through reviews and is unaffected.
