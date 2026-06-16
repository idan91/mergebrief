# Categorizer

Turns a real pull-request diff into a structured review **brief** — a *story* (what the PR does), *change groups* with an intent category, and per-chunk *concern* + *role* + *risk-surface* flags. The brief is meant to help a reviewer decide where to look; it never approves, rejects, or scores.

This is the dogfoodable thin slice that validates the categorizer (the unproven core) by building it and eyeballing its output against hand-labels. See `docs/plans/categorizer-thin-slice.md` and `docs/mvp/center-of-gravity.md`.

## How it works

```
PR URL ──▶ gh pr diff + gh pr view ──▶ Opus 4.8 (messages.parse + Zod schema) ──▶ brief JSON
```

- **Diff source:** the `gh` CLI (`gh pr diff` + `gh pr view --json`). No GitHub token setup — uses your existing `gh` auth.
- **Model:** `claude-opus-4-8`, adaptive thinking, with the taxonomy system prompt prompt-cached.
- **Output contract:** the model must return JSON matching the Zod `BriefSchema` (`src/types.ts`), whose enums mirror the closed vocabulary in `docs/mvp/labeling-schema.md` and the 16 attributes in `docs/mvp/risk-surface.md`.

## Setup

Requires Node 20.6+ (for `process.loadEnvFile`), [`pnpm`](https://pnpm.io), and an authenticated [`gh`](https://cli.github.com) CLI.

```bash
cd tools/categorizer
pnpm install

# Anthropic API key — get one (and credits) from https://console.anthropic.com
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is gitignored **and** denied to the Claude Code agent via `.claude/settings.json`, so the key stays out of version control and out of agent reads. The SDK loads it from the process environment at runtime.

## Usage

```bash
pnpm categorize <pr-url> [<pr-url> …]
```

Example:

```bash
pnpm categorize https://github.com/medusajs/medusa/pull/15605
```

For each PR it writes `out/<owner>-<repo>-<number>.brief.json` and prints a human-readable summary to stdout. Multiple PRs are fetched and categorized in parallel; one bad URL doesn't abort the batch.

### Delta (re-review reload)

```bash
pnpm delta <pr-url> <baseline-sha> <head-sha>
```

Generates the **delta core** — "what changed since the baseline" — for a reviewer returning to a PR. It fetches the incremental diff via the GitHub compare API (`baseline...head`, three-dot/merge-base semantics — exact for normal follow-ups; the rebase-robust two-dot needs a local clone, a known limitation), then runs the delta categorizer. Writes `out/<owner>-<repo>-<num>-<base8>..<head8>.delta.json` plus a per-file `.delta.diffs.json` sidecar (same split-by-file shape as the brief's `diffs.json`, for rendering the delta's diffs).

Each delta chunk belongs to exactly one change-group (a file appears in multiple groups only via different chunks), so no line is shown to the reviewer twice.

This is the delta **core** only — the per-reviewer **carry-over overlay** (reopened/settled flags, moved/orphaned comments) needs reviewer state and is out of scope for the stateless CLI (see ADRs 0006–0008). SHAs must be hex commit-ishes (7–40 chars).

### Output

- **File:** the full brief as pretty JSON in `out/` (gitignored).
- **stdout summary:** the PR story, each change group (`[dominant-category] (+secondary) summary`, with an `⚠ uncertain: A vs B` marker when the model is genuinely unsure), the per-concern LoC rollup, and the chunks carrying risk-surface flags.

## The brief

| Field | Meaning |
|---|---|
| `pr` | repo, number, title, url, sha (sourced from our own fetch, never the model) |
| `summary` | plain-English what-the-PR-does |
| `changeGroups[]` | one *summary* + one *dominant category* each; `secondaryCategories`, honest `uncertain` / `uncertainBetween`, and carrier/supporting chunk ids |
| `chunks[]` | `file`, `concern` (implementation/test/doc/spec/config/generated), `role` (carrier/supporting), git `loc {added,deleted}`, `addedRanges`/`removedRanges` (changed-line ranges by side, for diff rendering), and `riskSurface[]` |
| `concernView[]` | LoC rollup per concern |

### Known approximations (flagged, not hidden)

- **Adjusted LoC ≈ git LoC.** Reliable move detection is out of scope; the model reports git added/deleted and notes likely relocations in the group summary rather than netting out moved lines.
- **No automated gold scorer.** Validation here is a manual N=1 eyeball of the medusa #15605 output vs `docs/mvp/briefs/medusa-15605.md`. Automated scoring is later work.

## Development

```bash
pnpm typecheck   # tsc --noEmit (strict)
pnpm test        # vitest run
```

Tests cover the pure logic: PR-URL parsing edge cases (`src/github.ts`), output filename + summary rendering (`src/output.ts`), and brief-schema vocabulary enforcement (`src/types.ts`). The network/LLM paths are exercised by the manual gold check.

### Files

| File | Purpose |
|---|---|
| `src/types.ts` | Zod brief + delta schemas — the closed vocabulary, the heart |
| `src/github.ts` | parse PR URL → `gh pr diff` / `gh pr view` / `gh api …/compare` (no shell; validated) |
| `src/prompt.ts` | brief + delta system prompts, assembled from the schema constants so they can't drift |
| `src/categorize.ts` | shared streaming helper → `categorize()` (brief) + `categorizeDelta()` (delta core) |
| `src/output.ts` | output filenames + stdout summary rendering (brief + delta) |
| `src/index.ts` | brief CLI: args → fetch → categorize → write JSON + print summary |
| `src/delta-cli.ts` | delta CLI: url + base/head SHAs → compare diff → categorizeDelta → write JSON |
