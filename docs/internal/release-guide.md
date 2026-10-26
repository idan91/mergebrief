# Release guide (operator manual)

How a MergeBrief release gets from this private repository to the public one, and what to do when it stops halfway. The public side, what a tag publishes and how notes files work, is in `docs/dev/releasing.md`; this file covers everything before the tag exists, and the checks after it.

## How it works

Two repositories. All development happens here, in the private repository. The public repository, `Idan91/mergebrief`, holds nothing but release commits: one commit per release, each a full snapshot of the shipped tree, each tagged `vX.Y.Z`. Nobody commits to public `main` by hand, not even the maintainer.

One command moves a release across:

```sh
pnpm release:export --version 0.1.0 --source <sha> [--dry-run] [--out <dir>]
```

In order, it:

1. Fetches `origin/main` and resolves `--source` to one commit. A commit `main` does not hold is refused.
2. Lists that commit's tracked files and classifies each against the manifest in `tools/release/src/logic/export/paths.ts`. A top-level entry the manifest does not name stops the run.
3. Writes the shipped files with `git archive` into `--out` (an empty or new dir; a temp dir when omitted). The checkout itself is never read, so an untracked or uncommitted file cannot ship.
4. Runs four gates over that tree, in order, stopping at the first failure:
   - `paths`: no shipped markdown links into, or names, an excluded path
   - `gitleaks`: the pinned scanner over the tree, with the tree's own `.github/gitleaks.toml` as the allowlist
   - `notes`: the version's notes file, and a read of the tags the public repository already holds (placement is `release.yml`'s job)
   - `build`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm -r typecheck`, `pnpm -C tools/categorizer test`, in a scratch copy of the tree
5. Builds the release commit from git objects alone: the shipped tree, the previous release commit as parent (none for the first), author and committer `Idan Ram <44946814+Idan91@users.noreply.github.com>`, dated with the source commit's committer date, message `Release X.Y.Z`. The body lists the `Co-authored-by:` trailers from private commits since the previous release, with the maintainer's and the coding agents' addresses dropped. The same inputs always give the same SHA.
6. Checks the version is above the last one exported and the source contains the last one's source, that public `main` sits on the last release commit, and that no `vX.Y.Z` tag points elsewhere.
7. Pushes the commit to public `main`, then the annotated tag `vX.Y.Z`, then writes the record `public/vX.Y.Z` (an annotated tag on the source commit, message `public-commit <sha>`) to this repository's `origin`. The record goes last, so its presence means the release is fully out.

The public repository's `release.yml` fires on the tag and publishes npm, the ghcr image and the GitHub Release. This repository's `release.yml` never publishes: its `verify` job sets `publish=false` unless the repository is `Idan91/mergebrief`.

`--dry-run` stops after step 6, prints the plan and pushes nothing. The real run repeats every gate, so a dry run is a preview, never a prerequisite. The public repository is always read anonymously; only the push sees a token, and every other git call and every gate tool runs with credential-shaped variables removed from its environment.

### The Publish workflow

`.github/workflows/publish.yml` splits the same run into three jobs, so the code the gates execute never holds a credential and never produces what ships. Each job checks the release tool out at `main` and runs only for a dispatch on `main`.

1. **Plan the release** (`plan`) runs `pnpm release:export --emit <dir>`: steps 1 to 3 and 5 to 6 with no gate, from the tool's own dependencies installed with `--ignore-scripts`. It uploads `release.bundle` (the release commit and both tag objects, no private history) and `plan.json`, and sets the source, commit, tree, tag-object and record-object SHAs and the public repository URL it planned against as job outputs. Its `Plan and emit` log prints the resolved `source` SHA: that is the SHA every retry of this release uses.
2. **Gate the planned commit** (`gates`) reruns the export with `--dry-run --expect-commit <planned commit>` and every gate. It holds no secret and uploads nothing; only its pass or fail counts. A rebuilt commit that differs stops it: `rebuilt <sha>, not the planned <sha>; the gates checked another commit`.
3. **Push the release** (`publish`) runs in the `publish` environment, so it waits for your approval where the environment has required reviewers (setup step 2 says when it cannot). It refuses a plan made against another public repository than its own `PUBLIC_URL` (`publish: planned against <url>, pushing to <url>`), checks the bundle's refs and objects against the plan job's outputs, mints the App token, pushes the commit and the tag to the public repository, then the record to `origin`. It installs and runs no code from the repository. Each refusal prints `publish: <reason>`, for example `publish: bundle refs differ from the plan`.

A publish rehearsed against a scratch public remote (`--public-remote file://<bare repo>`) printed this, abridged; the gate tools' own output goes to stderr:

```text
export 0.1.0-rc.1 (publish)
  source   409de6ffbeec6e7c5edaa2200ff904543e827013
  files    3127
gate paths: ok, 3127 files, no internal links
gate gitleaks: ok, no secrets found
gate notes: ok, v0.1.0-rc.1 has its notes file; public repo file:///tmp/scratch-public.git holds 0 tags
gate build: ok, 4 steps passed in a scratch copy
  source   409de6ffbeec6e7c5edaa2200ff904543e827013
  parent   none, first release
  commit   30fe4815299a0702fb923cb3b778b898858664b3
  tag      v0.1.0-rc.1
  changes  3127 added, 0 edited, 0 deleted
  actions  push commit 30fe4815299a0702fb923cb3b778b898858664b3 to main, push tag v0.1.0-rc.1, push record public/v0.1.0-rc.1
```

A second publish of the same version from the same source printed the same commit and `actions  nothing to push, 0.1.0-rc.1 is published`. A dry run prints the same plan with `(dry run)` in the header and pushes nothing. Until the public repository exists, its notes gate adds `public repo Idan91/mergebrief not found; treating as no releases (dry run only)`.

`--public-remote <url>` points a rehearsal at any remote you own, never the real one. It redirects the public pushes only: the record `public/vX.Y.Z` still goes to `origin`, and every later real export reads it as a published release (a version not above it, or a different source, is then refused). So never rehearse a publish from this checkout with `--public-remote` alone. Rehearse in a scratch clone whose `origin` is also a scratch bare repository, or pass `--private-remote` a scratch bare clone of this repository as well, which then takes the record instead of `origin`. A `--dry-run` rehearsal pushes nothing and is safe anywhere.

## One-time setup

Do these once, in this order. The repository name must be final before step 3, and any re-sweep below merged to `main` through a normal PR before it; a rename after the first publish goes through GitHub's rename, and the old name is never reused. If the name changes before step 3, re-sweep every spelling with one search, `git grep -n -E 'Idan91/mergebrief|name: "mergebrief"|repositories: mergebrief'`: the slash form (`publish.yml`'s `PUBLIC_URL`, `release.yml`, docs and test fixtures) and the two split forms, `REPOSITORY` in `tools/release/src/consts.ts` (`owner: "Idan91"`, `name: "mergebrief"`) and `publish.yml`'s token step (`owner: Idan91`, `repositories: mergebrief`). A missed `consts.ts` makes the push job refuse with `publish: planned against <url>, pushing to <url>`; a missed token step fails at `Mint the publishing token`.

0. **Confirm the written IP clearance** the distribution decision record requires before any public work. Without it in writing, stop before step 3: creating the public repository is public work. Then check two account facts, which decide the publish path:
   - **Plan**: Settings, Billing and licensing, Plans and usage, Current plan. A quick tell from the shell: `gh api repos/Idan91/code-review/rulesets` answering `Upgrade to GitHub Pro or make this repository public` means GitHub Free. Free cannot do step 2; either move to Pro before step 2, or skip step 2 and publish with the local fallback below.
   - **Actions on this private repository**: Settings, Billing and licensing, Usage, Actions minutes left, or a payment method for overage. Done when a dispatched run here starts and finishes. Without Actions, the Publish workflow and the dispatch rehearsal cannot run here: publish with the local fallback. The public repository's `release.yml` runs either way.
1. **Create the publishing GitHub App** (account settings, Developer settings, GitHub Apps, New GitHub App). Homepage URL is required but unused; enter `https://github.com/Idan91/mergebrief`. Webhook: untick Active. Repository permissions: Contents read and write, and Workflows read and write, nothing else (GitHub adds Metadata read-only by itself). Workflows is needed because every release commit adds or edits `.github/workflows/*`, and GitHub refuses that push to a token without it. Where it can be installed: Only on this account. After Create, the General page shows the App ID; under Private keys, Generate a private key downloads the PEM. Delete the downloaded file once step 2 stores it; a new key can be generated any time. Install it later (step 4).
2. **Create the `publish` environment and store the App's credentials in it** (this repository, Settings, Environments, New environment `publish`):
   - Deployment branches and tags: Selected branches and tags, add `main`.
   - Required reviewers: tick it and add yourself. Leave Prevent self-review off.
   - Environment secrets: `PUBLISH_APP_ID` (the App id) and `PUBLISH_APP_PRIVATE_KEY` (a generated private key, the whole PEM).
   - Keep no repository-level copy of either secret (Settings, Secrets and variables, Actions, Repository secrets).

   Done when Settings, Environments lists `publish` with the `main` branch rule and both secrets, and Repository secrets lists neither.

   Check what this account's plan allows before relying on any of it. On a private repository GitHub offers environments, environment secrets and deployment branch rules from GitHub Pro up, and required reviewers only on GitHub Enterprise. Open Settings, Environments, `publish`: if the Required reviewers box is not offered, there is no approval pause, and the push job starts as soon as the gates job passes. The key is still fenced by the environment: only a run on `main` can enter `publish`, and only that job can read its secrets. Make up for the missing pause by running the `--dry-run` preview first and dispatching only once its `commit` line is the release you want. If Settings has no Environments page at all (GitHub Free), environment secrets are not available: do not store the key as a repository secret, which any workflow on any pushed branch can read. Publish with the local fallback until the account is on Pro.
3. **Create `Idan91/mergebrief`**: public, empty, no README, no license file, no `.gitignore`. Everything it needs arrives with the first export. Description and topics are optional; nothing reads them. Leave Issues on: the shipped `.github/ISSUE_TEMPLATE/` forms need them. An empty repository has no default branch; the first export pushes `main`, which becomes it.
4. **Install the App** on `Idan91/mergebrief` only (the App's page, Install App, Only select repositories). The installation must hold both permissions: if you change the App's permissions after installing, accept the update on the installation.
5. **Add a ruleset on `main`** (Settings, Rules, Rulesets, New ruleset, New branch ruleset): Enforcement Active; target Include by pattern `main`; rules Restrict updates, Restrict deletions, Block force pushes. Bypass list: the App, and the Repository admin role, which is your account; both with bypass mode Always, since both push directly and never through a pull request. The admin bypass exists for the local fallback below and nothing else. It also lets you merge a public pull request from the web page: never do, a merged pull request makes every later export refuse with the drift message.
6. **Protect `v*` tags** (New ruleset, New tag ruleset): Enforcement Active; target Include by pattern `v*`; rules Restrict updates, Restrict deletions, Block force pushes; empty bypass list. Creating a tag stays allowed. A published tag never moves. Done when Rulesets lists both rulesets as Active.
7. **Turn on private vulnerability reporting** (Settings, Advanced Security, called Code security on older layouts, Private vulnerability reporting, Enable). Done when the Security tab offers Report a vulnerability. After the first publish it also shows `SECURITY.md` as the security policy.
8. **Point npm trusted publishing at the public repository**: first `npm owner ls mergebrief` must list your npm account. Then on npmjs.com, package `mergebrief`, Settings, Trusted Publisher: GitHub Actions, owner `Idan91`, repository `mergebrief`, workflow `release.yml`, no environment. npm keeps one record per package; the old one is replaced. Provenance needs no setting: `release.yml` passes no `--provenance`, and npm attaches it by itself for a public repository.
9. **Make the ghcr package public and link it**: package `idan91/mergebrief`. First check it exists: Your profile, Packages (`gh api` cannot tell without the `read:packages` scope). If it does not exist, skip the rest of this step until the first public `release.yml` image job has run: that job creates the package, and the image's `org.opencontainers.image.source` label links it to `Idan91/mergebrief`. Then, right after that job, change only its visibility to public (Package settings) and check the package page names `Idan91/mergebrief` as its repository, because the Release's compose files pin an image nobody can pull until it is public. If it exists, first open its versions list (Your profile, Packages, `mergebrief`, View and manage all versions) and delete every version built before the release, such as an early `0.1.0` from this repository's workflow: making the package public exposes every version it holds, by digest for good, and an old `0.1.0` stays the `0.1.0` tag until the real release overwrites it. Then Package settings, change visibility to public (this cannot be undone), and connect it to the `Idan91/mergebrief` repository. Then, under Manage Actions access, make sure `Idan91/mergebrief` is listed with the Write role: a package this repository's workflow created is not confirmed to let the public repository's `release.yml` push to it through the link alone. Done, either way, once a published version pulls without a login: `docker logout ghcr.io`, then `docker manifest inspect ghcr.io/idan91/mergebrief:<X.Y.Z>`.
10. **Check Actions is enabled** on the public repository (Settings, Actions, General; public repositories run Actions for free). The public repository needs no Actions secrets or variables: `release.yml` uses only its run's own `GITHUB_TOKEN` and npm's OIDC exchange.
11. **Make the security mailbox receive mail**: `SECURITY.md` ships in the first release and names `security@mergebrief.com` as the fallback when GitHub's form is not an option. Send it a test mail before the first publish. If it cannot receive by then, land a change dropping that line from `SECURITY.md` before resolving the source SHA, and restore it once the mailbox works.

## First release: 0.1.0

The dated order for `0.1.0-rc.1` on Fri 10-30 and `0.1.0` on Sat 10-31. Any step that runs differently from this guide gets fixed here the same day.

1. **Mon 10-26**: setup steps 0 to 2.
2. **Wed 10-28, the freeze**: `main` must hold everything the export and the shipped tree need. Check `origin/main` after `git fetch origin`, never a branch:
   - the export and the workflow: `git show origin/main:.github/workflows/publish.yml` prints it, and `git ls-tree origin/main tools/release/src/logic/export/` lists files.
   - the public name: `git show origin/main:tools/release/src/consts.ts` has `name: "mergebrief"` under `REPOSITORY`, and `git grep -n 'Idan91/code-review' origin/main -- . ':!tools/categorizer'` prints nothing. The categorizer's eval fixtures and golden snapshot keep the old name as data.
   - the gitleaks allowlist: `git show origin/main:.github/gitleaks.toml` opens with `[extend]` and `useDefault = true`. Without it, the gitleaks gate fails on the test fixtures' fake keys.
   - `SECURITY.md` and `.github/ISSUE_TEMPLATE/`, which setup steps 3, 7 and 11 assume.
   - the notes files: `docs/releases/0.1.0-rc.1.md` has `date: 2026-10-30` and `docs/releases/0.1.0.md` has `date: 2026-10-31`. Set both ahead, so one source can serve both releases.

   Then resolve `SOURCE` (Normal release, step 2) and run the final preview: `pnpm release:export --version 0.1.0-rc.1 --source "$SOURCE" --dry-run --out <empty dir>`. Done when every gate prints `ok` and the plan prints a `commit` line. Anything that lands on `main` later, such as a name re-sweep, a notes date or a `SECURITY.md` change, means resolving `SOURCE` again and repeating the preview on the new SHA.
3. **By Thu 10-29 morning**: freeze the repository name. If it is not `Idan91/mergebrief`, merge the re-sweep (One-time setup) and resolve `SOURCE` again.
4. **Thu 10-29**: setup steps 3 to 11. Then, if Actions runs on this repository, the dispatch rehearsal: Actions, Release, Run workflow on `main` with `version` `0.1.0-rc.1`, then again with `0.1.0`. A dispatch never publishes. Done when all five jobs pass and each run's `release-<version>` artifact holds both compose files pinned to that version, `.env.example` and `body.md`, plus `version.json` for `0.1.0` only. Without Actions, the rehearsal does not run, and rc.1 is the first real run of `release.yml`.
5. **Fri 10-30, `0.1.0-rc.1`**: Release candidate below, with `$SOURCE`. If the ghcr package did not exist before (setup step 9), make it public as soon as the image job is green. Then Checking a published release, then the pass in `docs/dev/pre-release-testing.md` against the candidate's artifacts.
6. **Sat 10-31, `0.1.0`**: Normal release with `--version 0.1.0` and the same `$SOURCE`, unless a fix landed after rc.1; a newer source must contain the rc.1 source. Then Checking a published release.

## Runbooks

### Normal release

1. Merge `docs/releases/X.Y.Z.md` to `main` as the last change before the release. Its `date:` is the day the tag is pushed, not the day the file was written.
2. Resolve the source once and keep it with the version: `git fetch origin && SOURCE=$(git rev-parse origin/main)`. Every later step, and every retry of this release, uses that SHA, never `origin/main` again.
3. Optional preview: `pnpm release:export --version X.Y.Z --source "$SOURCE" --dry-run`. It and the local fallback need Docker running, because the gitleaks gate runs the pinned scanner image.
4. Publish. In GitHub: Actions, Publish, Run workflow on `main`, `version` = `X.Y.Z`, `source` = `$SOURCE` (replace the form's default `main`). Approve the `Push the release` job when GitHub asks; the planned commit is the `commit` line in the plan job's `Plan and emit` log. Without required reviewers (setup step 2) nothing asks, so the dry run in step 3 is the check. Or locally (the fallback while Actions is unavailable):

   ```sh
   MERGEBRIEF_PUBLISH_TOKEN="$(gh auth token)" pnpm release:export --version X.Y.Z --source "$SOURCE"
   ```

   The local run pushes as your account, so it relies on the ruleset bypass, and the `gh` token needs the `workflow` scope for the same reason the App needs Workflows (`gh auth status` lists the scopes; `gh auth refresh -s workflow` adds it). It is the weaker path: the gates run without the token, but the token stays in the tool's own environment for the whole run, where another process of your user could read it. Prefer the workflow once Actions works.
5. Watch the public repository's Release workflow, then run [Checking a published release](#checking-a-published-release).

### Checking a published release

Run these once the public Release workflow is green (`gh run list --repo Idan91/mergebrief --workflow release.yml --limit 1`). A failed check goes to Recovery.

1. The record: `git ls-remote origin refs/tags/public/vX.Y.Z` prints one line.
2. npm: `npm view mergebrief dist-tags` shows the version under `latest` for the highest stable release, under `next` for a candidate that is the newest tag. The version's npmjs.com page shows a Provenance section naming `Idan91/mergebrief` and `release.yml`.
3. ghcr: with no login (`docker logout ghcr.io`), `docker manifest inspect ghcr.io/idan91/mergebrief:X.Y.Z` lists linux/amd64 and linux/arm64. For a stable release, `:latest` gives the same digest.
4. The Release: `gh release view vX.Y.Z --repo Idan91/mergebrief` lists `docker-compose.yml`, `docker-compose.external-db.yml` and `.env.example`. A candidate is marked Pre-release and has no `version.json`; a stable release is marked Latest and has `version.json` too.
5. The update check, stable only: `curl -fsSL https://github.com/Idan91/mergebrief/releases/latest/download/version.json` lists the version. Every instance reads that URL.
6. The CLI: `npm i -g mergebrief@next` for a candidate, `npm i -g mergebrief` for a stable release, then `mergebrief --version` prints it.
7. The first release only: the public repository's Security tab shows `SECURITY.md` as its policy, and Settings, General names `main` as the default branch.

The rest of the pass against the published artifacts is `docs/dev/pre-release-testing.md`, from Release artifacts on.

### Release candidate

Same as a normal release with `--version X.Y.Z-rc.N` and its notes file. Placement reads the published tags only, so the candidate takes `next` even when the stable notes file is already on `main`. The stable release that follows can export the same source: the second commit has an empty diff against the candidate's and a different message, which is correct.

### Hotfix

The export only takes a commit on `main`, and public `main` is one straight line of releases. A fix therefore ships as the next version off `main`: land the fix, add its notes file, export the next patch. A fix for an older line (`1.4.1` after `1.5.0`) cannot be exported today: the export refuses a version that is not above the last one exported (`1.4.1 is not above 1.5.0, the last version exported; export a higher version`). It needs a release branch model the export does not have.

### Re-applying a contributor's pull request

1. Review the PR on the public repository.
2. Apply the change here as a normal private PR. Its commit carries the contributor's trailer: `Co-authored-by: Name <email>`, with the address they commit with.
3. The next release commit's body lists that trailer, so GitHub credits them on the public commit.
4. Close the public PR with a link to the release that ships it. `CONTRIBUTING.md` tells contributors to expect this.

## Recovery

Every refusal prints one line naming what it found. Two different moves follow a failure:

- **Retry the same release**: the same version and the same source SHA, the one the first run printed on its `source` line: for the Publish workflow, the `source` line of the plan job's `Plan and emit` log (also the plan job's `source` output). Never the Publish run's `source` input, which defaults to `main` and then names whatever `main` is when you retry. The rebuilt commit has the same SHA and anything already pushed is skipped, so a retry is always safe. Never re-resolve `origin/main` for a retry: if `main` moved, a new SHA rebuilds a different commit, which the drift check refuses.
- **Start a new release after fixing the source**: only once nothing of the failed release is public. When its commit already sits on public `main`, finish it with a retry first, then land the fix on `main` and export the next version. A changed source never leads to moving public `main` back.

| Where it stopped | What you see | What to do |
| --- | --- | --- |
| A gate | `gate <name>: FAILED, ...` and `release: export stopped at gate <name>` | Nothing was pushed. Fix the cause on `main` through a normal PR, resolve `SOURCE` again, and run with the new SHA. |
| Commit pushed, tag not | Public `main` holds the release commit, no `vX.Y.Z` tag | Retry with the original source SHA. It sees `main` already on the rebuilt SHA and pushes the tag and the record. |
| Tag pushed, record not | Tag exists on the public repo, no `public/vX.Y.Z` here | Retry with the original source SHA. It pushes the record only. |
| The Publish workflow's plan or gates job | Red `Plan the release` or `Gate the planned commit` | Same as a gate failure. Nothing was pushed. `rebuilt <sha>, not the planned <sha>` means the gates job rebuilt the plan's source SHA into a different commit: a record or the public parent changed between the jobs, or the rebuild is not deterministic. Check for another publish run, then dispatch again with `source` set to the plan job's source SHA; if it repeats with nothing changed, the tool has a determinism bug. |
| The Publish workflow's push job | `publish: <reason>` | The bundle does not match the plan job's outputs. Do not push by hand. `planned against <url>, pushing to <url>` means `tools/release/src/consts.ts` and `publish.yml`'s `PUBLIC_URL` name different repositories: fix the one that is wrong on `main` first. Otherwise dispatch the workflow again with the same version and the plan job's source SHA, and find out what changed the artifact. |
| The push job's token or commit push | Red `Mint the publishing token` with GitHub's 422 `The permissions requested are not granted to this installation`; or, if the token was minted, the push refused with `` refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission ``. On the local fallback: `` refusing to allow an OAuth App to create or update workflow ... without `workflow` scope `` | Nothing was pushed. Give the App Workflows read and write and accept the update on its installation (setup steps 1 and 4), then re-run the push job. Locally, `gh auth refresh -s workflow`. |
| Tag pushed, public `release.yml` failed | Red Release run on the public repo | Re-run that workflow run on the public repository. Never move or recreate the tag. |
| A published release is broken | Every job green, but the shipped CLI, image or compose files fail | Nothing is undone. Never delete the tag (the tag ruleset refuses) or the Release, and never unpublish the npm version: npm refuses that version number for good afterwards. Fix it on `main` and ship the next version: `X.Y.Z-rc.N+1` after a candidate, the next patch after a stable release (Hotfix). |
| The public `release.yml` image job | `denied: permission_denied: write_package` | Add `Idan91/mergebrief` with the Write role under the package's Manage Actions access (setup step 9), then re-run the failed jobs. The tag stays. |
| Record missing for an old release | A later export refuses with the drift message, and public `main` is that release's `Release X.Y.Z` commit with its tag published | Retry that release with its original version and source SHA; it pushes the record only. Without the source SHA, recreate the record by hand on the source commit, with the full 40-character public SHA, never the drift message's 7-character one, which every later export fails to read: `SHA=$(git ls-remote https://github.com/Idan91/mergebrief 'refs/tags/vX.Y.Z^{}' \| cut -f1)`, then `git tag -a public/vX.Y.Z <source> -m "public-commit $SHA"` and `git push origin public/vX.Y.Z`. |
| Drift refusal | `public main at f00d... is not the last release commit a91c...; reconcile first` | Look at public `main` first. If its head is a `Release X.Y.Z` commit, an export pushed it: retry that release with its original version and source SHA (the row above when its tag is out), and never reset `main`. Only a commit no export made, such as a hand push or a merged pull request, is reconciled by hand: restore `main` to the last release commit with your bypass. The export never force-pushes. |

## Pitfalls

- **A `v*` tag in this repository.** The private `release.yml` fires on `v*`; it does not publish here, but the record tags are `public/v*` for that reason. Never push `vX.Y.Z` to `origin`.
- **Editing public `main`.** Any commit there makes every later export refuse with `public main at <sha> is not the last release commit <sha>; reconcile first`.
- **Uncommitted work.** The export reads git, never the checkout. A fix you have not merged to `main` is not in the release, and `<sha> is not on origin/main; export a commit main holds` means the source is not merged.
- **A reused repository name.** After a rename, GitHub redirects the old name until a new repository takes it, which breaks every shipped update-check and download URL. Never reuse it.
- **The local fallback without the bypass.** A push as your account fails on the `main` ruleset unless your account is in its bypass list.
- **A missing token.** `release: export without --dry-run publishes and needs MERGEBRIEF_PUBLISH_TOKEN in the environment`.
- **A new top-level directory.** `unclassified top-level path: notes/` until the manifest names it in `include` or `exclude`.
- **Private eval cases.** They live in `tools/categorizer/eval/private-cases/` and `private-pair-cases/`, which the manifest excludes. A case placed in the shipped dirs ships.
- **A secret-shaped test value.** `gate gitleaks: FAILED`. If it is a fake, add the exact value to the `[[allowlists]]` regexes of `.github/gitleaks.toml` with a comment naming the fixture; the CI diff scan reads the same file. The file must keep `[extend]` with `useDefault = true` at the top: a config without it replaces gitleaks' default rules, and the gate then passes every tree. If the file does not exist yet, create it with those two lines first. If the value is real, rotate it first.
- **Docker not running.** `gate gitleaks: FAILED, ...; the gitleaks gate needs Docker`. Start Docker and run again; nothing was pushed.
- **A gitleaks error.** `gitleaks could not complete the scan; its error is above` is a broken config or scanner, not a finding: read gitleaks' own error on stderr.
- **A doc that points at private material.** `gate paths: FAILED, ... <file>:<line>: mention of docs/internal/`. Rewrite the line so it states the fact itself.
- **The same version from a different source.** `0.1.0 already exported from 4e1a9c2; refusing 7b20f11`. Retry with the original SHA, or pick the next version.
- **A version or source behind the last export.** `0.1.1 is not above 0.2.0, the last version exported; export a higher version`, or `<sha> does not contain <sha>, which 0.2.0 was exported from; export a later commit on main`. Exports go out in version order from a source that only moves forward.
- **A tag that exists elsewhere.** `tag v0.1.0 exists at <sha>; tags never move`. Pick the next version.
- **The public repository does not exist yet.** A dry run says `public repo Idan91/mergebrief not found; treating as no releases (dry run only)`; a real run refuses with `public repo Idan91/mergebrief not found; a publish needs it`.

## Leaving the snapshot model

Switch to developing on the public repository once a co-maintainer joins, or once external pull requests arrive faster than re-applying them is worth. Then:

1. Move what the manifest's `exclude` list names (`docs/internal/`, the private eval dirs, `.claude/` and the rest) into a small private sidecar repository.
2. Continue on public `main` from the latest release commit.
3. Archive this repository. It is never made public: its history holds what the snapshots leave out.
