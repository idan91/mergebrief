# How MergeBrief works

What happens between a push and a brief, for the person who runs an instance: which processes run, how pull requests arrive, when a brief is generated and retried, what the App posts on GitHub, and who can read what. Terms in bold are defined in the [glossary](./glossary.md). Contributors find the package layers, queue internals and scope rules in [`docs/dev/architecture.md`](./dev/architecture.md).

## What runs

One image runs as three services over one Postgres database:

```text
GitHub ──webhook──▶ web :3000 ──/api/*──▶ api ──▶ Postgres ◀── worker ──▶ model provider
reviewer browser ──▶ web                    ▲                     │
mergebrief CLI ──Bearer token──▶ web ───────┘                     └──▶ GitHub
```

- **web** serves the pages and forwards every `/api/*` request to `api`. It is the only service meant to take outside traffic, and it holds no credentials.
- **api** takes GitHub's webhooks, signs reviewers in with GitHub, and answers every read and write the browser and the CLI make. It records pull requests and queues jobs. It never calls a model.
- **worker** takes jobs off the queue, reads the pull request from GitHub, asks your model provider for the brief, stores it, and updates the **Entry comment**.
- **Postgres** holds everything: briefs, review sessions, sign-ins and the job queue itself, so a queued job commits together with the rows it belongs to.

Ports, restart policies and what the host keeps are in [compose.md](./self-host/compose.md#what-runs).

## Where pull requests come from

A pull request reaches MergeBrief one of two ways.

| | Installed repository | Pasted URL |
| --- | --- | --- |
| How it arrives | GitHub sends a webhook for every push, review and CI report on a repository your App is installed on. | A reviewer pastes the pull request's URL on Home, for a repository the App is not installed on. |
| Whose GitHub access reads it | The App's installation token. | The reviewer's own GitHub token. |
| What MergeBrief writes to GitHub | The Entry comment. Reviews and comments go out as the reviewer who submits them. | Nothing on its own. Reviews and comments go out as the reviewer who submits them. |
| How it stays current | Webhooks, plus a read from GitHub when someone opens the Inbox or the brief. | A read from GitHub when someone opens the Inbox or the brief. |

Both kinds produce the same brief. A pasted pull request is not private to the reviewer who pasted it: anyone GitHub lets read the repository opens the same brief. Only the Inbox list of pasted pull requests is per reviewer.

## When a brief is generated

1. **A push arrives.** The api checks the webhook's signature, records the pull request and queues one job. It answers GitHub at once and calls no model.
2. **The job waits about 60 seconds** from the first push. A push inside that window swaps in the newer head without moving the start time, so a burst of pushes becomes one run. Marking a draft ready for review, and pasting a URL, wait 10 seconds instead. The operator can lengthen the wait for drafts that already have a brief (`drafts.debounceSeconds`, [configuration.md](./self-host/configuration.md#drafts-spend-operators-allowed)).
3. **The worker checks whether it may run:**
   - The author must be on the repository's team, or a bot the repository trusts. Anyone else's pull request shows **Brief available on demand** until someone with push access starts it ([Who triggers a brief](./self-host/github-app.md#who-triggers-a-brief)).
   - Every **trigger condition** the instance and the repository set must pass, such as "ready for review" or "CI passed". If one does not, the push is **held**: nothing runs and nothing is spent, and it generates by itself once the conditions pass ([trigger-conditions.md](./repo-config/trigger-conditions.md)).
   - The instance must be under its **daily cap** of started runs ([spend-cap.md](./self-host/spend-cap.md)).
4. **The worker generates the brief** with the provider in the instance config, stores it, and posts the Entry comment. A large pull request is briefed in parts, in a separate pool of worker slots so it does not hold up ordinary pushes ([generators.md](./self-host/generators.md#worker-slots)).

A push during a run stops that run as `superseded` and the newer head generates instead. A submitted review also queues a run, so the reviewer's next **delta brief** is ready before they come back.

## Retries and failures

- **Temporary failures retry by themselves.** A rate limit, a provider or GitHub outage, or a network error puts the job back on the queue with a growing delay.
- **Failures a retry cannot fix stop at once** and mark the brief `failed` with a reason, such as GitHub refusing a diff that is too large.
- **One push gets at most three tries** before it is marked failed. A worker that dies mid-run is detected when its two-minute lease lapses, and another try takes the push over.
- **A failed brief can be run again**, when a rerun can help, with Generate on the pull request's page in MergeBrief or `mergebrief generate <number>`, by someone with push access. The Entry comment and the page say what went wrong; [troubleshooting.md](./self-host/troubleshooting.md) lists each failure with its fix.

## The Entry comment

Each pull request from an installed repository gets one comment from your App. It follows the push:

| When | The comment reads |
| --- | --- |
| A brief is generating | **Brief is generating for this push…**, linking to the live diff |
| The brief is ready | **Read the brief for this push**, linking to it |
| The push is held by a trigger condition | **No brief for** the commit, with a **Generate brief** link |
| The author is not on the team | **A brief for this pull request is available on demand.** |
| The run failed or hit the daily cap | What happened, and when it can run again |

For each new brief the worker deletes its previous comment and posts a fresh one. The comment stays at the bottom of the thread, and subscribers get one notification per finished brief, not one per push. Smaller updates, such as the part count of a large pull request or a held push's status, edit the comment in place, which notifies nobody.

Draft pull requests get the comment too. A repository that sets `entryCommentOnDrafts: false` in its `.mergebrief/settings.yaml` keeps it off until the pull request is ready for review; the brief still generates ([settings.md](./repo-config/settings.md)). A pasted URL pull request never gets an Entry comment.

## Who can read what

- **Signing in** is limited to the people and accounts the instance config lists ([security-model.md](./self-host/security-model.md#who-can-sign-in)).
- **Every read uses your own GitHub access.** When you open a brief, the api checks with your GitHub token that you can read the repository. If you cannot, the answer is "not found", the same as for a pull request that does not exist.
- **A brief is shared.** Everyone who can read the repository on GitHub reads the same brief for the same commit.
- **Your review session is private.** Drafts, read marks and dispositions are yours alone until you submit, and the review posts to GitHub as you.
- **Operators see more of the instance, not more repositories.** An operator can read instance-wide state such as today's generation count, and nothing about a repository their GitHub account cannot read.

The full table of who reads and writes what, the trust boundaries and every outbound destination are in [security-model.md](./self-host/security-model.md).

## Where to go next

- Running it: [compose.md](./self-host/compose.md), [generators.md](./self-host/generators.md), [observability.md](./self-host/observability.md).
- Reviewing from a terminal or an agent: [cli.md](./self-host/cli.md).
- What a repository can change about its briefs: [Configure your repository](./repo-config/README.md).
