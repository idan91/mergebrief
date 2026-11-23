# The `mergebrief` CLI

`mergebrief` reads and reviews briefs from a terminal, a script, a CI job or a coding agent. It talks to your instance's API with a token you create in the web app, so it can do what you can do in the browser, up to the token's scope. Each section below is a task; the [reference](#reference) at the end lists every command, the output contract and the exit codes. Product terms such as revision, held push and chunk are defined in the [glossary](../glossary.md).

You need a running instance ([compose.md](./compose.md)) that you can sign in to.

## Install

The CLI needs Node 24, or 26 and later.

```sh
npm i -g mergebrief
mergebrief --version
```

**Check:** `--version` prints a version number.

If the shell answers `command not found: mergebrief`, npm's global bin directory is not on `PATH`. Add this line to your shell's startup file and open a new shell:

```sh
export PATH="$(npm prefix -g)/bin:$PATH"
```

With pnpm (`pnpm add -g mergebrief`), run `pnpm setup` and open a new shell instead. Add `--force` if it says your startup file already has a pnpm section.

To run it without installing, use `npx mergebrief` wherever these pages say `mergebrief`.

> [!WARNING]
> Never run `npx mergebrief` inside a checkout of code you do not trust, such as a pull request's head in CI. `npx` prefers a `mergebrief` bin from the local project and reads the project's `.npmrc`, so that code chooses what runs. Install the CLI first, or run `npx` from another directory and name the repository with `-R owner/name`.

## Sign in

### Create a token

1. Sign in to MergeBrief in the browser and open `/settings`.
2. Under **API tokens**, name the token (for example `laptop` or `ci-reviewer`).
3. Pick its scope. Each level includes the one before it, and the scope is fixed for the token's life:

   | Scope | In the form | Lets the CLI |
   | --- | --- | --- |
   | `read` | Read only | Run every read command |
   | `private-write` | Read and review in MergeBrief | Also keep review work in MergeBrief: `draft create` and `update`, `chunk-read`, `reclassify`, `outcome`, `generate <url>` |
   | `external-write` | Read, review, and post to GitHub | Also write to GitHub as you: `submit`, `reply`, `thread resolve` and `unresolve`, `ready`, `draft attach`, `generate <number>` |

4. Choose an expiry. The default is 90 days; "no expiry" is allowed.
5. Copy the token. It is shown once.

A token acts as you: it reaches every repository you reach in the web app, on every organization. Pick the smallest scope that does the job. A command above the token's scope fails with `403 scope-exceeded` (exit 5). `draft reanchor`, `draft delete` and `risk dismiss|address|reopen` need the signed-in browser and answer `403 human-only` to any token.

### Log in

```sh
mergebrief auth login --base-url https://mergebrief.your-org.example
```

Paste the token when it asks. Pasting keeps the token out of your shell history; the prompt echoes what you paste, so clear the terminal's scrollback afterwards. The CLI stores the token in plain text in `~/.config/mergebrief/config.json`, a file only you can read (mode `0600`).

**Check:**

```sh
mergebrief auth status
```

```text
profile default → https://mergebrief.your-org.example
token: configured · authenticated · server 1.4.0 · cli 1.4.0 · latest 1.4.0
```

`authenticated` means the token works. `auth status` always exits 0, even when the server is unreachable or the token is dead, so read the line, or `server.reachable` and `server.authenticated` in `auth status --json`.

If an error says the instance "answered like an identity-provider proxy", your company's sign-in proxy is catching the CLI's requests. See [Behind an identity-aware proxy](#behind-an-identity-aware-proxy).

## Review a pull request from the terminal

Run these inside a clone of the repository: commands that take a pull request number pick the repository from the clone's `origin` remote. Elsewhere, add `-R owner/name`. The examples use pull request 7.

1. **Find the pull request.** With no number, `pr` lists your Inbox: every repository you reach, plus the pull requests you pasted.

   ```sh
   mergebrief pr
   ```

   ```text
   acme/widgets#7	Extract tenant boundary	open
   ```

2. **See whether its brief is ready.**

   ```sh
   mergebrief pr 7
   ```

   ```text
   PR 7 · brief available · span 93f1a2c..4c0a9be
   ```

   `brief not ready` means it is still generating or waiting; [When the brief is not ready](#when-the-brief-is-not-ready) says what to do.

3. **Open your review session.** This reads the brief and records which revision you are on, so your later writes land on the code you read.

   ```sh
   mergebrief session 7
   ```

   It prints your session as JSON on stdout, and on stderr which revision it served:

   ```text
   revision 2 93f1a2c..4c0a9be
   ```

4. **Read the change groups.** Each line is a group id and its title.

   ```sh
   mergebrief groups 7
   ```

   ```text
   grp-1	Move tenant checks into one boundary
   grp-2	Update the tenant fixtures
   ```

5. **Read how behaviour changes.** The [Product diff](../glossary.md) is the before and after of the pull request, one change per block.

   ```sh
   mergebrief product-diff 7
   ```

   ```text
   PR 7 · Product diff · available · 1 change
   user-flow	a signed-out visitor opens a brief link
     before (diff)	the page shows an error
     after	the page asks them to sign in
     groups	grp-1
   ```

6. **Read one group's code.** `--group` cuts the diff to that group's whole hunks. The output is a valid diff.

   ```sh
   mergebrief diff 7 --group grp-1
   ```

7. **Mark the group read.** This records every [chunk](../glossary.md) in the group as read on your session. It prints nothing.

   ```sh
   mergebrief chunk-read 7 --group grp-1
   ```

8. **Draft a comment.** Drafts stay in your session until you submit.

   ```sh
   mergebrief draft create 7 --file src/tenant.ts --start 40 --end 44 \
     --body "Does this run before the cache read?"
   ```

   ```text
   {"draftId":"41"}
   ```

   Leave out `--start` and `--end` for a comment on the whole file. Add `--side old` to comment on deleted lines.

9. **Submit the review to GitHub.** Your drafts post with it, as you. This needs an `external-write` token.

   ```sh
   mergebrief submit 7 --outcome comment --body "One question inline."
   ```

   ```text
   review submitted (receipt: {"reviewId":990012,"commentsDegraded":false,"commentsFolded":0,"commentsTotal":1})
   ```

   **Check:** the review appears on the pull request on GitHub. `commentsFolded` above 0 means GitHub refused to anchor that many comments and they went into the review body instead; the review did post, so do not submit again.

   `outcome approve` and `request-changes` work the same way. GitHub refuses both on your own pull request; `comment` always works.

10. **Come back after new pushes.** `delta` shows what changed since your last submitted review:

    ```sh
    mergebrief delta 7 --json
    ```

    It answers `{"available":true,...}` with the changes, or `{"available":false,"reason":"..."}`, both with exit 0. `reason` is `no-checkpoint` until you have submitted a review here, `pending` while that delta is still generating, and `unchanged` when the new pushes left the pull request's own changes as they were.

To put an image in a comment, `mergebrief draft attach 7 screenshot.png` uploads a PNG, JPEG, GIF or WebP file to the repository's `mergebrief/attachments` branch and prints its URL; `--draft <id>` also appends it to that draft. It needs an `external-write` token ([attachments.md](./attachments.md)).

### Which revision a command reads

Every push that gets a brief adds a **revision**: the first brief is revision 1, the next revision 2. `mergebrief pr 7 --json` lists them under `revisions`.

**Reads** (`session`, `groups`, `product-diff`, `diff`, `context`) serve the latest revision: the newest finished brief for the pull request's current head, or the newest finished one when that head has none yet. They say on stderr which revision they served and, when the head has no brief yet, why:

```text
revision 2 93f1a2c..4c0a9be
head 7d3e0f1 has no brief yet, its brief is generating; serving revision 2
```

When a read moves you to a newer revision than you last read on this machine, it says so, and `session 7` shows what carried over from your earlier work and what needs another look:

```text
revision 3 is now latest (you were on revision 2).
```

**Writes** to your session (`draft`, `chunk-read`, `reclassify`, `outcome`, `risk`) stay on the revision you are on, because your line numbers came from it:

```text
writing on revision 2; revision 3 is latest. Run `mergebrief session 7` to move.
```

**`submit`** posts publicly, so with no revision flag it refuses (exit 5) unless you are on the newest code: when a newer revision exists, when the head has no brief yet, when GitHub reports commits no brief covers, or when nothing shows you read the pull request, neither a read on this machine nor work in your session. The error says which, for example:

```text
revision 3 is latest and you are on revision 2: pass --revision 2 to post on what you read, or run `mergebrief session 7` to move
```

To choose a revision yourself, every one of these commands takes `--revision <n>`, or `--base <sha> --head <sha>` together for an exact span. A revision that is not on the pull request exits 4. The CLI remembers the highest revision you read per pull request in `~/.cache/mergebrief/<profile>/read-revisions.json`; deleting it is safe.

### When the brief is not ready

`mergebrief pr 7` tells you why there is no brief. A **held** push, one whose [trigger conditions](../repo-config/trigger-conditions.md) are not met, adds a `held:` line naming each unmet condition and whose setting it is:

```text
PR 7 · brief not ready · span 93f1a2c..4c0a9be
held: Waiting for CI: build, test still running (this repository's setting); Needs this pull request marked ready for review (this MergeBrief instance's setting)
```

| What you see | What to do |
| --- | --- |
| `held:` with conditions that clear by themselves, such as CI still running | Wait. The brief generates once every condition passes. |
| `held:` with a condition someone must act on, such as a label or ready for review | Make that change, or start it now with `mergebrief generate 7` (push access and an `external-write` token). |
| `generates on every push` | Someone turned on generating on every push for this pull request, so its trigger conditions are skipped. |
| No `held:` line, brief not ready | It is generating. Poll `mergebrief pr 7 --json` until `generation.status` leaves `pending` and `running`. |
| `generation.status` is `awaiting-trigger` | The author is not on the team. Someone with push access starts it from the pull request's page in MergeBrief; a token cannot. |
| `generation.status` is `failed` | `mergebrief generation 7` shows the stored `errorCode`. `mergebrief generate 7` reruns it when a rerun can help ([troubleshooting.md](./troubleshooting.md)). |

In `--json`, the unmet conditions are `generation.unmetConditions`. `generation.unmetConditionsPartial: true` means the server could not read every stored condition, so the list is not the whole reason.

## Use it in CI and from agents

Four rules make the CLI safe to script:

- **Pass `--json`.** On exit 0, stdout is the documented JSON and nothing else. Terminal output is for people and can change.
- **Branch on the exit code, never on stderr text.** On a non-zero exit, stdout is empty and stderr is one line ([Exit codes](#exit-codes)).
- **Keep the token in a secret,** and give it to the CLI as `MERGEBRIEF_TOKEN`. It replaces the stored token of whichever profile the command resolves.
- **Install a pinned version** rather than running `npx` inside the checkout ([Install](#install)).

The CLI still needs a profile for the instance's URL. In CI, write one with no token in it, so the token never touches the runner's disk:

```yaml
# .github/workflows/brief.yml (one job's steps)
- name: Install the MergeBrief CLI
  run: npm i -g mergebrief@1.4.0
- name: Read the brief
  env:
    MERGEBRIEF_TOKEN: ${{ secrets.MERGEBRIEF_TOKEN }}
    MERGEBRIEF_URL: https://mergebrief.your-org.example
    PR_NUMBER: ${{ github.event.pull_request.number }}
  run: |
    mkdir -p ~/.config/mergebrief
    printf '{"profiles":{"ci":{"baseUrl":"%s"}},"defaultProfile":"ci"}\n' "$MERGEBRIEF_URL" \
      > ~/.config/mergebrief/config.json
    chmod 600 ~/.config/mergebrief/config.json
    mergebrief auth status --json | jq -e '.server.authenticated'
    mergebrief -R "$GITHUB_REPOSITORY" product-diff "$PR_NUMBER" --json > product-diff.json
```

**Check:** the `jq -e` step fails the job unless the token authenticates.

A script that reads a brief which may not exist yet branches on the code:

```sh
mergebrief product-diff 7 --json > product-diff.json
case $? in
  0) echo "read the brief" ;;
  4) echo "no brief for this pull request yet" ;;
  7) echo "rate limited: wait the seconds the error line names, then retry" ;;
  *) exit 1 ;;
esac
```

Before an agent drives a workflow, it can check that this server and this CLI both support every operation it needs. Exit 6 means stop:

```sh
mergebrief capabilities --require read-brief create-draft-comment submit-review
```

### Coding agents

The agent guide ships as the `mergebrief` skill: the review workflow, what the agent may do on its own, and the wire contract. Install it into your agent with skills.sh:

```sh
npx skills add idan91/mergebrief --skill mergebrief -a <your-agent>
```

`mergebrief --agents` only prints where the guide moved.

## Several instances: profiles

Keep one profile per instance. A token is not tied to an organization, so one profile covers every organization you reach on that instance.

```sh
mergebrief auth login --base-url https://mb.work.example --profile work
mergebrief auth login --base-url https://mb.oss.example --profile oss
mergebrief auth use work                    # make work the default
mergebrief --profile work auth owners acme  # clones of acme/* use work
mergebrief auth profiles                    # names, URLs, owners, the default
```

**Check:** `mergebrief auth profiles --json` lists both, with `"isDefault":true` on `work`. It never prints a token or a header.

Each command picks its profile in this order: `--profile` or `MERGEBRIEF_PROFILE`, then an `owners` match on the clone's `origin` owner, then the default profile (the first one you logged in to, until you change it).

A clone must not choose where your token goes. When the clone's owner routes to a profile other than the default, `MERGEBRIEF_TOKEN` and a bare `auth login` are refused until `--profile` or `MERGEBRIEF_PROFILE` names the instance. When an instance cannot be reached, the error line names your other profiles.

## Behind an identity-aware proxy

If your instance sits behind an identity-aware proxy (Cloudflare Access, oauth2-proxy, Pomerium and the like), the proxy must let `/api/*` through to the API, apart from `/api/auth/*`. The operator sets that up ([security-model.md](./security-model.md#put-it-behind-an-identity-aware-proxy)). Until then, the CLI gets a login page instead of an answer and reports that the instance "answered like an identity-provider proxy".

If your proxy accepts static headers instead, such as a service token, add them to the profile in `~/.config/mergebrief/config.json`. The CLI sends them on every request:

```json
{
  "profiles": {
    "work": {
      "baseUrl": "https://mergebrief.internal.example",
      "headers": { "CF-Access-Client-Id": "…", "CF-Access-Client-Secret": "…" }
    }
  }
}
```

## Versions

`mergebrief --version` prints the CLI's version. The CLI compares itself with the server on every run and with npm once a day. Every line below goes to stderr, in human and `--json` mode alike, and none changes the exit code.

| Situation | What the CLI prints | When |
| --- | --- | --- |
| A newer release is on npm | `A new version of mergebrief is available: 1.2.0 → 1.6.0. To update, run: npm i -g mergebrief@1.6.0` | Once per answer, after a successful command, at most daily |
| The CLI is a major version behind the server | `mergebrief 1.2.0 is behind this server (2.0.0): some commands may fail. To update, run: npm i -g mergebrief@2.0.0` | After every successful command |
| The server is a major version behind the CLI | `This server (1.4.0) is behind mergebrief 2.0.0: some commands may not exist there. To match it, run: npx mergebrief@1.4.0` | After every successful command |
| Versions differ and a command fails | The error line ends with `[server 1.4.0, cli 1.6.0]`, plus `, major gap` across a major | Every failed command |
| Either side is a dev build (`0.0.0` CLI, `dev` server) or a release candidate | Nothing | Never |

Under `npx`, the update hints suggest `npx mergebrief@x.y.z` instead of `npm i -g`. `mergebrief auth status` also shows `latest`, the newest release the server knows of, which is the one place you see that the server itself is behind.

To turn the update line and the major-version warning off, and stop the CLI asking npm, set `MERGEBRIEF_NO_VERSION_WARNING` to any value. The suffix on a failed command stays, because it is part of the error. The instance's own `updateCheck.enabled: false` does not silence the CLI.

```sh
export MERGEBRIEF_NO_VERSION_WARNING=1
```

The npm check asks `https://registry.npmjs.org/mergebrief/latest`, sends nothing about your instance, and gives up after 2 seconds so a slow registry never delays a command.

## Reference

### Global options

| Option | What it does |
| --- | --- |
| `--json` | Print the documented JSON on stdout |
| `--profile <name>` | Use that profile ([profiles](#several-instances-profiles)) |
| `-R, --repo <owner/name>` | Target that repository instead of the clone's `origin` |
| `-h, --help` | Show a command's flags. `mergebrief <command> --help` is the full, version-exact flag list |

The CLI's environment variables and its config file are in [configuration.md](./configuration.md#cli).

### Commands

The scope column is the smallest token scope the command needs. Per-command JSON shapes are in the package README on [npm](https://www.npmjs.com/package/mergebrief).

| Command | What it does | Scope |
| --- | --- | --- |
| `auth login`, `auth status`, `auth profiles`, `auth use`, `auth owners` | Store a token, check it, and manage profiles | any |
| `repos` | Repositories your token can see, cached per profile; `--refresh` re-reads them | `read` |
| `pr [number]` | Your Inbox, or one pull request's state, revisions and generation | `read` |
| `generation <number>` | The head's generation: status, attempts and the stored failure | `read` |
| `session <number>` | Your review session on a brief | `read` |
| `groups <number>` | The brief: change groups, chunks and risk attributes | `read` |
| `product-diff <number>` | The brief's Product diff alone; `{}` when the brief has none | `read` |
| `diff <number>` | The raw unified diff; `--group <id>` for one group. Rejects `--json` | `read` |
| `delta <number>` | What changed since your last submitted review | `read` |
| `context <number>` | The repo config the brief was generated with | `read` |
| `marks <number>`, `narrative <number>` | Comparison marks and the revision narrative between two commits | `read` |
| `conversation <number>` | The pull request's threads, reviews and comments | `read` |
| `collaborators` | The repository's collaborators; needs push access | `read` |
| `capabilities` | What this server and CLI can both run; `--require` checks a list | `read` |
| `spend` | Today's started runs against the daily cap; operators only | `read` |
| `draft create`, `draft update` | Write or edit a draft comment | `private-write` |
| `chunk-read <number>` | Mark chunks read, by id or `--group`; `--unread` clears | `private-write` |
| `reclassify <number> <groupId>` | Override a group's category in your session | `private-write` |
| `outcome <number> <outcome>` | Set the review outcome `submit` will post | `private-write` |
| `generate <url>` | Generate a brief for a pasted pull request | `private-write` |
| `submit <number>` | Post your review and its drafts to GitHub | `external-write` |
| `reply <commentId> --pr <number>` | Reply to a review comment as you | `external-write` |
| `thread resolve`, `thread unresolve` | Resolve or reopen a review thread | `external-write` |
| `ready <number>` | Mark a draft pull request ready for review | `external-write` |
| `draft attach <number> <file>` | Upload an image for a comment | `external-write` |
| `generate <number>` | Start a held head now, or rerun a failed one; needs push access | `external-write` |
| `draft reanchor`, `draft delete`, `risk dismiss`, `risk address`, `risk reopen` | Move or delete a draft, decide a flag. Any token gets `403 human-only`: use the browser | browser only |

### Output contract

- **Exit 0:** stdout is the documented JSON, the raw diff for `diff`, or empty for a command whose success has no body (`draft update`, `reanchor`, `delete`, `reclassify`, `chunk-read`, `ready`, `generate <number>`, `auth use`, `auth owners`).
- **Any other exit:** stdout is empty and stderr is exactly one line. For an error the server sent, the line carries its message and HTTP status. One exception: if writing stdout fails for a reason other than the reader closing it, a successful command exits 1 and stdout may hold a partial write.
- **Responses pass through as the server sent them,** in the same shape the web app reads. Five shapes are the CLI's own: `delta`, `auth status`, `auth profiles`, `capabilities` and `product-diff`.
- **Within a major version, fields are only added,** never removed, renamed or retyped, so read them tolerantly. Before the first release a field can still be removed; each removal is listed in [api-changelog.md](../api-changelog.md).
- **Stderr carries notices on success:** which revision a read served, `diff mode: revision-span` or `diff mode: compare` after a diff, and the version lines.
- **On a terminal, `diff` shows control and invisible characters as visible escapes** and adds color, so a pull request cannot drive your terminal. Piped, it prints the bytes unchanged. `NO_COLOR` or `TERM=dumb` turns color off, and `$PAGER` gets the escaped copy without color.

### Exit codes

Codes are only ever added, never renumbered.

| Code | Meaning | Next move |
| --- | --- | --- |
| 0 | Success, including data that says something is unavailable, such as `delta`'s `"available":false` | Read stdout |
| 1 | The server could not be reached, answered 5xx or like a login proxy, or something unexpected failed | Read the error line; retry later or fix the URL or proxy |
| 2 | A usage error caught before any request: bad flags, a lone `--base` or `--head`, a malformed payload, a missing profile | Fix the command |
| 3 | The token was refused (401) | Create a new token and log in again |
| 4 | Not found: the repository, pull request, group, span or revision, or no brief yet | Check the number, or wait for the brief |
| 5 | The server rejected the request (any other 4xx, including `scope-exceeded` and `human-only`), or the CLI refused a `submit` with no revision flag | Fix the payload or the scope; for `submit`, re-read or pass `--revision` |
| 6 | `capabilities --require` named an operation this server and CLI cannot both run | Do not drive that operation |
| 7 | Rate limited (429). The error line names the wait as `retry after <n>s` when the server sent one | Wait that long, then retry |
