# mergebrief

The MergeBrief CLI — the Brief review loop for humans and AI agents, over
your deployment's HTTP API. One binary-shaped npm package; the web app stays
the interactive surface.

Private in v1 (this monorepo dogfoods it via `pnpm --dir packages/cli
link-dev`); published to npm at OSS launch. Humans: `npm i -g mergebrief`.
Agents/CI: `npx mergebrief` — always-latest is safe, the output contract is
additive-only (see below). Pinning is supported but never required for
compatibility.

## Quickstart

1. **Mint a token** in the web app: sign in, open `/settings`, name the
   token, pick the organization it is bound to, and choose an expiry.
   The token is shown **exactly once** — treat it like a password. The CLI
   stores it **in plaintext** in a `chmod 600` file under
   `~/.config/mergebrief/`; anyone with the token can act as you in that
   organization.
2. **Log in** (paste, or pipe the token on stdin):

   ```sh
   mergebrief auth login --base-url https://mergebrief.your-org.example
   ```

3. **Check the wiring** — config level and server level in one shape:

   ```sh
   mergebrief auth status --json
   ```

   ```json
   {"profile":"default","baseUrl":"https://mergebrief.your-org.example","tokenConfigured":true,"server":{"reachable":true,"authenticated":true,"version":"0.4.0"}}
   ```

4. **First read** — your visible PRs across the organization (no repo
   targeting needed):

   ```sh
   mergebrief pr --json
   ```

   PR-addressed commands (`pr <n>`, `groups <n>`, `diff <n>`, …) pick the
   repo from the clone's `origin` remote; `-R owner/name` overrides.

Driving an agent? `mergebrief --agents` prints the packaged guide —
contract invariants, the exit table with next-moves, and the reviewer and
author loops.

## The output contract (what scripts may rely on)

- **exit 0 ⇒ stdout is documented JSON** (or the raw unified diff, for
  `diff`). **exit ≠ 0 ⇒ stdout is empty** and stderr carries exactly one
  line — for server responses it relays the error text + HTTP status;
  client-side usage and network/proxy failures explain themselves without
  one.
- **Passthrough by default:** most commands emit the server response
  verbatim — one canonical shape across web, API, and CLI. Exactly three
  shapes are CLI-synthesized: the `delta` union, `auth status`, and
  `capabilities`.
- **Additive-only, even pre-1.0:** fields are never removed, renamed, or
  retyped within a major; new fields may appear any release — read
  tolerantly. Breaking changes ship expand/contract with a deprecation
  window in the changelog.
- `--json` is an explicit flag. TTY rendering is non-contractual.

### Exit codes (additive-only, never renumbered)

| Code | Meaning |
|---|---|
| 0 | Success — including modeled unavailability (`delta`'s `available:false` arm) |
| 1 | Generic/unexpected: network, 5xx, version skew |
| 2 | Usage error caught client-side (bad flags, `--group` with a custom span, malformed submit JSON shape) |
| 3 | Auth (401) — re-mint the token |
| 4 | Not found (repo/PR/group/span; incl. an unmodeled delta 404) |
| 5 | Server rejected the payload (4xx validation) — fix and retry; agent submit loops self-correct on this code |
| 6 | Incompatible: a `--require`d operation is not runnable on this server+CLI pair — do not drive it |

## Commands

### `repos`

The repositories your token can see (the installation ∩ your-access
intersection), cached per profile at `~/.cache/mergebrief/<profile>/` with
**no TTL** — the cache directory is always safe to delete. Renames self-heal
when a PR-addressed command resolves the new `owner/name` (one automatic
refresh on a slug miss); the `repos` listing itself needs `--refresh` to
show a rename.

```json
{"repos":[{"repoId":"812345","fullName":"acme/widgets"}]}
```

### `pr [n]`

No argument: your PR list, verbatim (`{"pulls":[...]}`). With a number: the
PR's metadata. Critical fields: **`baseSha`/`headSha`** — the brief span
your `submit` must name (never auto-fetched); `briefAvailable` — generation is
webhook-driven, poll with backoff, nothing client-side triggers it;
`comparisons.lastReview` — what `delta` resolves.

```json
{"repoId":"812345","repoSlug":"acme/widgets","prNumber":7,"title":"Extract tenant boundary","state":"open","baseSha":"93f1…","headSha":"4c0a…","briefAvailable":true,"generation":{"status":"succeeded","phase":null,"attempts":1,"error":null,"updatedAt":"2026-07-09T12:00:00.000Z"},"comparisons":{},"updatedAt":"2026-07-09T12:00:00.000Z"}
```

### `groups <n>`

The Brief artifact body, verbatim: `changeGroups` (each with an `id` —
`diff --group` takes it), `chunks` (per-file line ranges joining groups to
the diff), risk-surface attributes.

### `diff <n>`

The raw unified diff of the PR's brief span (or `--base <sha> --head <sha>`
together). The raw output **is** the machine format — `--json` is rejected
(exit 2). On a TTY it pipes through `$PAGER`.

`--group <id>` filters to one change group's **whole hunks** (the output is
itself a valid diff — `git apply --check` clean). Brief-span only: combining
with `--base/--head` is exit 2. If the brief's files disagree with the live
diff the command fails loud (exit 1) rather than silently under-showing.

### `delta <n>`

What changed since **your** last review. One of the CLI-synthesized
shapes — a discriminated union, both arms exit 0:

```json
{"available":true,"baselineSha":"77aa…","headSha":"4c0a…","artifact":{"summary":"…","changedGroups":[],"chunks":[]}}
```

```json
{"available":false,"reason":"pending"}
```

`reason` ∈ `no-checkpoint` · `pending` · `baseline-unavailable` ·
`delta-not-generated`. `--baseline/--head` (together) skip checkpoint
resolution; an artifact missing for an explicit span is exit 4.

### `session <n> --base <sha> --head <sha>`

Your review session on the brief span you name, verbatim. The span is
required and never auto-fetched (exit 2 without it) — the same
`baseSha`/`headSha` pair `pr <n>` reports.

### `marks <n> --baseline <sha> --head <sha>`

Comparison marks (coordinates only) for a `baseline..head` span, verbatim.
Both flags required (exit 2).

### `narrative <n> --prev-head <sha> --head <sha>`

The revision narrative for a `prevHead..head` hop, verbatim. Both flags
required (exit 2).

### `context <n> --base <sha> --head <sha>`

The brief's repo-config snapshot (`{"repoConfig":…}`), verbatim. Same span
rule as `session`.

### `draft create|update|reanchor|delete <n> [draftId]`

Draft inline comments in your session — they post at `submit`. Every draft
command names the brief span (`--base/--head`, exit 2 without them).
Payload via `-F <file>` / `-F -` (stdin), or the convenience flags —
mutually exclusive (exit 2):

- `create <n> --file <path> --start <line> --end <line> --body <text>`
  (`--side old|new`, default `new` — `old` only for deleted lines).
  Receipt: `{"draftId":"41"}`.
- `update <n> <draftId> --body <text>` — edit a held draft's body.
- `reanchor <n> <draftId> --file --start --end [--side]` — move a held
  draft's anchor. Server-gated to signed-in reviewers (a token gets the
  relayed 403 → exit 5).
- `delete <n> <draftId>` — no payload. Same signed-in-reviewer gate.

### `chunk-read <n> <chunkId>`

Mark a brief chunk read (`--unread` clears; the flags are mutually
exclusive). Span required. Receipt: `{"chunkId":"chunk-1","read":true}`.

### `conversation <n>`

The PR's review conversation, verbatim (threads, reviews, PR comments).

### `reply <commentId> --pr <n>`

Reply in your own voice: `--body <text>` or `--body-file -` (stdin).
Receipt verbatim: `{"commentId":990011}`.

### `submit <n>`

Submit a review of the brief span you name; the comments are the drafts
the server holds for it (drafting them has no CLI command yet, so a
CLI-only submit posts a body-only review today). Payload via `-F <file>` /
`-F -` (stdin), or the
convenience flags (`--outcome comment|approve|request-changes`, `--body`)
— the two forms are mutually exclusive. **`--base` and `--head` are
required and never auto-fetched** (exit 2 without them): carry the span
through from `pr <n>`. Receipt verbatim:

```json
{"reviewId":990012,"commentsDegraded":false}
```

`commentsDegraded: true` means GitHub rejected the inline anchors and your
comments were folded into the review body — the review **did** post (a
stderr warning fires in both output modes; do not re-submit). GitHub
rejects `approve`/`request-changes` on your own PR (`comment` passes) —
that relays as a server error; don't retry-loop it.

### `capabilities`

The server's operation catalog joined with this binary's committed command
map — the third CLI-synthesized shape. Each server operation gains a `cli`
arm: `{command}` (runnable here), `{gap}` (no command yet), `{webOnly}`
(browser-only by design), or `{unknownToCli: true}` (the server is newer).
The shape also carries `cliVersion`, both catalog fingerprints, and
`fingerprintMatch`; a mismatch alone is one stderr warning, never a gate.

`--require <ids...>` turns the report into a fail-closed preflight: every
named operation must be registered on the server AND mapped to a command in
this binary, or the command exits 6 with one stderr line naming each
failure. Agents run this before driving a workflow.

### `auth login` / `auth status`

`auth login` reads the token from stdin (paste prompt on a TTY), stores it
per profile, and verifies it immediately — its output is the `auth status`
shape. `auth status` is two-level: config (profile, base URL, token
present) and server (reachable, authenticated, **server version** — the API
changelog is keyed to it). Dead token and unreachable server are data
(exit 0), so scripts can diagnose without special-casing failures.

## Profiles

`~/.config/mergebrief/config.json` (0600) holds named profiles — base URL,
token, optional `owners: ["acme"]` mapping and extra static `headers` (the
IdP escape hatch). Resolution order: `--profile` / `MERGEBRIEF_PROFILE` →
`owners:` match on the git-remote owner → the default profile.
`MERGEBRIEF_TOKEN` overrides the resolved profile's stored token.

Deploy-side setup (IdP `/api/*` exemption, minting walkthrough):
[`docs/self-host/cli.md`](../../docs/self-host/cli.md).

## Flag appendix (generated)

Regenerate with `pnpm --dir packages/cli docs:appendix`; CI fails on
staleness.

<!-- BEGIN GENERATED FLAG APPENDIX (pnpm docs:appendix) -->

### `mergebrief`

```
Usage: mergebrief [options] [command]

MergeBrief — PR briefs for humans and agents, over your deployment's API

Options:
  --json                                   machine output: the documented JSON contract (default: false)
  --agents                                 print the packaged agent guide and exit (default: false)
  --profile <name>                         config profile (default: owners match, then the default profile)
  -R, --repo <owner/name>                  target repository (default: the origin remote)
  -h, --help                               display help for command

Commands:
  auth                                     authentication against your deployment
  repos [options]                          repositories visible to the profile's token (cached; see --refresh)
  pr [number]                              your PRs (no argument), or one PR's metadata
  groups <number>                          the PR's brief — change groups over the current span
  conversation <number>                    the PR's review conversation
  diff [options] <number>                  the PR's unified diff (its raw text IS the machine format)
  reply [options] <commentId>              reply to a review comment (the viewer's own voice)
  submit [options] <number>                submit a review of the brief span you name (its saved drafts go with it)
  session [options] <number>               your review session on the brief span you name
  marks [options] <number>                 comparison marks (coordinates only) for a baseline..head span
  narrative [options] <number>             the revision narrative for a prevHead..head hop
  context [options] <number>               the brief's repo-config snapshot for the span you name
  draft                                    draft review comments in your session (posted at submit)
  chunk-read [options] <number> <chunkId>  mark a brief chunk read (--unread clears the mark)
  capabilities [options]                   what this server+CLI pair can run; --require makes it a fail-closed check
  delta [options] <number>                 what changed since your last review (union: available | not)
  help [command]                           display help for command
```

### `mergebrief auth login`

```
Usage: mergebrief auth login [options]

store a token for a profile (paste it, or pipe it on stdin)

Options:
  --base-url <url>  deployment origin, e.g. https://mergebrief.example.com
  -h, --help        display help for command
```

### `mergebrief auth status`

```
Usage: mergebrief auth status [options]

config + server status for the resolved profile

Options:
  -h, --help  display help for command
```

### `mergebrief repos`

```
Usage: mergebrief repos [options]

repositories visible to the profile's token (cached; see --refresh)

Options:
  --refresh   bypass the disk cache (default: false)
  -h, --help  display help for command
```

### `mergebrief pr`

```
Usage: mergebrief pr [options] [number]

your PRs (no argument), or one PR's metadata

Arguments:
  number      PR number in the target repository

Options:
  -h, --help  display help for command
```

### `mergebrief groups`

```
Usage: mergebrief groups [options] <number>

the PR's brief — change groups over the current span

Arguments:
  number      PR number

Options:
  -h, --help  display help for command
```

### `mergebrief conversation`

```
Usage: mergebrief conversation [options] <number>

the PR's review conversation

Arguments:
  number      PR number

Options:
  -h, --help  display help for command
```

### `mergebrief diff`

```
Usage: mergebrief diff [options] <number>

the PR's unified diff (its raw text IS the machine format)

Arguments:
  number        PR number

Options:
  --base <sha>  span base (with --head)
  --head <sha>  span head (with --base)
  --group <id>  filter to one change group's whole hunks (brief span only)
  -h, --help    display help for command
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
```

### `mergebrief session`

```
Usage: mergebrief session [options] <number>

your review session on the brief span you name

Arguments:
  number        PR number

Options:
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command
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
```

### `mergebrief context`

```
Usage: mergebrief context [options] <number>

the brief's repo-config snapshot for the span you name

Arguments:
  number        PR number

Options:
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command
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
  --start <line>        anchor start line (flag form)
  --end <line>          anchor end line (flag form)
  --body <text>         comment body (flag form)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command
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
  --start <line>        anchor start line (flag form)
  --end <line>          anchor end line (flag form)
  --base <sha>          span base of the brief (required)
  --head <sha>          span head of the brief (required)
  -h, --help            display help for command
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
```

### `mergebrief chunk-read`

```
Usage: mergebrief chunk-read [options] <number> <chunkId>

mark a brief chunk read (--unread clears the mark)

Arguments:
  number        PR number
  chunkId       the chunk id as the brief spells it

Options:
  --read        mark read (the default)
  --unread      clear the read mark
  --base <sha>  span base of the brief (required)
  --head <sha>  span head of the brief (required)
  -h, --help    display help for command
```

### `mergebrief capabilities`

```
Usage: mergebrief capabilities [options]

what this server+CLI pair can run; --require makes it a fail-closed check

Options:
  --require <ids...>  operation ids that must be runnable here (any failure →
                      exit 6)
  -h, --help          display help for command
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
```

### `mergebrief submit`

```
Usage: mergebrief submit [options] <number>

submit a review of the brief span you name (its saved drafts go with it)

Arguments:
  number               PR number

Options:
  -F, --file <path>    full JSON payload from a file, or "-" for stdin
  --outcome <outcome>  comment | approve | request-changes (flag form)
  --body <text>        review body (flag form)
  --base <sha>         span base of the brief you reviewed
  --head <sha>         span head of the brief you reviewed
  -h, --help           display help for command
```

<!-- END GENERATED FLAG APPENDIX -->
