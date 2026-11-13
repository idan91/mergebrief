# How a release is published

One git tag publishes a release: the CLI on npm, the image on ghcr, and a
GitHub Release with the compose files. Nothing is committed during the run.
The workflow is `.github/workflows/release.yml`; the tool behind it is
`tools/release`.

Each release reaches this repository as one snapshot commit, `Release X.Y.Z`,
with its tag `vX.Y.Z`. Development happens upstream, and a pull request here
is applied there with a `Co-authored-by:` trailer, then ships in the next
release commit ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)).

## Checklist

1. Write `docs/releases/X.Y.Z.md` ([The notes file](#the-notes-file));
   `pnpm lint` refuses a malformed one.
2. Run the pass in [`pre-release-testing.md`](./pre-release-testing.md)
   against the last candidate's artifacts.
3. Publish the release commit and its tag.
4. Watch the five jobs ([What the tag does](#what-the-tag-does)). A red job
   is re-run as is; nothing needs undoing.
5. Confirm the placement `verify` printed: `npm view mergebrief dist-tags`
   shows the version under `latest` when the tag is the highest stable
   one; `latest` on ghcr and `releases/latest/download/version.json` move
   with it.
6. Announce. The Release page is the link; the notice reaches instances
   within a day.

A candidate takes steps 1 to 4 with `X.Y.Z-rc.N`
([Release candidates](#release-candidates)); step 5 is
`npm view mergebrief dist-tags` showing the candidate under `next` when it
is the newest tag of any kind and under `superseded` otherwise, plus the
prerelease page (no `version.json`, nothing on ghcr but the rc tag), and
step 6 has no notice to wait for.

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
  expand-and-contract rule, or a manual data step. A breaking file needs an
  `## Upgrade` section that lists the extra steps in order.
- `security`: `true` when the release fixes a vulnerability.

The body is the release notes. For a stable tag the GitHub Release body
opens with the upgrade step for that tag, then the body as written; an rc
opens with a not-for-production note instead. `pnpm check:releases`, inside
`pnpm lint`, refuses a malformed file on the PR, and the tag runs the same
check.

A notes file may land before its tag. Placement reads the published tags
only, so a stable file merged ahead of its candidate leaves the candidate
on `next`, and `version.json` lists the stable files up to the tag.

Only `vX.Y.Z` and `vX.Y.Z-rc.N` publish. Any other `v*` tag fails the first
job.

## What the tag does

Five jobs. `cli` and `image` run in parallel after `verify`; `npm` waits for
`cli`; `release` waits for `npm` and `image`.

1. **verify** checks the tag's shape and its notes file, then places the tag
   against the tags already published. That placement decides whether this
   release becomes `latest` and which npm dist-tag it gets. A repository
   other than the publishing one runs the checks with `publish=false`.
2. **cli** stamps the version into `apps/cli/package.json` and both compose
   files on the runner, uncommitted, then builds. The sentinel guard
   (`scripts/refuse-sentinel-publish.ts`) refuses a `0.0.0` manifest or a
   stale bundle. The manifest is then pruned of `private` and
   `dependencies` (the bundle inlines them), and `npm pack` writes the
   tarball.
3. **npm** publishes that tarball through npm trusted publishing; no npm
   token lives in the repo. The dist-tag is `latest` for the highest stable
   version, `next` for an rc that is the newest tag of any kind,
   `maintenance` for a stable version below the highest, and `superseded`
   for an older rc. Right before publishing, the job reads the tags again,
   so a re-run after a newer tag shipped can only demote. A version npm
   already holds with the same bytes is skipped; one with different bytes
   fails the job.
4. **image** pushes `ghcr.io/idan91/mergebrief:X.Y.Z` for linux/amd64 and
   linux/arm64, and tags it `latest` only when `verify` placed it there.
5. **release** creates a draft Release, uploads `version.json`, the two
   compose files with the exact image pin, `.env.example` as it is under the name `env.example`, and `mergebrief.config.example.yaml`,
   then publishes, passing `--latest` by placement. `version.json` is built
   only for the highest stable release, because every instance reads
   `releases/latest/download/version.json`.

`latest` on npm, on ghcr and on the Releases page moves only when the tag is
the highest stable version.

The Release's compose files pin an image nobody can pull while the ghcr package
is private, so a package's first release also changes its visibility to public.
Check it with no login: `docker logout ghcr.io`, then `docker manifest inspect
ghcr.io/idan91/mergebrief:X.Y.Z`.

## Release candidates

`vX.Y.Z-rc.N` runs the same path. The CLI goes to the npm `next` dist-tag
(`npm i -g mergebrief@next`) when the candidate is the newest tag of any
kind, and to `superseded` otherwise, so an older candidate published later
never moves `next` back. The Release is marked as a prerelease, no
`version.json` is uploaded, and nothing moves `latest`. `next` stays on the
last candidate until the next one: after the release it previewed ships,
`next` is older than `latest`.

The stable release a candidate previews can come from the same upstream
commit; its snapshot commit then has an empty diff against the
candidate's.

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
uploads use `--clobber`, and the image push overwrites the same tag. A
published tag is never moved or recreated.

Upgrading an instance: [`docs/self-host/operations.md`](../self-host/operations.md).
The pre-release pass: [`pre-release-testing.md`](./pre-release-testing.md).
