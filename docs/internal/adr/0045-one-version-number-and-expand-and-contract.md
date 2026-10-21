# 0045: One version number, and expand and contract on every release

Status: amended (see Amendments)
Date: 2026-10-02

Amends ADR 0028 #6 and ADR 0029 #8
(both carry their amendment notes).

One git tag `vX.Y.Z` is the version of everything a release ships: the
image on ghcr, the `mergebrief` package on npm, the GitHub Release and its
`version.json`. Every release keeps the previous release running beside
it: a schema change that drops, renames or tightens splits into an Expand
step in one release and a Contract step in the next, majors included
(amended, see Amendments: not before the first release).

## Context

- An operator upgrades an instance by pulling one image and one compose
  file; a reviewer installs the CLI from npm whenever they like. Nothing
  forces the two to move together, so the server and the CLI a person
  holds can run different releases for weeks (CONTEXT.md: Skew).
- The repository keeps `0.0.0` in `apps/cli/package.json` and reports
  `dev` from a source build. A publish stamps the tag's version on the
  runner and never commits it, so there is no release commit to keep in
  step with the tag.
- Rollback is "run the previous release again", and an upgrade may roll
  through api, web and worker one container at a time. Both put release
  N-1 next to release N's schema for a while.
- The update check compares the instance's version with the newest
  release in `version.json` and must say whether the gap holds a breaking
  or a security release. A number per component cannot answer that.

## Considered options

- **Independent versions per component (the CLI's original rule).** Each
  artifact moves at its own pace, but every doc, notice and skew warning
  has to name two numbers, and "which CLI goes with server 1.4" becomes a
  compatibility table nobody maintains.
- **Forward-only migrations, with downgrade scripts.** Simpler migration
  authoring, but a rollback needs a down migration that has to be written
  and tested for every change, and a rolling upgrade is unsafe during the
  window where old code meets the new schema.
- **One version number and expand and contract (chosen).** One number
  everywhere, no down migrations, rollback is the previous image, and
  rolling upgrades are safe by construction. The price is that a
  destructive change takes two releases and the author decides the split.

## Decision

- The tag is the version. The image, the npm package, the Release, the
  `MergeBrief-Version` header, `GET /api/version`, `mergebrief --version`
  and the `instance_version` row all carry the same `X.Y.Z`. A dev build is
  `dev` (server) or `0.0.0` (CLI) and never checks, compares or warns.
- Release N-1 runs beside release N: schema, job payload and HTTP contract.
  A drop, rename or tightening ships as a Contract step one release after
  its Expand step. The default is never a rename: add the column, read
  with a fallback, drop next release. `pnpm check:migrations` holds the
  rule: a destructive statement needs a first line `-- contracts <release>`
  (amended, see Amendments: two exemptions).
- `breaking` and `security` are set by hand in the release's notes file.
  `breaking` means the three-line upgrade step is not enough: a new or
  removed required env key, a Postgres major, a suspended expand and
  contract rule, or a manual data step.
- Skew never refuses. The CLI warns on a major gap, annotates a failed
  run's error line with both versions, and suggests the matching install
  command; the server never branches on the CLI's version.

## Consequences

- A candidate is not a release: neither version parser accepts the `-rc`
  suffix, so an instance or a CLI running a candidate gets no notice, no
  nag and no skew line until it runs a stable version again. A
  `vX.Y.Z-rc.N` tag still publishes (`.github/workflows/release.yml`): the
  image to ghcr and the package under npm's `next` dist-tag, or
  `superseded` when a newer tag exists.
- A Postgres major bump is always a breaking release with a dump, down,
  remove volume, up, restore sequence; the floor stays at 16.
- Two version sources are a defect: anything that reads a version reads
  the stamped one, and the repo's `0.0.0` sentinel is what the gates check
  for.

## Amendments

### 2026-10-20: Before the first release, expand and contract collapse

No release tag exists yet, so there is no release N-1 to keep running. Until
the first release a schema change that drops, renames or tightens ships as one
migration that moves the data in the same step, and no reader keeps code for
the older shape (root `AGENTS.md`, "Until release, a stored shape only moves
forward"; `packages/persistence/AGENTS.md`). Such a migration opens with
`-- contracts 0.1.0`, naming the first release as the one it contracts into,
so `pnpm check:migrations` stays green; seven migrations carry it, for example
`packages/persistence/drizzle/0058_drop-diff-snapshot.sql`. The two-release
split applies from the first release on.

The gate carries two exemptions the Decision does not name
(`packages/persistence/scripts/migration-contracts.ts`): a constraint drop
needs no contracts line when the file carries `-- widens <name>` and re-adds
a CHECK under that name, with review judging that the new CHECK widens
(`0052_generation-claims.sql`); and the seventeen migrations that predate the
rule are grandfathered by name, held exact by the test suite, and never
retro-fixed.
