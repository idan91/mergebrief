# Glossary

The words MergeBrief uses on screen, in its comments and in these docs. Each entry says what the thing is and links the page that covers it.

## The brief and what is in it

**Brief.** What MergeBrief writes for a pull request: a summary, the changes grouped by intent, and the risks a reviewer should look at first. One brief covers the whole pull request, base to head, at one commit, and every reviewer reads the same one. It is computed in the background after a push ([How MergeBrief works](./architecture.md)).

**Revision.** The number of a brief within its pull request: the first brief is revision 1, the brief for a later push is revision 2, and so on. It counts briefs, not pushes, and it is the same for every reviewer. The CLI's `--revision <n>` takes it ([cli.md](./use/cli.md#which-revision-a-command-reads)).

**Span.** The two commits a brief or a diff covers, written `base..head` (`93f1a2c..4c0a9be`): the pull request's base and the head the brief was written for. Brief details and `mergebrief pr <n>` print it. Between two pushes, the revision span is the pull request's own change from one head to the next, which a rebase or base merge does not inflate ([Pushes, rebases and force pushes](./self-host/generators.md#pushes-rebases-and-force-pushes)).

**Change group.** A set of changes that together do one thing, such as "fix the cross-tenant leak". It carries a summary and a category (`bugfix`, `pure-move`, `lib-bump` and so on). The changes no group claims form one last group, the unattributed remainder.

**Chunk.** A run of changed lines that belong to one change group and one kind of content (`implementation`, `test`, `config` and so on). A chunk can be smaller than a git hunk, and one file's chunks can sit in different groups. It is the unit you mark as read.

**Risk surface.** Factual attributes MergeBrief attaches to a chunk, such as `touches-auth`, `no-tests` or `adds-secret`. They describe the change, never judge it. The full list is [risk-surface.md](./vocabulary/risk-surface.md); a repository can add its own ([policy.md](./repo-config/policy.md)).

**Flag.** One risk surface attribute firing on one chunk: an item that asks for a reviewer's attention.

**Disposition.** A reviewer's decision on a flag: addressed, with evidence such as a comment or a read chunk, or dismissed, with a reason. It is tied to the code region, so it carries over to the next brief.

**Intent check.** A section of the brief that compares what the pull request says it does (its title, description and primary ticket) with what the diff does. It lists what was done, what was stated but is missing, and what was done but not stated. When the stated intent is too broad to compare, it says so instead of guessing. It is the model's reading, never a verdict.

**Product diff.** A section of the brief that says how the product behaves before the pull request and after it, as at most eight changes. A brief generated in parts reports it as not available, because no single call read the whole diff. `mergebrief product-diff` prints it ([cli.md](./use/cli.md#commands)).

**Primary ticket.** The one ticket a pull request names, read from your tracker for the intent check ([trackers.md](./self-host/trackers.md)).

**Delta brief.** What changed since you last submitted a review on the pull request, rather than the whole pull request again. `mergebrief delta` prints it.

**Checkpoint.** The commit at which you last submitted a review on a pull request. Your delta brief starts there. Only submitting moves it; reading does not.

## Reviewing

**Home.** The page at `/`. Signed in, it holds the box to paste a pull request URL and your Inbox. Signed out, it is the sign-in page.

**Inbox.** The list on Home, labelled "Briefs": every pull request you reach across the App's installations, plus the ones you pasted, each with your review state. `mergebrief pr` with no number prints it.

**Review session.** Your private work on one brief: draft comments, read marks, dispositions, category overrides and the outcome you chose. Nobody else sees it, and nothing reaches GitHub until you submit. A newer brief starts a new session, which carries your work over at its first write.

**Draft comment.** A comment held in your review session. Drafts post to GitHub together when you submit.

**Receipt.** What the review records about itself when you submit: chunks read, flags addressed, dismissed and still open, comments, and the provider and model that generated the brief. Its counts ride on the review's signature line. It is never an approval: only a person approves.

**Submit.** Posting your review to GitHub as yourself, with its comments and outcome (comment, approve or request changes). It is the only thing that moves your checkpoint.

## Generating

**Entry comment.** The one comment your GitHub App keeps on each pull request, linking to its brief. It reads **Brief is generating for this push…** while a brief generates and **Read the brief for this push** once it is ready. MergeBrief deletes it and posts a fresh one for each new brief, so it stays at the bottom of the thread. A pasted URL pull request never gets one ([How MergeBrief works](./architecture.md#the-entry-comment)).

**Generation.** MergeBrief's record of producing the brief for one push: pending, running, held, or finished (succeeded, failed, superseded, capped, awaiting trigger).

**Superseded.** A generation a newer push replaced before it finished. Nothing is wrong: the newer push gets its own brief. A run briefing a large pull request in parts is never superseded once it has grouped the changes and started on the parts: it finishes the brief for its own head first ([When a brief is generated](./architecture.md#when-a-brief-is-generated)).

**Salvage.** A repair the worker makes to a model answer instead of failing it, such as dropping one invalid category tag. A salvaged brief is valid and lists the repair in its warnings block ([When something degrades](./self-host/generators.md#when-something-degrades)).

**Trigger.** What starts a brief: every push to an open pull request, drafts included, about 60 seconds after the first push of a burst ([How MergeBrief works](./architecture.md#when-a-brief-is-generated)).

**Trigger condition.** A rule a push must meet before it generates a brief, such as "ready for review" or "CI passed". An operator sets them for the instance and a repository sets its own ([trigger-conditions.md](./repo-config/trigger-conditions.md)).

**Held push.** A push whose trigger conditions are not met. Nothing runs and nothing is spent. It generates by itself once every condition passes, or at once when someone with push access clicks Generate. The pull request page shows "No brief for this push yet", and `mergebrief pr <n>` prints a `held:` line naming each unmet condition ([cli.md](./use/cli.md#when-the-brief-is-not-ready)).

**Trusted author.** An author whose pushes generate a brief without anyone's go-ahead: someone on the repository's team, or a bot the repository lists in `trustedBots`.

**Awaiting trigger.** A pull request from an author who is not trusted. The page and the Entry comment say **Brief available on demand**, and nothing runs until someone with push access starts the first brief from MergeBrief. That click is the trigger approval: from then on every push generates as usual ([github-app.md](./self-host/github-app.md#who-triggers-a-brief)).

**Daily cap.** The most generation runs the instance starts in one UTC day, across every repository: 300 unless the instance config says otherwise ([spend-cap.md](./self-host/spend-cap.md)).

**Slot.** One generation a worker process runs at a time. The worker has a normal pool of slots and a large pool for pull requests that take several model calls ([generators.md](./self-host/generators.md#worker-slots)).

## Running an instance

**Instance.** One running MergeBrief: the api, the web tier and the worker over one Postgres database.

**Operator.** A person who runs the instance. In the app, a GitHub user whose numeric id the instance config lists under `operators`; an operator can read instance-wide state such as today's generation count. The role grants no access to any repository ([Who can sign in](./self-host/security-model.md#who-can-sign-in)).

**Installation.** One install of your GitHub App on one organization or user account. A pull request from an installed repository reaches MergeBrief through the App's webhooks.

**Pasted pull request.** A pull request a reviewer added by pasting its URL on Home, for a repository the App is not installed on; also called a URL pull request. It is read with that reviewer's own GitHub token, gets no Entry comment, and MergeBrief never writes to GitHub for it.

**Instance config.** `mergebrief.config.yaml`: the operator's settings, such as the model provider, the daily cap, who may sign in and instance-wide trigger conditions ([configuration.md](./self-host/configuration.md#instance-config-mergebriefconfigyaml)).

**Repo config.** The `.mergebrief/` folder a repository commits on its default branch: `settings.yaml`, `policy.yaml` and `instructions.md` ([Configure your repository](./repo-config/README.md)).
