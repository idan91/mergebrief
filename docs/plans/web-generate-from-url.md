# Plan — Web "Generate Brief from URL" (local loop)

> Status: **approved, ready to implement.** Branch: `feature/web-generate-from-url` (off `main`). Created 2026-06-22.
>
> Purpose: add a second front door to the proven categorizer engine — paste a public PR URL into the web app and get a rendered brief — so briefing any PR is two clicks instead of a terminal round-trip. This closes the dogfood loop and is the first, un-hosted slice of the eventual OSS-BYOK / hosted "zero-install" path. Grilled via `grill-with-docs` (see Decisions).

## What this is (and is not)

One **engine** (the categorizer pipeline), reachable through multiple **front doors** and runnable in multiple **deployment contexts**:

- Front doors: the **CLI** (`pnpm categorize <url>`, exists) and a new **web "paste URL" box** (this plan). Same pipeline, same `out/` artifacts.
- Deployment contexts: **local** (this plan — your machine, your `gh`, your key) → **OSS-BYOK** (others self-host, their key) → **hosted** (you deploy). Later contexts reuse this exact code.

This plan builds the **local** context only. It must not *block* the lift to the others, but it does not build them.

## Decisions (locked with the user)

- **Scope = local loop, build-in-private.** No peer exposure, no hosting, no BYOK-in-browser, no rate-limiting yet — but the design must lift cleanly to all of those. (Defers the peer-usage kill-criterion deliberately — "not yet," not abandoned.)
- **Brief generation only.** No delta-generation UI. The web app already *renders* deltas (timeline, ADR 0019) and the CLI already *generates* them (`pnpm delta`); web delta-gen is a deliberate timeline-driven follow-up, not a 3-SHA form.
- **Minimal-reuse, not hosting-seams.** The engine stays local-wired: `gh` CLI for GitHub, `ANTHROPIC_API_KEY` from env, artifacts written to `out/`. The web server function *imports* the categorizer's functions (workspace member) — it does **not** shell out to the CLI, and it does **not** pre-build GitHub-source / artifact-sink ports. Those ports are M1's job (ADR 0016 GitHub App, ADR 0018 persistence) and are ungrilled; building them now would front-run M1.
- **Synchronous + in-process single-flight.** The "Generate" click waits (loading state) for a single round-trip, then redirects to the rendered brief. A second concurrent request for the same PR-head attaches to the in-flight promise instead of paying for a duplicate run. The async-worker + Postgres-advisory-lock + polling model is **already decided for M1** (ADR 0006 #6, ADR 0015) — this is its degenerate single-user form, which lifts into it.
- **Dedupe by head SHA.** Before any model call, do the cheap `gh pr view` for the head SHA; if `out/` already holds a brief at that head, open it (no paid call). Regenerate only on a new head. (Content-keyed idempotency, ADR 0006 #6.)
- **No new ADR.** This implements ADR 0006's model in single-user form and reuses the ADR 0013 Generator port; nothing here is hard-to-reverse or surprising enough to warrant one.

## Scope

**In:** URL input on the picker route; a server function that fetches + categorizes + writes the same `out/` artifacts the CLI writes; dedupe-by-head; in-process single-flight; loading + error UX; redirect to the rendered brief; the small refactor to make the categorizer's write-path importable and out-dir-explicit; tests.

**Out:** delta-generation UI; hosting / deploy target; public GitHub REST access (stays `gh`); BYOK-in-browser; rate-limiting / abuse controls; the async worker, Postgres advisory lock, and client polling (all M1).

## Architecture

```
apps/web (picker route)
  └─ URL box ──► generateBriefFromUrl(url)  [server fn, server-only]
                    │ validate URL (parsePrUrl)
                    │ gh pr view → head SHA              ← cheap
                    │ if out/ has brief @head → return briefId   (dedupe)
                    │ else single-flight(stem@head):
                    │     fetchPr → categorize → generateAndWrite(OUT_DIR,…)
                    └─ return briefId
                                │
   redirect ──► /briefs/$briefId  (existing renderer, unchanged)

tools/categorizer (engine, reused)
  exports: parsePrUrl, fetchPrMetadata, fetchPr, categorize,
           AnthropicGenerator, splitDiffByFile, assignBriefIndex,
           output naming, + new generateAndWrite(outDir, …)
```

### Files

| File | Change |
|---|---|
| `tools/categorizer/package.json` | add an `exports` map (or `"main"`) exposing the reuse surface |
| `tools/categorizer/src/lib.ts` (new) | barrel re-exporting the public functions; the package entry point |
| `tools/categorizer/src/index.ts` | extract the `runOne` fetch→categorize→write body into an exported `generateAndWrite(outDir, url, range, generator, log)`; CLI calls it with `outDir="out"`. Removes the hard-coded relative `OUT_DIR` from the write path so the web caller can pass the resolved `tools/categorizer/out`. |
| `apps/web/src/features/brief/generate.server.ts` (new) | `generateBriefFromUrl(url)` server fn: validate → head SHA → dedupe → single-flight → `generateAndWrite` → return `briefId`. Server-only. Reads `ANTHROPIC_API_KEY` from the web app's env. |
| `apps/web/src/features/brief/generate.test.ts` (new) | URL validation, dedupe-by-head, single-flight collapsing, briefId derivation |
| `apps/web/src/features/brief/singleFlight.ts` (new) | tiny `Map<key, Promise>` guard (its own unit, independently testable) |
| `apps/web/src/routes/index.tsx` | add the URL input + Generate + loading/error states; on success `router.navigate` to `/briefs/$briefId` |

`brief.server.ts` is unchanged — the generated artifacts are read by the existing path. `OUT_DIR` resolution (`../../tools/categorizer/out`) is the shared contract between writer and reader; the writer must target that same resolved path.

## Flow detail

1. **Validate** the pasted URL with the existing `parsePrUrl` (already strict — rejects non-GitHub-PR URLs, keeps untrusted input out of `gh` args).
2. **Head SHA** via `fetchPrMetadata` (cheap `gh pr view`). Derive `stem = prStem(owner/repo, number)`.
3. **Dedupe:** compute the would-be `briefId` for `(stem, head)`; if its `.brief.json` exists in `out/`, return it — no model call.
4. **Single-flight:** key on `stem@head`. If a generation is in flight for that key, await the same promise. Otherwise start one.
5. **Generate:** `generateAndWrite` runs `fetchPr → categorize → write brief/diffs/comments`. Returns the `briefId`.
6. **Render:** the route redirects to `/briefs/$briefId`; existing renderer takes over.

### Error states (surfaced inline, not thrown to a blank page)

- Not a GitHub PR URL → validation message.
- `gh` failure: not authenticated / private repo / 404 → "couldn't fetch this PR (is it public, and are you `gh auth login`'d?)".
- `ANTHROPIC_API_KEY` missing in the web env → explicit setup message.
- Model / generation failure → error with the message, URL preserved so the user can retry.

## Testing (TDD where it pays)

Pure logic gets tests first: `parsePrUrl` reuse, `briefId` derivation, dedupe decision (exists → reuse / absent → generate), and the single-flight guard (two concurrent calls for one key → one underlying run, both resolve). The model call itself is not unit-tested (it's the engine's concern, already covered in `tools/categorizer/test`); the server fn is tested with the engine boundary faked.
Follow red-green-refctor method.

## How it lifts to M1 ("geared towards all of these")

The synchronous server function is the liftable unit. At M1 (ADR 0015/0018), with internals swapped, not rewritten:

| Step-2 (local) | M1 (hosted/OSS) |
|---|---|
| synchronous server fn body | `graphile-worker` task body |
| in-process `Map` single-flight | Postgres advisory lock (ADR 0006 #6) |
| `out/` file dedupe-by-head | content-keyed DB read (ADR 0018) |
| `gh` CLI | GitHub App REST + token (ADR 0016) |
| env `ANTHROPIC_API_KEY` | BYOK key per-request (ADR 0013/0016) |
| loading-state wait | client polling on head SHA (ADR 0006 #4/#7) |

## Git workflow (git-eng — injected requirements)

- **Branch:** `feature/web-generate-from-url`, off `main`.
- **Commits:** **chunked** — one per logical unit. Authorship rules: **no `Co-Authored-By` trailers, no AI-attribution** in commits or the PR body.
- **Pre-commit review gate (every commit):** dispatch **`security-reviewer`** and **`performance-reviewer`** in parallel on the staged diff (`git diff --cached`). Any finding with confidence ≥ 80 → present, fix, re-stage, re-run both until clean. Only then commit. (The server fn runs `gh` + a model call on user-pasted input — the security pass is load-bearing, not ceremonial.) **`plan-alignment`** should run automatically as well.
- **Suggested commit chunks:**
  1. `refactor(categorizer): extract generateAndWrite + package exports`
  2. `feat(web): single-flight guard` (+ tests)
  3. `feat(web): generateBriefFromUrl server fn` (+ tests, dedupe)
  4. `feat(web): URL input + loading/error on picker route`
- **Push / PR:** Submit a PR automatically at the end accordig to the git-eng guideliens

## Out of scope / fast-follows

- Delta-generation in the web app — timeline-driven (pick two points → generate the span), ADR 0019.
- Diff-first wait UX (show raw diff while the brief generates, ADR 0006 #10).
- Everything in the M1 lift table above.
