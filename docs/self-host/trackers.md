# Trackers: where the primary ticket is read from

The brief's Intent check names one **primary ticket** per PR and reads it
so the model can answer "does this diff do what that ticket asked". Which
reference wins, and how keys are recognised, is repo configuration
([repo-config.md](repo-config.md), the `tracker:` block). This page is the
deployment side: what each tracker's read fetches, with which credential,
and what it reports when it cannot.

## What the read is, and is not

- **A read, never a gate.** An unreadable ticket is reported on the brief
  (`primaryTicket.status: unread` with a reason) and generation continues
  from the diff alone. Nothing blocks, nothing fails, nothing is retried
  across runs.
- **One tracker, one read.** The repo's `tracker:` block selects the one
  read a deployment runs for it, GitHub when there is no block. Only that
  tracker's references are candidates; a reference to any other tracker
  stays ordinary text.
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

Built in, and the default: a repo with no `tracker:` block reads GitHub. Nothing to configure and no config entry: the read runs
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
| Worker (URL-box job) | the viewer's token, or the operator PAT fallback | whatever that token can read |
| `mergebrief` CLIs | `gh` — `GH_TOKEN` / `GITHUB_TOKEN`, or `gh auth login` | whatever the logged-in account can read |

**No permission change.** GitHub authorizes `Get an issue` under
`Issues: read` **or** `Pull requests: read`, and the App already holds
`Pull requests: write` ([github-app.md](github-app.md)). `Issues` stays
off.

Installation reach, in practice:

- A ticket in a **sibling repository** of the same installation
  (`owner/repo#N`, an issue URL, or `tracker.issuesRepo`) reads fine.
- A ticket in a **private repository outside** the installation is
  `not-found` — GitHub answers 404, not 403, so the brief cannot tell
  "does not exist" from "cannot see".
- A ticket in a **public repository outside** the installation: GitHub's
  documented behaviour is that an installation token can read public
  repositories' issues. **Unverified** on this deployment — no live call has
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

<!-- TODO PR5: the Notion half — token env var, contextSources: entry, key and URL lookup, reach and reasons. -->

Not yet documented on this page; the `tracker:` block shape for Notion is
in [repo-config.md](repo-config.md).
