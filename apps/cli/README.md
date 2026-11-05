# mergebrief

The MergeBrief CLI: the Brief review loop for humans and AI agents, over
your deployment's HTTP API. One binary-shaped npm package; the web app stays
the interactive surface.

The release workflow publishes it to npm as `mergebrief@X.Y.Z`. Once released,
always-latest is safe: the output contract is additive within a major (see
below). Pinning is supported but never required for compatibility.

## Quickstart

1. **Install** on Node 24 or 26 and later. Humans:

   ```sh
   npm i -g mergebrief
   mergebrief --version
   ```

   Agents and CI: run `npx mergebrief` in place of `mergebrief`, but not inside
   a checkout of untrusted code, such as a pull request's head. If the shell
   answers `command not found`, npm's global bin directory is not on `PATH`.
   [Install](../../docs/self-host/cli.md#install) covers both.
2. **Mint a token** in the web app: sign in, open `/settings`, name the
   token, pick its scope, and choose an expiry.
   The token is shown **exactly once**; treat it like a password. The CLI
   stores it **in plaintext** in a `chmod 600` file under
   `~/.config/mergebrief/`; anyone with the token can act as you, up to its
   scope, on every repository you reach.
3. **Log in** (paste, or pipe the token on stdin):

   ```sh
   mergebrief auth login --base-url https://mergebrief.your-org.example
   ```

4. **Check the wiring**: config level and server level in one shape:

   ```sh
   mergebrief auth status --json
   ```

   ```json
   {"profile":"default","baseUrl":"https://mergebrief.your-org.example","tokenConfigured":true,"cli":{"version":"1.2.0"},"server":{"reachable":true,"authenticated":true,"version":"1.4.0","latest":"1.6.0","releaseNotesUrl":"https://github.com/Idan91/mergebrief/releases/tag/v1.6.0","checkedAt":"2026-10-03T10:00:00.000Z","breaking":false,"security":false}}
   ```

5. **First read**: your Inbox, every installation you reach (no repo
   targeting needed):

   ```sh
   mergebrief pr --json
   ```

   PR-addressed commands (`pr <n>`, `groups <n>`, `diff <n>`, …) pick the
   repo from the clone's `origin` remote; `-R owner/name` overrides.

Driving an agent? Install the `mergebrief` skill
([skills/mergebrief](../../skills/mergebrief/SKILL.md)): the review
workflow, the authority policy, and the wire contract:

```sh
npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>
```

## Working on the CLI

`pnpm --dir apps/cli link-dev` builds this checkout and puts it on `PATH` as
`mergebrief`, through pnpm's global packages. It runs whatever was last built,
so rebuild after switching branches, and don't build it from a pull request you
are reviewing: the linked command then runs that code with your token. If pnpm
reports that the global bin
directory is not in `PATH`, or that it can't find one, run `pnpm setup`, open a
new shell and run it again. Add `--force` to `pnpm setup` if it reports that your
shell's startup file already has a pnpm section, which an older pnpm leaves.

## The output contract (what scripts may rely on)

- **exit 0 ⇒ stdout is documented JSON** (or the raw unified diff, for
  `diff`), or empty for an operation whose success carries no body
  (`draft update|reanchor|delete`, `reclassify`, `chunk-read`, `ready`,
  `auth use|owners`). **exit ≠ 0 ⇒ stdout is
  empty** and stderr carries exactly one
  line. For server responses it relays the error text + HTTP status;
  client-side usage and network/proxy failures explain themselves without
  one. One exception: when writing stdout fails for a reason other than
  the reader closing it (EIO, ENOSPC), a successful command exits 1 and
  stdout may hold a partial write.
- **`diff` names its read:** on exit 0 it writes a stderr line,
  `diff mode: revision-span` or `diff mode: compare`, after the diff; a
  server that names neither prints none.
- **Passthrough by default:** most commands emit the server response
  verbatim: one canonical shape across web, API, and CLI. Exactly four
  shapes are CLI-synthesized: the `delta` union, `auth status`,
  `auth profiles`, and `capabilities`.
- **Additive within a major, once released:** fields are never removed,
  renamed, or retyped within a major; new fields may appear any release;
  read tolerantly. Breaking changes ship expand/contract with a deprecation
  window in the changelog. Before the first release, fields may still be
  removed; each removal is listed in `docs/api-changelog.md`.
- `--json` is an explicit flag. TTY rendering is non-contractual.

### Exit codes (additive-only, never renumbered)

| Code | Meaning |
|---|---|
| 0 | Success, including modeled unavailability (`delta`'s `available:false` arm) |
| 1 | Generic/unexpected: network, 5xx, version skew |
| 2 | Usage error caught client-side (bad flags, `--group` with a custom span, malformed submit JSON shape) |
| 3 | Auth (401); re-mint the token |
| 4 | Not found (repo/PR/group/span; incl. an unmodeled delta 404) |
| 5 | Server rejected the payload (4xx validation). Fix and retry; agent submit loops self-correct on this code |
| 6 | Incompatible: a `--require`d operation is not runnable on this server+CLI pair; do not drive it |
| 7 | Rate limited (429): the error line names the wait as `retry after <n>s` when the server sent one; wait that long, then retry |

## Commands

### `repos`

The repositories your token can see (the installation ∩ your-access
intersection), cached per profile at `~/.cache/mergebrief/<profile>/` with
**no TTL**: the cache directory is always safe to delete. Renames self-heal
when a PR-addressed command resolves the new `owner/name` (one automatic
refresh on a slug miss); the `repos` listing itself needs `--refresh` to
show a rename.

```json
{"repos":[{"repoId":"812345","fullName":"acme/widgets"}]}
```

### `pr [n]`

No argument: the first page of your Inbox, verbatim (`{"items":[...],
"page":1,"pageSize":25,"total":n,...}`), every installation you reach plus
the pull requests you pasted. With a number: the
PR's metadata. Critical fields: **`baseSha`/`headSha`**, the brief span
your `submit` must name (never auto-fetched); `headBriefStored`: a brief is
stored at that span, on a base the PR may since have left; `briefAvailable`:
one is stored for the PR's current base too. Generation is webhook-driven for
an installed repo (`generate <url>` queues a pasted PR); poll with backoff
while `generation.status` is `pending` or `running`, since an
`awaiting-trigger` head waits for a collaborator's Generate click;
`comparisons.lastReview`, what `delta` resolves.

```json
{"repoId":"812345","repoSlug":"acme/widgets","prNumber":7,"title":"Extract tenant boundary","state":"open","baseSha":"93f1…","headSha":"4c0a…","briefAvailable":true,"headBriefStored":true,"generation":{"status":"succeeded","phase":null,"attempts":1,"errorCode":null,"errorParams":null,"updatedAt":"2026-07-09T12:00:00.000Z"},"comparisons":{},"updatedAt":"2026-07-09T12:00:00.000Z"}
```

### `groups <n>`

The Brief artifact body, verbatim: `changeGroups` (each with an `id`;
`diff --group` takes it), `chunks` (per-file line ranges joining groups to
the diff), risk-surface attributes.

### `diff <n>`

The raw unified diff of the latest revision, `--revision <n>`, or
`--base <sha> --head <sha>` together. The raw output **is** the machine format: `--json` is rejected
(exit 2).

Piped output is those bytes, unchanged. On a terminal the CLI shows control and
invisible characters as visible escapes, so a pull request cannot drive your
terminal or blank out code on it. It also colors added, removed, hunk and
file-header lines, unless `NO_COLOR` is non-empty or `TERM=dumb`. A set `$PAGER`
takes the escaped copy with no color, so a tool like `bat` does its own. A pager
that quits early changes nothing, and one that cannot run falls back to the CLI's
own copy.

`--group <id>` filters to one change group's **whole hunks** (the output is
itself a valid diff, `git apply --check` clean). It reads a brief's own span,
so it takes `--revision` but combining with `--base/--head` is exit 2. If the brief's files disagree with the live
diff the command fails loud (exit 1) rather than silently under-showing.

### `delta <n>`

What changed since **your** last review. One of the CLI-synthesized
shapes: a discriminated union, both arms exit 0:

```json
{"available":true,"baselineSha":"77aa…","headSha":"4c0a…","artifact":{"summary":"…","changedGroups":[],"chunks":[]}}
```

```json
{"available":false,"reason":"pending"}
```

`reason` ∈ `no-checkpoint` · `pending` · `baseline-unavailable` ·
`span-too-large` · `delta-not-generated` · `unchanged`. `unchanged` means the pushes
since the checkpoint left the pull request's own changes as they were. `--baseline/--head`
(together) skip checkpoint resolution; an artifact missing for an explicit span, a span
whose delta was skipped or unchanged included, is exit 4.

### `session <n>`

Your review session on a brief, verbatim: the latest revision, `--revision <n>`,
or `--base <sha> --head <sha>` together.

The latest revision is the newest finished brief for the PR's current head, or
the newest finished one when that head has none. `session`,
`context`, `groups` and `diff` choose it the same way, and print on stderr, only
on success:

- which revision they served;
- why, when the head has no brief yet: generating, waiting for a Generate click,
  or the generation's failure;
- `this is revision 3; revision 4 is latest`, when `--revision` names an older one;
- when this read moves you to a newer revision than you last read here, that it
  did and what happens to your work. A draft that lost its lines needs
  re-anchoring in MergeBrief, because a token cannot.

No finished revision at all is exit 4; so is a `--revision` not on the PR.
`--base/--head` read exactly that span and print none of this. The CLI remembers
the highest revision you read per PR in `<cacheDir>/<profile>/read-revisions.json`,
which is safe to delete.

### `marks <n> --baseline <sha> --head <sha>`

Comparison marks (coordinates only) for a `baseline..head` span, verbatim.
Both flags required (exit 2).

### `narrative <n> --prev-head <sha> --head <sha>`

The revision narrative for a `prevHead..head` hop, verbatim. Both flags
required (exit 2).

### `context <n>`

The brief's repo-config snapshot (`{"repoConfig":…}`), verbatim. Chooses its
brief as `session` does.

### `draft create|update|reanchor|delete|attach <n> [draftId]`

Draft inline comments in your session; they post at `submit`. Every draft
command names the brief span (`--base/--head`, exit 2 without them).
Payload via `-F <file>` / `-F -` (stdin), or the convenience flags,
mutually exclusive (exit 2):

- `create <n> --file <path> --start <line> --end <line> --body <text>`
  (`--side old|new`, default `new`, `old` only for deleted lines).
  `--file` without `--start`/`--end` is a File comment. Mixing `--file`
  with only one of `--start`/`--end` is exit 2. `--file` without a span
  cannot take `--side` or `--start-side` (exit 2). Receipt: `{"draftId":"41"}`.
- `update <n> <draftId> --body <text>`: edit a held draft's body. Prints
  nothing on success.
- `reanchor <n> <draftId> --file --start --end [--side]`: move a held
  draft's anchor. `--file` without a span converts it to a File comment.
  `--file` without a span cannot take `--side` or `--start-side` (exit 2).
  Server-gated to signed-in reviewers (a token gets the relayed 403 → exit 5).
  Prints nothing on success.
- `delete <n> <draftId>`: no payload. Same signed-in-reviewer gate. Prints
  nothing on success.
- `attach <n> <file>`: upload a png, jpg, gif or webp image to the
  repository's attachments branch and print `{"url":"…"}` for a comment to
  carry. No span unless `--draft <draftId>` also appends the image to that
  held draft, which needs `--base` and `--head` (exit 2 without them). This
  one pushes to the repository, so a token needs external-write scope; an
  upload over the instance's quota is 429 (exit 7).

### `chunk-read <n> <chunkId...>` / `chunk-read <n> --group <id>`

Mark brief chunks read (`--unread` clears; the flags are mutually exclusive).
Name the chunk ids, or `--group` for every chunk in a change group of the brief
at that span, not both. Chunks go one at a time and the first failure stops the
rest, its error line naming the chunk and how many were done; a rerun is safe.
Span required. Prints nothing on success.

### `risk dismiss|address|reopen <n> -F <file>`

Disposition the brief's risk flags. `-F` is **required**: the payload's
`flags` array names each flag by anchor (`filePath`, `attribute`,
`regionStart`, `regionEnd`): `session --json` lists them for a flag already
decided, and an open flag's come from its chunk in `groups --json`
([the rule](../../skills/mergebrief/contract.md#human-only-operations)).
`dismiss` adds `--reason <text>` as a convenience, mutually exclusive with
a `reason` in the payload (exit 2). Span required. Server-gated to
signed-in reviewers (a token gets the relayed 403 → exit 5). Receipt:
`{"count":2}`, how many dispositions the call changed.

### `reclassify <n> <groupId> --category <category>`

Override a change group's category in your session; `--help` lists the values,
and the server validates them. Span required. Prints nothing on success.

### `outcome <n> <comment|approve|request-changes>`

Set your session's review intent; `submit` is what publishes. Span
required. Receipt: `{"outcome":"approve"}`.

### `thread resolve|unresolve <n> <commentId>`

Flip the review thread rooted at a comment, on GitHub, as you. No span.
Receipt: `{"resolved":true,"alreadyInTargetState":false}`.

### `ready <n>`

Mark a draft PR ready for review (GitHub enforces who may). No span.
Prints nothing on success.

### `generate <url>`

Generate a brief for a PR URL on demand, with no confirm prompt (your own
key, mirroring the web URL box). The server queues the run and answers
where the brief will render: `{"repoId":"42001","prNumber":7}`. Poll
`pr <n>` for progress.

### `generation <n>`

The PR head's generation claims, verbatim: `{"generation":{"headSha":…,
"status":…,"claims":1,"claimLimit":…,"exhausted":false,…}}`, with the stored
failure (`errorCode`, `errorParams`) and the queued takeover job when there
is one. No `generation` key before the first brief is queued. Use it to
see why a head has no brief.

### `collaborators`

The target repo's collaborator roster, verbatim (`-R`/origin addressing).
Requires push access: a read-only viewer gets the 404 posture.

### `spend`

Today's started generation runs against the instance's daily cap, verbatim:
`{"startedRuns":17,"cap":50,"largeRuns":{"runs":2,"units":12},"dayStartedAt":"…","resetsAt":"…"}`
(no `cap` on an uncapped instance; no `largeRuns` when no run today took more
than one; the day is UTC). `startedRuns` counts run units: a large pull request
briefed in parts takes one more for each part, and `largeRuns` says how many
runs were briefed in parts and how many units they took. One pull request
pushed or retried the same day counts once per run. Operators only: anyone
else gets 403 `operator-only` (exit 5). No repo targeting.

### `conversation <n>`

The PR's review conversation, verbatim (threads, reviews, PR comments).

### `reply <commentId> --pr <n>`

Reply in your own voice: `--body <text>` or `--body-file -` (stdin).
Receipt verbatim: `{"commentId":990011}`.

### `submit <n>`

Submit a review of the brief span you name; the comments are the drafts
the server holds for it (`draft create` adds them). Payload via `-F <file>` /
`-F -` (stdin), or the
convenience flags (`--outcome comment|approve|request-changes`, `--body`);
the two forms are mutually exclusive. **`--base` and `--head` are
required and never auto-fetched** (exit 2 without them): carry the span
through from `pr <n>`. Receipt verbatim:

```json
{"reviewId":990012,"commentsDegraded":false,"commentsFolded":0,"commentsTotal":2}
```

`commentsFolded` counts the comments GitHub refused to anchor out of
`commentsTotal`; those were folded into the review body, the rest landed
as threads. The review **did** post (a stderr warning fires in both
output modes when the count is above zero; do not re-submit).
`commentsDegraded` mirrors `commentsFolded > 0` for one release. GitHub
rejects `approve`/`request-changes` on your own PR (`comment` passes);
that relays as a server error; don't retry-loop it.

### `capabilities`

The server's operation catalog joined with this binary's committed command
map, the third CLI-synthesized shape. Each server operation gains a `cli`
arm: `{command}` (runnable here), `{gap}` (no command yet), `{webOnly}`
(browser-only by design), or `{unknownToCli: true}` (the server is newer).
The shape also carries `cliVersion`.

`--require <ids...>` turns the report into a fail-closed preflight: every
named operation must be registered on the server AND mapped to a command in
this binary, or the command exits 6 with one stderr line naming each
failure. Agents run this before driving a workflow.

### `auth login` / `auth status`

`auth login` reads the token from stdin (paste prompt on a TTY), stores it
per profile, and verifies it immediately; its output is the `auth status`
shape. With no `--profile` or `MERGEBRIEF_PROFILE` it writes to the default
profile, and refuses when the clone's owner routes to a different one, so a
clone's origin can't choose where a pasted token goes. `auth status` is three-level: config (profile, base URL, token
present), the CLI's own version, and server (reachable, authenticated,
**server version** (the API changelog is keyed to it), plus the newest
release the server knows of, when its update check has an answer). Dead
token and unreachable server are data (exit 0), so scripts can diagnose
without special-casing failures.

## Profiles

`~/.config/mergebrief/config.json` (0600) holds named profiles: base URL,
token, optional `owners: ["acme"]` mapping and extra static `headers` (the
IdP escape hatch). Resolution order: `--profile` / `MERGEBRIEF_PROFILE` →
`owners:` match on the git-remote owner → the default profile.
`MERGEBRIEF_TOKEN` overrides the resolved profile's stored token, and a command
that sends a request refuses it when the owner match routes away from the default
profile, until `--profile` or `MERGEBRIEF_PROFILE` names the instance.

Three commands manage them without opening the file, and none makes a request:

- `auth profiles` lists each profile's name, base URL, owners, whether it is the
  default and whether it stores a token. It never prints a token or a header:

  ```json
  {"profiles":[{"name":"default","baseUrl":"https://mergebrief.your-org.example","owners":["acme"],"isDefault":true,"tokenConfigured":true}]}
  ```

- `auth use <name>` sets the default profile.
- `auth owners <owner...>` replaces the resolved profile's owners, and `--clear`
  empties them. Each owner is one GitHub slug as its own argument. Owners ignore
  case, and an owner routes to one profile only.

A failure that can mean the wrong instance names the other profiles on its error
line: no answer, a proxy's page, a 401, a 404, a 5xx, or a repo the profile can't
see. A status that shows this instance answered, such as a 409, doesn't. `auth
status` prints the same names beside a failed probe on a terminal; its JSON stays
the documented shape, so a script reads them from `auth profiles`.
`auth login --base-url` that moves a profile to another origin drops its stored
headers, owners and cached repo list, since those belong to the old instance.
`auth login` refuses a profile name it couldn't store: `__proto__`, `.`, `..`, an
empty name, or one with a path separator or a control character.

Deploy-side setup (IdP `/api/*` exemption, minting walkthrough):
[`docs/self-host/cli.md`](../../docs/self-host/cli.md).

## Flag appendix (generated)

Regenerate with `pnpm --dir apps/cli docs:appendix`; CI fails on
staleness.

<!-- BEGIN GENERATED FLAG APPENDIX (pnpm docs:appendix) -->

### `mergebrief`

```
Usage: mergebrief [options] [command]

MergeBrief: PR briefs for humans and agents, over your deployment's API

Options:
  -V, --version                               output the version number
  --json                                      machine output: the documented JSON contract (default: false)
  --agents                                    deprecated: prints where the agent guide moved (default: false)
  --profile <name>                            config profile (default: owners match, then the default profile)
  -R, --repo <owner/name>                     target repository (default: the origin remote)
  -h, --help                                  display help for command

Commands:
  auth                                        authentication against your deployment
  repos [options]                             repositories visible to the profile's token (cached; see --refresh)
  pr [number]                                 your PRs (no argument), or one PR's metadata
  generation <number>                         the PR head's generation claims, last failure and takeover job
  groups [options] <number>                   the PR's brief: change groups (default: the latest revision)
  conversation <number>                       the PR's review conversation
  diff [options] <number>                     the PR's unified diff (its raw text IS the machine format)
  reply [options] <commentId>                 reply to a review comment (the viewer's own voice)
  submit [options] <number>                   submit a review of the brief span you name (its saved drafts go with it)
  session [options] <number>                  your review session on a brief (default: the latest revision)
  marks [options] <number>                    comparison marks (coordinates only) for a baseline..head span
  narrative [options] <number>                the revision narrative for a prevHead..head hop
  context [options] <number>                  the brief's repo-config snapshot (default: the latest revision)
  draft                                       draft review comments in your session (posted at submit)
  chunk-read [options] <number> [chunkId...]  mark brief chunks read (--unread clears the marks)
  risk                                        disposition the brief's risk flags in your session
  reclassify [options] <number> <groupId>     override a change group's category in your session
  outcome [options] <number> <outcome>        set your session's review intent (publishing is `submit`)
  thread                                      review-thread state on GitHub (the viewer's own act)
  ready <number>                              mark a draft PR ready for review (GitHub-enforced authorship)
  generate <url>                              generate a brief for a PR URL (no confirm; your own key)
  collaborators                               the target repo's collaborator roster (push access required)
  capabilities [options]                      what this server+CLI pair can run; --require makes it a fail-closed check
  spend                                       today's started runs against the daily cap (Operators only)
  delta [options] <number>                    what changed since your last review (union: available | not)
  help [command]                              display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief auth login`

```
Usage: mergebrief auth login [options]

store a token for a profile (paste it, or pipe it on stdin)

Options:
  --base-url <url>  deployment origin, e.g. https://mergebrief.example.com
  -h, --help        display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief auth status`

```
Usage: mergebrief auth status [options]

config + server status for the resolved profile

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief auth profiles`

```
Usage: mergebrief auth profiles [options]

every profile in the config, tokens and headers left out

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief auth use`

```
Usage: mergebrief auth use [options] <name>

set the default profile

Arguments:
  name        a profile `auth profiles` lists

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief auth owners`

```
Usage: mergebrief auth owners [options] [owner...]

set the GitHub owners the resolved profile serves, replacing its list

Arguments:
  owner       owner slugs whose clones route to this profile

Options:
  --clear     remove every owner from the profile (default: false)
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief repos`

```
Usage: mergebrief repos [options]

repositories visible to the profile's token (cached; see --refresh)

Options:
  --refresh   bypass the disk cache (default: false)
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief pr`

```
Usage: mergebrief pr [options] [number]

your PRs (no argument), or one PR's metadata

Arguments:
  number      PR number in the target repository

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief groups`

```
Usage: mergebrief groups [options] <number>

the PR's brief: change groups (default: the latest revision)

Arguments:
  number          PR number

Options:
  --revision <n>  the brief revision to read (default: latest; `pr <n> --json`
                  lists them)
  -h, --help      display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief conversation`

```
Usage: mergebrief conversation [options] <number>

the PR's review conversation

Arguments:
  number      PR number

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief diff`

```
Usage: mergebrief diff [options] <number>

the PR's unified diff (its raw text IS the machine format)

Arguments:
  number          PR number

Options:
  --group <id>    filter to one change group's whole hunks (brief span only)
  --revision <n>  the brief revision to read (default: latest; `pr <n> --json`
                  lists them)
  --base <sha>    span base (with --head)
  --head <sha>    span head (with --base)
  -h, --help      display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief delta`

```
Usage: mergebrief delta [options] <number>

what changed since your last review (union: available | not)

Arguments:
  number            PR number

Options:
  --baseline <sha>  override the checkpoint baseline (with --head)
  --head <sha>      override the head (with --baseline)
  -h, --help        display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief session`

```
Usage: mergebrief session [options] <number>

your review session on a brief (default: the latest revision)

Arguments:
  number          PR number

Options:
  --revision <n>  the brief revision to read (default: latest; `pr <n> --json`
                  lists them)
  --base <sha>    span base (with --head)
  --head <sha>    span head (with --base)
  -h, --help      display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief marks`

```
Usage: mergebrief marks [options] <number>

comparison marks (coordinates only) for a baseline..head span

Arguments:
  number            PR number

Options:
  --baseline <sha>  comparison baseline (required)
  --head <sha>      comparison head (required)
  -h, --help        display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief narrative`

```
Usage: mergebrief narrative [options] <number>

the revision narrative for a prevHead..head hop

Arguments:
  number             PR number

Options:
  --prev-head <sha>  prior briefed head (required)
  --head <sha>       revision head (required)
  -h, --help         display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief context`

```
Usage: mergebrief context [options] <number>

the brief's repo-config snapshot (default: the latest revision)

Arguments:
  number          PR number

Options:
  --revision <n>  the brief revision to read (default: latest; `pr <n> --json`
                  lists them)
  --base <sha>    span base (with --head)
  --head <sha>    span head (with --base)
  -h, --help      display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief draft create`

```
Usage: mergebrief draft create [options] <number>

draft a new inline comment on the brief span you name

Arguments:
  number                PR number

Options:
  -F, --payload <path>  full JSON payload from a file, or "-" for stdin
  --file <path>         anchor file path (flag form)
  --side <side>         old | new (flag form; default: new)
  --start-side <side>   old | new: side of --start when the range crosses sides
                        (flag form)
  --start <line>        anchor start line (flag form)
  --end <line>          anchor end line (flag form)
  --body <text>         comment body (flag form)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"filePath":"src/a.ts","side":"new","startLine":10,"endLine":12,"body":"tighten this"}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief draft update`

```
Usage: mergebrief draft update [options] <number> <draftId>

edit a held draft's body

Arguments:
  number                PR number
  draftId               the draft id (see `session <n>`)

Options:
  -F, --payload <path>  full JSON payload from a file, or "-" for stdin
  --body <text>         new comment body (flag form)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"body":"tighten this further"}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief draft reanchor`

```
Usage: mergebrief draft reanchor [options] <number> <draftId>

move a held draft's anchor (settles a carried orphan)

Arguments:
  number                PR number
  draftId               the draft id (see `session <n>`)

Options:
  -F, --payload <path>  full JSON payload from a file, or "-" for stdin
  --file <path>         anchor file path (flag form)
  --side <side>         old | new (flag form; default: new)
  --start-side <side>   old | new: side of --start when the range crosses sides
                        (flag form)
  --start <line>        anchor start line (flag form)
  --end <line>          anchor end line (flag form)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"filePath":"src/a.ts","side":"new","startLine":14,"endLine":16}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief draft delete`

```
Usage: mergebrief draft delete [options] <number> <draftId>

delete a held draft

Arguments:
  number        PR number
  draftId       the draft id (see `session <n>`)

Options:
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief draft attach`

```
Usage: mergebrief draft attach [options] <number> <file>

upload an image to the repository's attachments branch; prints {url}

Arguments:
  number             PR number
  file               a png, jpg, gif or webp file

Options:
  --draft <draftId>  also append the image to this held draft (needs --base and
                     --head)
  --base <sha>       span base of the brief (with --draft)
  --head <sha>       span head of the brief (with --draft)
  -h, --help         display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief chunk-read`

```
Usage: mergebrief chunk-read [options] <number> [chunkId...]

mark brief chunks read (--unread clears the marks)

Arguments:
  number        PR number
  chunkId       the chunk ids as the brief spells them

Options:
  --group <id>  every chunk in this change group, in place of ids
  --read        mark read (the default)
  --unread      clear the read mark
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief risk dismiss`

```
Usage: mergebrief risk dismiss [options] <number>

dismiss risk flags (the payload's flags array names them)

Arguments:
  number                PR number

Options:
  -F, --payload <path>  JSON payload from a file, or "-" for stdin (required)
  --reason <text>       dismissal reason (unless the payload carries one)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"flags":[{"filePath":"src/a.ts","attribute":"touches-auth","regionStart":10,"regionEnd":12}],"reason":"the caller already checks this"}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief risk address`

```
Usage: mergebrief risk address [options] <number>

mark risk flags addressed (each flag carries its evidence)

Arguments:
  number                PR number

Options:
  -F, --payload <path>  JSON payload from a file, or "-" for stdin (required)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"flags":[{"filePath":"src/a.ts","attribute":"touches-auth","regionStart":10,"regionEnd":12,"evidence":{"kind":"chunk-reviewed","ref":"c1"}}]}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief risk reopen`

```
Usage: mergebrief risk reopen [options] <number>

undo dispositions on risk flags

Arguments:
  number                PR number

Options:
  -F, --payload <path>  JSON payload from a file, or "-" for stdin (required)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command

Example payload:
  {"flags":[{"filePath":"src/a.ts","attribute":"touches-auth","regionStart":10,"regionEnd":12}]}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief reclassify`

```
Usage: mergebrief reclassify [options] <number> <groupId>

override a change group's category in your session

Arguments:
  number                 PR number
  groupId                the change group id (see `groups <n>`)

Options:
  --category <category>  the category to record: bugfix | logic-refactor |
                         move-with-edits | lib-bump | pure-move | new-feature |
                         dependency-update | schema-change
  --base <sha>           span base of the brief (required)
  --head <sha>           span head of the brief (required)
  -h, --help             display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief outcome`

```
Usage: mergebrief outcome [options] <number> <outcome>

set your session's review intent (publishing is `submit`)

Arguments:
  number        PR number
  outcome       comment | approve | request-changes

Options:
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief thread resolve`

```
Usage: mergebrief thread resolve [options] <number> <commentId>

resolve the thread rooted at a review comment

Arguments:
  number      PR number
  commentId   the thread's root review comment id

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief thread unresolve`

```
Usage: mergebrief thread unresolve [options] <number> <commentId>

reopen the thread rooted at a review comment

Arguments:
  number      PR number
  commentId   the thread's root review comment id

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief ready`

```
Usage: mergebrief ready [options] <number>

mark a draft PR ready for review (GitHub-enforced authorship)

Arguments:
  number      PR number

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief generate`

```
Usage: mergebrief generate [options] <url>

generate a brief for a PR URL (no confirm; your own key)

Arguments:
  url         the PR's GitHub URL

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief collaborators`

```
Usage: mergebrief collaborators [options]

the target repo's collaborator roster (push access required)

Options:
  -h, --help  display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief capabilities`

```
Usage: mergebrief capabilities [options]

what this server+CLI pair can run; --require makes it a fail-closed check

Options:
  --require <ids...>  operation ids that must be runnable here (any failure →
                      exit 6)
  -h, --help          display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief reply`

```
Usage: mergebrief reply [options] <commentId>

reply to a review comment (the viewer's own voice)

Arguments:
  commentId           the review comment id (see `conversation <n>`)

Options:
  --pr <number>       the PR the comment belongs to
  --body <text>       reply text
  --body-file <path>  reply text from a file, or "-" for stdin
  -h, --help          display help for command

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

### `mergebrief submit`

```
Usage: mergebrief submit [options] <number>

submit a review of the brief span you name (its saved drafts go with it)

Arguments:
  number                PR number

Options:
  -F, --payload <path>  full JSON payload from a file, or "-" for stdin
  --file <path>         the same as --payload
  --outcome <outcome>   comment | approve | request-changes (flag form)
  --body <text>         review body (flag form)
  --base <sha>          span base of the brief you reviewed
  --head <sha>          span head of the brief you reviewed
  -h, --help            display help for command

Example payload:
  {"outcome":"comment","body":"one question inline"}

Global options: --json, --profile <name>, -R <owner/name> (see mergebrief --help)
```

<!-- END GENERATED FLAG APPENDIX -->
