# tools/release — agent notes

The release tool behind `release.yml`: reads the per-release notes files, refuses a tag without one, stamps the tag's version into the shipped manifests, and writes the Release body and `version.json` the workflow uploads. `pnpm check:releases` is its gate inside `pnpm lint`; the other commands run on the workflow's checkout only.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **One notes file per release**, `docs/releases/<X.Y.Z>.md` or `<X.Y.Z-rc.N>.md`, version in the filename only. Front matter is exactly three `key: value` lines between `---` fences: `date` (ISO `YYYY-MM-DD`, the tag day), `breaking`, `security` (`true` or `false`). No quotes, no nesting, no indentation, no repeated or other key; the parser is the schema beside it, not a yaml library. A `breaking` file carries an `## Upgrade` heading. Any other file in the directory is a refusal.
- **Every argument is known.** An unknown flag, a `--flag=value` form, a flag without its value or a stray positional is a usage error (exit 2), never a silent fallback to the no-tag path.
- **A tag needs its file.** `check --tag vX.Y.Z` refuses when the file is missing or any file is malformed, so the gate on the PR is the same gate the tag runs. `--json` prints `{ version, channel, isHighestStable, isHighest }` for the workflow; `isHighestStable` decides `--latest` on the Release, `latest` on npm and ghcr and whether `version.json` is written, never GitHub's own ordering; `isHighest` (over every channel) decides whether an rc takes the npm `next` dist-tag, so an older candidate published later never moves `next` back. The workflow passes the tags already published as `--known-tags v0.1.0,v0.2.0`, so a hotfix tagged from an older branch is placed against what shipped, not only against the notes files its checkout carries. A notes file is merged right before its tag, never ahead of another release.
- **The stamp edits a clean checkout once; the prune shapes the tarball after the build.** `stamp <version>` refuses a manifest whose version is not the `0.0.0` sentinel, writes the version and keeps every other key, swaps every `image: ghcr.io/idan91/mergebrief:dev` line in both compose files (and refuses a file with none), and touches nothing else. `prune-manifest` refuses a manifest still on the sentinel and drops `private` and `dependencies` (the bundle inlines them; the repo keeps them listed so `pnpm audit --prod` still sees them, and a published `workspace:` range would resolve to a public package of the same name). The prune runs after the last pnpm script in `apps/cli`: pnpm reinstalls before a script whose manifest no longer matches the lockfile, which prunes the bundle's inputs and fails the build. Compose files are edited line by line so comments survive; the manifest is re-serialised with two-space indent, which is what prettier writes. Nothing here commits.
- **`version.json` and the Release body come from the notes files, never by hand.** `version-json <tag> --known-tags ... --out <file>` writes `{ latest, releaseNotesUrl, releases[] }` over the stable files, newest first, and refuses unless the tag is the highest stable release among the files and the published tags, so the file is only ever written for the release that `releases/latest/download` will serve; candidates are left out, and an rc or an older hotfix gets no version.json. `release-body <tag> --out <file>` writes the Release body: for a stable tag the upgrade chain from `docs/self-host/operations.md` with the tag filled in (a test holds the two in step), a lead line for a breaking or security release, the backup and upgrade-step links, then the notes body verbatim; for an rc a not-for-production note with the `next` dist-tag, no chain. Every link is the Release page or the tag-pinned doc.
- **Own version grammar.** `X.Y.Z` or `X.Y.Z-rc.N`, no leading zeros, optional `v`. Narrower on purpose than persistence's `parseSemver`, which drops any suffix; a candidate sorts before its release here.
- **`src/main.ts` is the only composition root**: argv and the repo root (resolved from the file's location) enter there.

## Verification

```sh
pnpm -C tools/release test          # temp trees, one per refusal
pnpm check:releases                 # the gate over docs/releases
pnpm -C tools/release version-json v0.1.0 --out /tmp/version.json && pnpm -C tools/release release-body v0.1.0 --out /tmp/body.md
pnpm -C tools/release stamp 0.1.0 && pnpm -C apps/cli build && pnpm -C tools/release prune-manifest && git diff --stat && git checkout -- apps/cli/package.json docker-compose.yml docker-compose.external-db.yml
```
