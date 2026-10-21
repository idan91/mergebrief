# Research: agent skills that operate CLIs

Primary-source research retrieved 2026-08-15. The question is not merely
whether these skills are popular; it is what their actual `SKILL.md` files teach
us about building a small MergeBrief skill over an agent-complete CLI.

## Conclusion

The evidence supports the direction already established for MergeBrief:

> Put Product Queries and Product Actions, validation, stable identifiers,
> structured output, and error semantics in the CLI. Keep the skill as a small
> review workflow plus judgment and authorization policy.

The most relevant negative evidence is unusually strong. GitHub's
`awesome-copilot` repository once carried a 2,187-line `gh-cli` skill that was
essentially a command manual. GitHub removed it in May 2026 because newer
Copilot CLI behavior already handled relevant read-only `gh` commands and the
models had adequate general `gh` knowledge. The
[removal commit](https://github.com/github/awesome-copilot/commit/352def3ca2a5c4868913a9bdea8c9a78fe6d0bc7)
explicitly says the skill was no longer needed. The
[last version of the skill](https://github.com/github/awesome-copilot/blob/68120732cf9e69de8bec6a2b06a57b7463222440/skills/gh-cli/SKILL.md)
enumerated the CLI tree and copied hundreds of commands and flags. That is the
failure mode to avoid: a static Product Operation catalog in `SKILL.md` spends
context and creates a second manual that drifts from the executable contract.

The closest positive example is `gh-axi`. Its 69-line generated skill sends the
agent to a live dashboard, contextual next-step hints, and command-local help.
The command summary is generated from the same help source as the CLI and a test
fails when the committed skill drifts. That is much closer to MergeBrief's
desired split than any handwritten command reference.

The best composite pattern found is:

1. a precise trigger description;
2. one short preflight that verifies authentication, CLI compatibility, and
   current state;
3. a domain workflow, expressed as decisions rather than a command catalog;
4. explicit authority boundaries before externally visible or destructive
   actions;
5. JSON-first CLI reads and stable exit/error semantics;
6. persistent domain state that lets a later agent reconstruct and resume;
7. the skill shipped with or version-bound to the CLI, with an explicit drift
   check.

## Adoption signals and their limits

GitHub stars below are repository-level snapshots from the official
[GitHub repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository),
not ratings of an individual skill. They establish distribution and scrutiny,
not correctness.

| Example | Publisher | Repository adoption on 2026-08-15 | Why it is useful here |
| --- | --- | ---: | --- |
| Retired `gh-cli` | GitHub | [`github/awesome-copilot`: 37,882 stars, 4,777 forks](https://api.github.com/repos/github/awesome-copilot) | A high-adoption, first-party counterexample that was removed after becoming redundant and bloated. |
| `gh-axi` | AXI project | [`kunchenguid/gh-axi`: 231 stars, 44 forks](https://api.github.com/repos/kunchenguid/gh-axi); parent [`kunchenguid/axi`: 1,842 stars, 133 forks](https://api.github.com/repos/kunchenguid/axi) | The closest positive analogue: small generated skill, live contextual discovery, compact output, drift test, and a published evaluation. |
| `deploy-to-vercel` | Vercel | [`vercel-labs/agent-skills`: 30,067 stars, 2,683 forks](https://api.github.com/repos/vercel-labs/agent-skills) | Strong decision flow, state inspection, authorization, and structured-output habits; too much transport fallback logic. |
| `gh-address-comments` | OpenAI | [`openai/skills`: 24,964 stars, 1,697 forks](https://api.github.com/repos/openai/skills) | A very small workflow skill whose helper exposes what should instead be a first-class MergeBrief query. |
| `gsccli` | CLI author | [`nalyk/gsccli`: 4 stars](https://api.github.com/repos/nalyk/gsccli) | Weak adoption signal, but the closest structural analogue: the CLI ships, installs, versions, and checks its own skill. |

## Comparison

| Example | Context efficiency | Command discovery | Safety and authority | Resumability | Machine-readable output | Drift control |
| --- | --- | --- | --- | --- | --- | --- |
| Retired `gh-cli` | Poor: 2,187 lines of reference material | Static exhaustive list | Poor: destructive examples such as repository deletion sit beside reads without an operating policy | None | Shows many `--json` examples, but as copied documentation | Poor; command fixes required skill edits, and GitHub ultimately removed it |
| `gh-axi` | Strong: 69-line generated skill; minimal default fields, truncation, and full-detail escape hatches live in the CLI | No-args live dashboard, contextual `help:` after results, and command-local `--help` | Mixed: protects secrets, rejects unknown input, and claims idempotent mutations, but context hints can recommend approval, merge, or deletion without a user-authority policy | Re-reads current GitHub state; no durable task/session model | TOON output, totals, summaries, structured errors, and context-aware next commands | Strong: skill generated from shared CLI guidance; test compares generated and committed files; CLI self-update check |
| `deploy-to-vercel` | Mixed: focused on one outcome, but 296 lines and several environment-specific fallbacks | Starts from four state checks, then follows a decision tree | Strong: preview by default, production only when explicit, and approval before a git push | Reconstructs from git remote, `.vercel` link state, login, and team state; no explicit operation receipt | Uses `vercel teams list --format json`, `vercel ls --format json`, and a fallback script that returns JSON | Same publisher as the platform, but flags and fallback behavior are still copied into prose without a compatibility handshake |
| `gh-address-comments` | Strong: 25-line `SKILL.md`; complexity moves to a helper | One curated query instead of a full `gh` manual | Strong for scope: authenticate, summarize numbered review items, then ask which to address | Re-fetches current PR state; no durable record of agent decisions | Helper emits one JSON document containing PR metadata, comments, reviews, and threads | The 237-line GraphQL helper can drift independently from GitHub; it compensates for a missing high-level CLI query |
| `gsccli` | Good: 124 lines covering preflight, workflows, gotchas, output, and recovery | Summarizes nine command groups and ten high-value workflows; does not reproduce every flag | Mixed: credentials are protected and writes are called out, but the skill lacks explicit confirmation rules for mutations | Project-local default site, cache guidance, and isolated config help reconstruction; no workflow session | Deliberately separates stdout data from stderr status; supports JSON, NDJSON, CSV, and documented exit codes | Best example: `compatibility.min_version`, skill installed from the CLI, and `skills status` detects an out-of-sync installed copy |

## Example analysis

### 1. GitHub's removed `gh-cli`: the command-manual anti-pattern

The [last `SKILL.md`](https://github.com/github/awesome-copilot/blob/68120732cf9e69de8bec6a2b06a57b7463222440/skills/gh-cli/SKILL.md)
is a comprehensive GitHub CLI reference. It repeats installation, authentication,
the full command hierarchy, environment variables, and large sections for
repositories, issues, pull requests, Actions, projects, releases, gists,
Codespaces, organizations, extensions, and `gh api`.

What it did well:

- broad command coverage;
- many examples of `--json` and `--jq` for agent-friendly reads;
- a single discoverable place for agents unfamiliar with `gh`.

What it did poorly:

- loaded an enormous mostly irrelevant operation catalog for any one task;
- mixed read examples and destructive mutations without task-level authority
  rules;
- duplicated information available from `gh help` and the official CLI manual;
- required maintenance when flags changed: its history includes fixes to
  `gh pr review` examples before removal;
- provided no durable workflow state or resumption protocol.

The decisive lesson is the repository's own conclusion. The
[removal commit](https://github.com/github/awesome-copilot/commit/352def3ca2a5c4868913a9bdea8c9a78fe6d0bc7)
states that built-in handling of certain read-only `gh` commands plus model
knowledge made the skill redundant. MergeBrief should start on the other side of
that transition: make the CLI self-describing and keep its skill out of the
reference-manual business.

### 2. `gh-axi`: the closest positive pattern

The pinned
[`gh-axi/SKILL.md`](https://github.com/kunchenguid/gh-axi/blob/e9121c58089d6b46e98fc6346be54fd2b383fbd0/skills/gh-axi/SKILL.md)
is 69 lines. It tells the agent to run a no-args dashboard, drill into the
relevant domain, follow contextual `help:` suggestions from each response, and
use command-local `--help` for detail. It lists only 15 top-level command groups
rather than reproducing subcommands and schemas.

The important implementation choice is that the skill is generated. The
[`src/skill.ts` source](https://github.com/kunchenguid/gh-axi/blob/e9121c58089d6b46e98fc6346be54fd2b383fbd0/src/skill.ts)
imports shared CLI description/help content and extracts the command block from
the same top-level help rendered by the executable. The
[`skill test`](https://github.com/kunchenguid/gh-axi/blob/e9121c58089d6b46e98fc6346be54fd2b383fbd0/test/skill.test.ts)
compares generated Markdown byte-for-byte with the committed `SKILL.md`. The CLI
therefore owns discovery; the skill provides the entry route.

Its agent-facing CLI design is also relevant:

- small default list projections with a `--fields` escape hatch;
- truncated long content with explicit full-content recovery;
- totals and precomputed summaries, so the agent can tell whether a list is
  complete without an extra call;
- structured errors with actionable next commands;
- unknown flags and arguments rejected instead of silently ignored;
- secret values accepted through stdin rather than process arguments;
- mutations described as idempotent and explicit about what changed.

The project published a
[425-run benchmark study](https://github.com/kunchenguid/axi/blob/6620e2b6138a7fc146181dcbb59865f1b93b3e28/bench-github/published-results/STUDY.md):
17 GitHub tasks, five interface conditions, five repeats, one repository, and
Claude Sonnet 4.6 as both agent and judge. The `gh-axi` condition passed all 85
of its runs and averaged 46,462 input tokens, $0.050, 15.7 seconds, and three
turns; raw `gh` passed 86% and averaged 47,076 input tokens, $0.054, 17.4
seconds, and three turns. MCP conditions used 137,409–175,757 average input
tokens and seven or eight turns.

Those results are promising, not definitive. The study is self-published, uses
one model/judge and target repository, and changes several variables together:
TOON encoding, field projections, summaries, contextual help, error handling,
and the skill/instructions. It does not isolate the marginal value of the skill
or prove that TOON is better than compact JSON for MergeBrief. The archived
trajectories and explicit methodology make it more useful than an unsupported
marketing claim, but we should reproduce a MergeBrief-specific evaluation.

What to take:

- the CLI should answer “what next?” from live state instead of making the skill
  memorize the entire operation graph;
- list output needs completeness metadata and deliberately small default fields;
- detail output should include enough evidence to decide, with explicit
  expansion when truncated;
- generated skill content and a drift test are better than a handwritten
  inventory;
- unknown input must fail loudly;
- benchmark actual review tasks rather than judging the skill by prose quality.

What not to take without modification:

- MergeBrief already has a JSON output contract; TOON would add another format
  and reduce interoperability. Compact JSON projections can capture most of the
  context benefit without changing the contract;
- always appending command hints may itself become noisy. Suggestions should be
  state-dependent, short, and omitted when the next operation is obvious;
- hints such as approve, merge, or delete are capability suggestions, not
  authorization. The MergeBrief skill must still enforce the locked policy that
  externally visible GitHub writes require explicit user instruction;
- GitHub state alone is enough for `gh-axi` to reconstruct a task, but
  MergeBrief's private reasoning and drafts require a durable Review Session.

### 3. Vercel's `deploy-to-vercel`: good workflow and guardrails, excess fallback

The pinned
[`deploy-to-vercel/SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/skills/deploy-to-vercel/SKILL.md)
has a clear task boundary: deploy an application. It begins by inspecting four
pieces of state—git remote, local Vercel link, authentication, and available
teams—then chooses a path. It defaults to preview, reserves production for an
explicit request, and asks before committing and pushing. It also warns that
apparently innocent discovery commands can prompt or mutate state in an unlinked
directory.

What to take:

- inspect state before selecting a workflow;
- distinguish safe reads from commands with implicit side effects;
- make the least-public outcome the default;
- require explicit authority for publication;
- use structured output to select teams and recover deployment URLs;
- give the agent recovery rules for authentication and network failure.

What not to take:

- environment-specific no-auth scripts and repeated command recipes occupy much
  of the skill;
- the skill must know whether `.vercel/project.json` or `.vercel/repo.json`
  implies linkage and which commands prompt, because the CLI does not expose one
  consolidated state query;
- exact flags are prose-bound, with no declared CLI version or capability
  negotiation;
- resumption means re-running discovery and inferring state, not loading a
  durable task session.

Vercel's own
[agent-skills authoring rules](https://github.com/vercel-labs/agent-skills/blob/b8caa260a420a73042e35521de4b5c8baf6446cc/AGENTS.md)
reinforce the useful mechanics: progressive disclosure, scripts instead of
large inline code, status on stderr, and JSON data on stdout. Their stated
500-line ceiling is a permissive upper bound, not a target for MergeBrief.

### 4. OpenAI's `gh-address-comments`: thin workflow, missing CLI capability

The pinned
[`gh-address-comments/SKILL.md`](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-address-comments/SKILL.md)
is only 25 lines. It verifies authentication, fetches current PR review state,
numbers and summarizes the items, asks the user which items to address, and then
acts only on that selection. This is an excellent example of keeping task
sequencing and authority in the skill.

Its
[`fetch_comments.py`](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-address-comments/scripts/fetch_comments.py)
is the revealing part. The 237-line helper shells out to `gh api graphql`, owns
pagination, selects PR/comment/review/thread fields, and emits a JSON document.
That helper is sensible when the underlying CLI lacks the query, but MergeBrief
controls its CLI. Shipping an analogous helper would mean the skill is repairing
an incomplete CLI and creating a second contract surface.

What to take:

- a very small workflow with an explicit pause before acting;
- one purpose-built read that returns the complete state needed for a decision;
- JSON output and stable thread/comment IDs;
- authentication verification and actionable recovery.

What to improve for MergeBrief:

- make that curated read a tested CLI Product Query, not a bundled script;
- persist dispositions, drafts, outcomes, and the revision baseline in the
  Review Session so another agent can resume without reconstructing intent from
  remote comments;
- let the CLI own pagination, schemas, and wire errors.

### 5. `gsccli`: strong packaging and drift pattern, weaker action safety

The pinned
[`gsccli/SKILL.md`](https://github.com/nalyk/gsccli/blob/ee61255c622edf1cbe2df416478c511932e4edeb/agents/codex/gsccli/SKILL.md)
is the closest packaging analogue because the same repository owns both the CLI
and the skill. It declares a minimum compatible version, performs preflight only
once, teaches high-value workflows and silent domain gotchas, specifies JSON and
NDJSON output discipline, maps selected exit codes, and gives recovery rather
than blind-retry instructions.

More importantly, the CLI installs the skill itself. Its
[`skills install` command](https://github.com/nalyk/gsccli/blob/ee61255c622edf1cbe2df416478c511932e4edeb/src/commands/skills/install.ts)
supports dry-run, project/user scope, agent targeting, and refuses suspicious
project-scope installation. Its
[`skills status` command](https://github.com/nalyk/gsccli/blob/ee61255c622edf1cbe2df416478c511932e4edeb/src/commands/skills/status.ts)
reports whether each installed copy is in sync and tells the user when to force
an update.

What to take:

- publish the skill from the CLI repository rather than as an unrelated prompt;
- declare compatibility and expose an explicit sync/status check;
- keep stdout machine-readable and stderr operational;
- document domain traps and recovery, not every option;
- teach compositions that turn low-level queries into a useful outcome.

What not to take:

- its ten workflows and seven gotchas still copy numerous exact flags and limits
  into prose;
- compatibility metadata does not by itself prove that the installed skill and
  server expose the same Product Operations;
- it presents write commands such as sitemap submission and index publication
  without a general authorization boundary;
- it has no durable work session comparable to MergeBrief's Review Session.

## Recommended MergeBrief shape

### Keep in the CLI

- the complete agent-relevant Product Query and Product Action contracts;
- authentication, authorization, validation, retry/idempotency, and GitHub write
  attribution;
- stable entity IDs and JSON schemas;
- pagination and consolidated review reads;
- predictable error codes and exit statuses;
- Review Session creation, current state, carry-over provenance, and attention
  items;
- a machine-readable operation/capability inventory and contract version;
- a compatibility check between CLI, server, and packaged skill.

The CLI should make command discovery cheap. An agent should be able to ask for
the current operation inventory or detailed schema on demand rather than load
the whole inventory into its prompt. The exact command shape remains a design
decision, but the required behavior is equivalent to:

```text
mergebrief capabilities --json
mergebrief operations list --json
mergebrief operations describe <stable-operation-id> --json
```

This is not a recommendation for a generic execute-any-action endpoint. Normal
domain-shaped CLI commands can remain; the discovery surface describes and maps
them. `gh-axi` suggests a complementary, cheaper default: the no-args command
can return current review state plus a few valid next Product Operations, while
detailed help remains on demand.

### Keep in `SKILL.md`

- when the skill should activate;
- the review objective and what counts as complete;
- a short preflight: auth, capability compatibility, PR/revision, begin or
  resume Review Session;
- the review loop: fetch Brief context, inspect code, evaluate change groups and
  risks, record private work, revisit attention items, summarize;
- judgment guidance: what evidence is sufficient, when to draft a comment, how
  to disposition a risk, and when uncertainty warrants a pause;
- authority policy: reads and private drafts may follow the user's requested
  mode; GitHub posting, replying, resolving, marking ready, and submitting need
  explicit authorization;
- completion and handoff behavior: report findings, pending drafts, unresolved
  risks, and exact next actions.

The skill should not contain an exhaustive Product Operation list, full input or
output schemas, every flag, transport endpoints, pagination code, or copied CLI
help. Those belong to the executable, queryable contract.

### Context budget

A practical initial target is roughly 80–150 lines for the main `SKILL.md`, with
no bundled command-reference file. This is not a correctness limit; it is a
forcing function. Add a referenced page only for stable review judgment that the
CLI cannot express, and load it only when that review situation occurs.

### Drift control stronger than the examples

MergeBrief can improve on all five examples because it owns the server, CLI, and
skill:

1. package the skill from the same repository and release pipeline as the CLI;
2. embed a required Product Operation contract version or fingerprint in the
   skill package;
3. have the CLI compare its own version, the server's advertised contract, and
   the skill requirement during preflight;
4. fail closed for the review workflow when required operations are missing;
5. test the skill's named workflow capabilities against the real CLI, while the
   Product Operation catalog and exhaustive backend/CLI mappings prevent action
   drift below it;
6. expose an explicit `skill status` or equivalent that reports compatible,
   outdated, or incomplete—never silently best-effort;
7. add a small evaluation set of real review journeys and compare task success,
   turns, context use, unsafe-action rate, and successful resumption across skill
   revisions.

This adopts `gh-axi`'s strongest idea—a live, self-guiding CLI with generated
skill guidance—while avoiding both observed extremes: the removed `gh-cli`
manual, which copied everything, and the `gh-address-comments` helper, which
privately reimplemented a missing query. The skill remains small because the CLI
is complete and self-describing; it remains effective because the Review Session
preserves the domain state an agent needs to continue.
