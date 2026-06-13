# Plan — Categorizer Thin Slice

> Status: **approved, awaiting impl trigger** (do not start until the user says go). Branch: `feature/categorizer-thin-slice`. Created 2026-06-13.
>
> Purpose: prove an AI can turn a real PR diff into a usable **brief**, measured against the medusa #15605 hand-labels. This is the dogfoodable thin slice under the useful-tool-first intent — validate the categorizer (the unproven core) by building it, not by running a formal experiment. See `docs/mvp/center-of-gravity.md`.

## Decisions (locked with the user)

- **Auth:** Anthropic **SDK + real API key** (`ANTHROPIC_API_KEY`). No `claude -p` fallback. User will obtain a key from console.anthropic.com.
- **Diff source:** `gh` CLI (`gh pr diff` + `gh pr view --json`). Zero token setup, already authed.
- **Deliverable this round:** **brief JSON only** — emit to file + stdout, eyeball vs hand-labels. Mockup wiring is a fast-follow, not this slice.
- **Commits:** chunked (one per logical unit).
- **Review agents:** **security-reviewer + performance-reviewer** run as a pre-commit gate before every commit (see Commit plan).

## Scope (per center-of-gravity reshape)

Produces **story + concern + risk-surface only**. Explicitly OUT: playbook (demoted to agent-facing/optional), delta/re-review (needs state), mockup wiring, author-side, GitHub App/webhook/draft-first, batching, automated gold scorer.

## Location & stack

- Isolated subfolder: **`tools/categorizer/`** — own `package.json`; does not touch the docs repo or commit the *product* to a stack (respects the gitignore-scope memory — keep root `.gitignore` untouched, use a **local** `tools/categorizer/.gitignore`).
- Node + TypeScript, ESM, run via `tsx`.
- Deps: `@anthropic-ai/sdk`, `zod`; dev: `typescript`, `tsx`, `@types/node`.
- CLI: `npx tsx src/index.ts <pr-url> [<pr-url> …]` → writes `out/<repo>-<num>.brief.json` + prints a summary.

## Files

| File | Purpose |
|---|---|
| `package.json`, `tsconfig.json` | scaffold (strict TS, ESM) |
| `.gitignore` (local), `.env.example` | ignore `node_modules`, `.env`, `out/`; document `ANTHROPIC_API_KEY` |
| `src/types.ts` | **Zod brief schema** — the heart; mirrors the controlled vocabulary |
| `src/github.ts` | parse PR URL → `gh pr diff` + `gh pr view --json title,body,files` |
| `src/prompt.ts` | system prompt built from the taxonomy + concern + risk-surface vocabulary |
| `src/categorize.ts` | `client.messages.parse()` — Opus 4.8, adaptive thinking, prompt-cache the system prompt |
| `src/index.ts` | CLI: args → fetch → categorize → write JSON |

## Brief schema (what the model returns)

Read `docs/mvp/labeling-schema.md` **first** — it is the authoritative closed token list; build the Zod enums from it. Shape:

- `pr`: repo, number, title, url, sha
- `summary`: plain-English what-it-does
- `changeGroups[]`: `summary` (what, not why) · `dominantCategory` (enum) · `secondaryCategories[]` · **`uncertain` + `uncertainBetween[]`** (honest model uncertainty — the new-feature-vs-bugfix tension; "AI never hides uncertainty") · `carrierChunkIds[]` · `supportingChunkIds[]`
- `chunks[]`: `id` · `file` · `concern` (implementation/test/doc/spec/config/generated) · `role` (carrier/supporting) · `loc {added,deleted}` · `riskSurface[]` (the 16 attributes from `risk-surface.md`)
- `concernView`: LoC rollup per concern

Structured-output notes (from the claude-api skill): use `client.messages.parse()` + `zodOutputFormat`; `additionalProperties:false` required; no recursive schemas / no min-max constraints (our schema is fine on all counts).

## Known approximations (flag, don't hide)

- **Adjusted LoC ≈ git LoC.** True adjusted-LoC excludes moved/generated lines; reliable move detection is out of scope. Model reports added/deleted and notes likely moves; we don't claim move-accurate LoC yet.
- **No automated gold scorer.** N=1 calibration = manual eyeball of the medusa output vs `docs/mvp/briefs/medusa-15605.md`: one group? dominant new-feature with bugfix uncertainty flagged? carriers = the 4 impl files, supporting = tests + changeset? `widely-imported`/`cross-service`/`no-tests` flags land? concern split ≈ impl/test/doc. Automated scoring is Phase-2 work.

## Model & cost

Opus 4.8 (`claude-opus-4-8`), adaptive thinking, one `cache_control` on the system prompt. ~$0.10/PR — negligible. Cost-optimize to Sonnet 4.6 / Haiku 4.5 only **after** seeing Opus's quality ceiling against the hand-labels.

## Commit plan (chunked, with pre-commit review gate)

Logical units:
1. `chore: scaffold categorizer TS project`
2. `feat: brief Zod schema from controlled vocabulary`
3. `feat: PR diff + metadata fetch via gh`
4. `feat: system prompt from taxonomy + risk-surface`
5. `feat: categorizer call + CLI output`

**Pre-commit review gate (every commit):** dispatch **security-reviewer** and **performance-reviewer** in parallel on the staged diff (`git diff --cached`). If any finding has confidence ≥ 80, present it, apply the fix, re-stage, and re-run both agents until clean. Only then commit. (git-eng authorship rules: no `Co-Authored-By` trailers, no AI-attribution in commits/PRs.)

## Sequencing (API key not a blocker)

Steps 1–4 need **no** API key — scaffold, schema, fetch, prompt can be built and committed while the user grabs a key. Only step 5 (the categorize call + medusa run) needs `ANTHROPIC_API_KEY` in `tools/categorizer/.env`.

## Gold check (the point of the slice)

After step 5, run on **medusa #15605**, write `out/medusajs-medusa-15605.brief.json`, and manually compare to the hand-labeled brief. The delta = the categorizer's real quality signal and the go/no-go for the wedge's core.

## Fast-follows (after this slice works)

- Wire `mockup/index.html` to render the generated JSON instead of hardcoded data.
- Run on a handful more real PRs (incl. a large multi-group one and a scaffold-heavy one — see synthesis Q4).
- Then: delta brief (needs state), Sonnet/Haiku cost test.
