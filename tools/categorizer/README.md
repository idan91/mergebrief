# Categorizer

Turns a real pull-request diff into a structured review **brief**: a *story* (what the PR does), *change groups* with an intent category, and per-chunk *concern* + *role* + *risk-surface* flags. The brief is meant to help a reviewer decide where to look; it never approves, rejects, or scores.

> **Layout**: the domain core (schema, prompt, categorize engine,
> repo-context, delta/comparison: everything production consumes) lives in
> `packages/brief-core`; this directory keeps the dev CLIs (`pnpm categorize`,
> `pnpm delta` in `src/cli/`, with their `gh` fetchers in `src/github/` and
> output naming in `src/artifacts/`) and the eval harness (`eval/`,
> `pnpm eval`).

The CLIs run the production engine locally against a real PR, for development and dogfooding, and write their artifacts to disk instead of Postgres.

## How it works

```
PR URL ──▶ gh pr diff + gh pr view ──▶ the configured generator (Zod schema floor) ──▶ brief JSON
```

- **Diff source:** the `gh` CLI (`gh pr diff` + `gh pr view --json`). No GitHub token setup; it uses your existing `gh` auth.
- **Model:** the generator `--config <mergebrief.config.yaml>` selects (see `docs/self-host/generators.md`). Without `--config` it is the zero-config default: the Anthropic adapter on `claude-opus-5-5`, adaptive thinking, with the taxonomy system prompt prompt-cached. The CLIs ignore an ambient `MERGEBRIEF_CONFIG`.
- **Lockfiles:** the CLIs pass no lockfile contents, so every changed pnpm, npm or yarn lockfile carries `changes-package-source` in their briefs; the worker reads both sides and flags only a real source change.
- **Output contract:** the model must return JSON matching the Zod `BriefSchema` (`packages/brief-core/src/types.ts`), whose enums mirror the closed vocabulary in `docs/vocabulary/labeling-schema.md` and the 19 attributes in `docs/vocabulary/risk-surface.md`.

## Setup

Requires Node 24 or 26+ (the repo's `engines`; `.nvmrc` pins the CI version), [`pnpm`](https://pnpm.io), and an authenticated [`gh`](https://cli.github.com) CLI.

```bash
cd tools/categorizer
pnpm install

# Anthropic API key: get one (and credits) from https://console.anthropic.com
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is gitignored, so the key stays out of version control. If you run a coding agent here, deny it reads of this file in the agent's settings, as the maintainers' Claude Code settings do. The SDK loads the key from the process environment at runtime.

## Usage

```bash
pnpm categorize [--config <file>] [--out <dir>] <pr-url> [<pr-url> …]           # whole PR at current head
pnpm categorize [--config <file>] [--out <dir>] <pr-url> <base-sha> <head-sha>  # brief over an explicit span
```

Example:

```bash
pnpm categorize https://github.com/medusajs/medusa/pull/15605
```

For each brief it writes three files under `out/` (or the `--out` directory; point it at `MERGEBRIEF_OUT_DIR` to open the result in the dev brief viewer), versioned by a PR-global **index** and the head SHA so successive briefs of one PR coexist:

- `out/<owner>-<repo>-<num>_<index>_<head8>.brief.json`: the brief (now carrying `index` + `commitRange`)
- `…_<index>_<head8>.diffs.json`: per-file diffs sidecar
- `…_<index>_<head8>.comments.json`: review comments (all reviewers, threaded, each with GitHub-native `outdated`) for GitHub-style display

The index is assigned from a per-PR manifest `out/<owner>-<repo>-<num>.briefs.json` (head SHA → ordinal, first-seen; re-running a known SHA reuses its index). Multiple PRs run in parallel; one bad URL doesn't abort the batch.

By default the brief covers the **whole PR at the current head** (range read from `gh pr view`). Passing an explicit `<base-sha> <head-sha>` (mirroring `delta`) briefs that span instead, useful for dogfooding the full flow on a real PR with comments: generate `_1` at an earlier head, then a `delta`, then `_2` at the later head.

### Primary ticket (`--context <file>`)

The brief names one **primary ticket** per PR (a key matching the repo's `tracker:` block in `.mergebrief/settings.yaml`, a `#N`, an issue URL, or a branch segment starting `N-`) and reads it through a tracker provider. When no provider can read it locally, or an MCP or script already has the text, hand it over as JSON:

```bash
pnpm categorize --context ticket.json https://github.com/o/r/pull/1
```

```json
{ "url": "https://tasks.example/DS-42", "key": "DS-42", "tracker": "notion", "title": "…", "header": "Status: Now", "content": "…" }
```

Only `url` and `content` are required. The file replaces the fetch for the primary and is stamped as read. An unread primary prints `error: <key> could not be read (<code>) — <reason>` on stderr and still exits 0: the brief was generated, the alignment read is absent. `delta` takes the same flag.

### Delta (re-review reload)

```bash
pnpm delta [--config <file>] [--context <ticket.json>] <pr-url> <baseline-sha> <head-sha>
```

Generates the **delta core**, "what changed since the baseline", for a reviewer returning to a PR. It fetches the incremental diff via the GitHub compare API (`baseline...head`, three-dot/merge-base semantics, exact for normal follow-ups; the rebase-robust two-dot needs a local clone, a known limitation), then runs the delta categorizer. Writes `out/<owner>-<repo>-<num>-<base8>..<head8>.delta.json` plus a per-file `.delta.diffs.json` sidecar and a `.delta.comments.json` comments sidecar (same shapes as the brief's sidecars). Note: comment `outdated` is GitHub's flag relative to the PR's *current* head, not the delta's head (documented in `src/github/comments.ts`).

Each delta chunk belongs to exactly one change-group (a file appears in multiple groups only via different chunks), so no line is shown to the reviewer twice.

This is the delta **core** only. The per-reviewer **carry-over overlay** (reopened/settled flags, moved/orphaned comments) needs reviewer state and is out of scope for the stateless CLI. SHAs must be hex commit-ishes (7–40 chars).

### Output

- **File:** the full brief as pretty JSON in `out/` (gitignored).
- **stdout summary:** the PR story, each change group (`[dominant-category] (+secondary) summary`, with an `⚠ uncertain: A vs B` marker when the model is genuinely unsure), the per-concern LoC rollup, and the chunks carrying risk-surface flags.

## The brief

| Field | Meaning |
|---|---|
| `pr` | repo, number, title, url, sha (sourced from our own fetch, never the model) |
| `summary` | plain-English what-the-PR-does |
| `changeGroups[]` | one *summary* + one *dominant category* each; `secondaryCategories`, honest `uncertain` / `uncertainBetween`, and core/supporting chunk ids |
| `chunks[]` | `file`, `concern` (implementation/test/doc/spec/config/generated), `role` (core/supporting), git `loc {added,deleted}`, `addedRanges`/`removedRanges` (changed-line ranges by side, for diff rendering), and `riskSurface[]` |
| `concernView[]` | LoC rollup per concern |

### Known approximations (flagged, not hidden)

- **Adjusted LoC ≈ git LoC.** Reliable move detection is out of scope; the model reports git added/deleted and notes likely relocations in the group summary rather than netting out moved lines.
- **No automated gold scorer.** Validation here is a manual eyeball of a run's output; there is no hand-labeled gold set. Automated scoring is later work.

## Development

```bash
pnpm typecheck   # tsc --noEmit (strict)
pnpm test        # vitest run
```

Tests cover the pure logic: `gh` output parsing (`src/github/`), output filename + summary rendering (`src/artifacts/output.ts`), and CLI flag and `--context` file parsing (`src/cli/`). PR-URL parsing and brief-schema vocabulary enforcement are tested in brief-core. The network and model paths are exercised by manual runs.

### Files

| File | Purpose |
|---|---|
| `packages/brief-core/src/types.ts` | Zod brief + delta schemas: the closed vocabulary, the heart |
| `src/github/` | `gh pr diff` / `gh pr view` / `gh api …/compare` (no shell; validated) |
| `packages/brief-core/src/generation/prompt.ts` | brief + delta system prompts, assembled from the schema constants so they can't drift |
| `packages/brief-core/src/generation/categorize.ts` | shared streaming helper → `categorize()` (brief) + `categorizeDelta()` (delta core) |
| `src/artifacts/output.ts` | output filenames (index/head-versioned) + stdout summary rendering (brief + delta) |
| `src/artifacts/manifest.ts` | per-PR brief manifest (head SHA → PR-global index); the stateless stand-in for the product DB |
| `src/cli/categorize.ts` | brief CLI: args (whole PR or explicit span) → fetch → categorize → write brief + diffs + comments sidecars |
| `src/cli/delta.ts` | delta CLI: url + base/head SHAs → compare diff → categorizeDelta → write delta + diffs + comments sidecars |
