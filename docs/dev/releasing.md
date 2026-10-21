# How a release is cut

One git tag publishes a release: the CLI on npm, the image on ghcr, and a
GitHub Release with the compose files. Nothing is committed during the run.
The workflow is `.github/workflows/release.yml`; the tool behind it is
`tools/release`.

## Checklist

1. Write `docs/releases/X.Y.Z.md` ([The notes file](#the-notes-file)) and
   open its PR; `pnpm lint` refuses a malformed one.
2. Run the pass in [`pre-release-testing.md`](./pre-release-testing.md)
   against the last candidate's artifacts.
3. Merge the notes PR as the last change before the tag.
4. Cut the tag from the tip of `main` ([Tagging](#tagging)):
   `pnpm release patch --push`, or `minor` or `major`.
5. Watch the five jobs ([What the tag does](#what-the-tag-does)). A red job
   is re-run as is; nothing needs undoing.
6. Confirm the placement `verify` printed: `npm view mergebrief dist-tags`
   shows the version under `latest` when the tag is the highest stable
   one, under `maintenance` for a hotfix on an older line; `latest` on ghcr
   and `releases/latest/download/version.json` move only in the first
   case, and a hotfix leaving them alone is correct, not a failed run.
7. Announce. The Release page is the link; the notice reaches instances
   within a day.

A candidate takes steps 1 to 5 with `X.Y.Z-rc.N`
([Release candidates](#release-candidates)); step 6 is
`npm view mergebrief dist-tags` showing the candidate under `next` when it
is the newest tag of any kind and under `superseded` otherwise, plus the
prerelease page (no `version.json`, nothing on ghcr but the rc tag), and
step 7 has no notice to wait for.

## The notes file

Every release has one notes file, `docs/releases/<X.Y.Z>.md` or
`docs/releases/<X.Y.Z-rc.N>.md`. The version lives in the filename only.
The front matter is exactly three lines between `---` fences:

```md
---
date: 2026-10-03
breaking: false
security: false
---
```

- `date`: the day the tag is pushed, as `YYYY-MM-DD`.
- `breaking`: `true` when the documented upgrade step is not enough: a new
  required or removed env key, a Postgres major, a suspended
  expand-and-contract rule, or a manual data step. A breaking file needs an `## Upgrade`
  section that lists the extra steps in order.
- `security`: `true` when the release fixes a vulnerability.

The body is the release notes. For a stable tag the GitHub Release body
opens with the upgrade step for that tag, then the body as written; an rc
opens with a not-for-production note instead. `pnpm
check:releases`, inside `pnpm lint`, refuses a malformed file on the PR, and
the tag runs the same check.

Merge a stable release's notes file right before its tag, never ahead of
another stable release. An rc file may sit beside the stable file it
precedes.

## Tagging

Merge the notes PR, then cut the tag from the tip of `main`. You choose
how far the version moves; the tool computes it over the tags already on
the remote, so the repository's `0.0.0` never enters the calculation:

```sh
pnpm release patch --dry-run   # prints the tag and commit it would write
pnpm release patch --push      # writes the tag and pushes it
```

| Highest stable tag `v0.2.3` | `pnpm release` computes |
| --------------------------- | -------------- |
| `patch`                     | `0.2.4`        |
| `minor`                     | `0.3.0`        |
| `major`                     | `1.0.0`        |
| `minor --rc`                | `0.3.0-rc.1`, then `rc.2` on the next cut |

Before it writes a tag, the tool fetches `main` from the remote (the dry
run does that too, and nothing else) and tags its tip as fetched, so a
clone that is behind never tags a stale commit; `--at <ref>` picks an
older commit, which must still be on `main`. It refuses when the commit
is not on `main`, when the computed version's notes file is not in that
commit or does not parse, or when a local tag of that name already
exists. Without `--push` it leaves the local tag and prints the
push command; the push is what starts the workflow. A push that fails
leaves the local tag and names the retry. The tool always bumps the
highest stable tag, so a hotfix on an older line (`1.4.1` after `1.5.0`
shipped) is tagged by hand: `git tag v1.4.1 <commit> && git push origin
v1.4.1`.

Only `vX.Y.Z` and `vX.Y.Z-rc.N` publish. Any other `v*` tag fails the first
job.

## What the tag does

Five jobs. `cli` and `image` run in parallel after `verify`; `npm` waits for
`cli`; `release` waits for `npm` and `image`.

1. **verify** checks the tag's shape and its notes file, then places the tag
   against the tags already published. That placement decides whether this
   release becomes `latest` and which npm dist-tag it gets.
2. **cli** stamps the version into `apps/cli/package.json` and both compose
   files on the runner, uncommitted, then builds. The sentinel guard
   (`scripts/refuse-sentinel-publish.ts`) refuses a `0.0.0` manifest or a
   stale bundle. The manifest is then pruned of `private` and
   `dependencies` (the bundle inlines them), and `npm pack` writes the
   tarball.
3. **npm** publishes that tarball through npm trusted publishing; no npm
   token lives in the repo. The dist-tag is `latest` for the highest stable
   version, `next` for an rc that is the newest tag of any kind,
   `maintenance` for a hotfix on an older line, and `superseded` for an
   older rc. Right before publishing, the job reads the tags again, so a
   re-run after a newer tag shipped can only demote. A version npm already holds with the same bytes is skipped; one
   with different bytes fails the job.
4. **image** pushes `ghcr.io/idan91/mergebrief:X.Y.Z` for linux/amd64 and
   linux/arm64, and tags it `latest` only when `verify` placed it there.
5. **release** creates a draft Release, uploads `version.json`, the two
   compose files with the exact image pin, and `.env.example` as it is,
   then publishes, passing `--latest` by placement. `version.json` is built only for the highest stable release,
   because every instance reads `releases/latest/download/version.json`.

`latest` on npm, on ghcr and on the Releases page moves only when the tag is
the highest stable version.

## Release candidates

`vX.Y.Z-rc.N` runs the same path. The CLI goes to the npm `next` dist-tag
(`npm i -g mergebrief@next`) when the candidate is the newest tag of any
kind, and to `superseded` otherwise, so an older candidate published later
never moves `next` back. The Release is marked as a prerelease, no
`version.json` is uploaded, and nothing moves `latest`. `next` stays on the
last candidate until the next one: after the release it previewed ships,
`next` is older than `latest`.

The first rc before the first stable release is the live rehearsal of the
whole path: `pnpm release minor --rc --push` on a tree whose
`docs/releases/0.1.0-rc.1.md` is merged.

Known limit: a candidate is not a release to the version parsers, so an
instance or a CLI running an rc gets no banner, no update line and no
skew warning until it runs a stable version again.

## Rehearsing without publishing

In GitHub: Actions, Release, Run workflow. Set the `version` input (no `v`)
to a version whose notes file exists. Nothing publishes: npm runs a dry
run, the image is built and stays on the runner, and the Release assets and
body land as a workflow artifact to read.

Once a version is published, rehearse with the next unpublished one.

## Re-running a half-done release

Re-run the tag's workflow. Every job is idempotent: npm skips a version it
already holds with the same bytes, the release job reuses its draft,
uploads use `--clobber`, and the image push overwrites the same tag.

## The publishing repository

The release workflow runs from the repository that holds the public
history, which is not this one: the public repository starts fresh. Three
constants name the repository and move with it, in one change before the
first tag there: the update check's default URL
(`apps/api/src/update-check/consts.ts`), the release tool's repository
constants (`tools/release/src/consts.ts`, which also feed the asset links
in the Release body) and the CLI manifest's `repository` field. Every
other mention follows in the same change, and there are many: the
Dockerfile's source label, the default update-check URL as
`.env.example` and `docs/self-host/operations.md` print it, the fresh-host
download commands in `docs/self-host/compose.md`, the upgrade and rollback
download commands in `docs/self-host/operations.md`, the README's clone
and release links, and the release-notes links the api and the CLI
print. `git grep -l 'Idan91/code-review'` lists all of them, plus data
that names the repository only as a PR locator: the eval fixtures under
`tools/categorizer/eval/` and the categorizer's pipeline snapshot. That
data stays, since changing a fixture changes what its baseline measured.
The move is done when the list holds only that data, and the public
installation instructions are then the first thing to run against the
public repository. The npm
Trusted Publisher record below is registered on that repository, never on
this one: npm keeps one such record per package, and it names the
repository and the workflow file. The ghcr image name depends on the
owner, not the repository, so it survives the move.

## One-time setup (maintainer)

1. Turn on Actions billing for the account. Until then every run fails at
   zero steps.
2. Add the npm Trusted Publisher on npmjs.com for the package `mergebrief`
   (it exists there already, which is what the settings page needs):
   GitHub Actions, the owner and name of the publishing repository,
   workflow `release.yml`, no environment.
3. Run the dispatch rehearsal.
4. Confirm the written IP clearance the distribution decision record
   requires before any public work; the rc tag below publishes to npm and
   ghcr.
5. Push the first rc tag, then `v0.1.0`.
6. At launch, set the ghcr package `mergebrief` to public in its Package
   settings (this cannot be undone), then make the repository public. npm
   attaches provenance by itself from then on.

Upgrading an instance: [`docs/self-host/operations.md`](../self-host/operations.md).
The pre-release pass: [`pre-release-testing.md`](./pre-release-testing.md).
