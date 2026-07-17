# Plan — BRIEF-64: Draft generation policy (draft-aware debounce + instance `drafts` block)

> Status: **LOCKED — grill closed 2026-07-17, not started.**
> Ticket: Notion BRIEF-64 (formerly numbered BRIEF-53 — Notion auto-increment).
> ADRs: **0020 amendment** (instance config read by api as well as worker;
> `drafts:` reshaped from scalar to block). No new ADR.
> Grounding: BRIEF-43 grill (spawned this ticket), ADR 0032 (naming resolution),
> ADR 0006 #6 (supersession abort), repo-config stack #109–#115 (merged;
> `entryCommentOnDrafts` precedent).

## Goal

Spend defense for draft-PR generation, opt-in and UX-first: an instance
`drafts` config block controlling whether drafts generate at all and how hard
WIP push-storms are damped — without darkening the BRIEF-43 author surface or
adding any GitHub-comment noise.

## Locked decisions (grill 2026-07-17)

1. **Plumbing — enqueue-side enforcement (api).** Instance config gains a
   top-level `drafts` block. The api composition root reads
   `MERGEBRIEF_CONFIG` via a NEW narrow loader (`loadInstancePolicy` or
   similar) that parses ONLY the `drafts` key — it must NOT validate the
   generator block nor require provider keys in the api process. Policy is
   injected into `WebhookRouteDeps`. `MERGEBRIEF_CONFIG` unset → defaults
   (same idiom as the generator zero-config path).
2. **Knob shape** (reshaped from ADR 0020's scalar `drafts: on|off`):

   ```yaml
   drafts:
     generate: on            # on | off, default on
     # debounceSeconds: 900  # optional; unset = drafts use the normal 60s window
   ```

   - `generate: off` → drafts never enqueue; brief arrives on ready.
   - `debounceSeconds` unset → **no draft damping** (off by default — Idan
     decision, UX over default spend defense; reverses the ticket's original
     default-on intent, recorded deliberately).
   - Both loaders must learn the key: the generators/worker loader refuses
     unknown root keys, so a yaml containing `drafts` must not refuse boot.
3. **First generation is always fast.** Even with damping configured, a PR
   with no generation projection row yet enqueues with the NORMAL window —
   the author surface gets its first brief quickly; only REgenerations damp.
   (Known edge, accepted: pushes landing before the first generation runs
   also see the normal window; converges once the first brief lands.)
4. **No GitHub comment about the wait** — preserves the one-bot-comment
   footprint and the entry-comment draft gate (ADR 0020 #4 as amended).
   The wait is surfaced in the web own-draft view instead (decision 6).
5. **`generate: off` semantics:**
   - Draft `pull_request` trigger events → `recordState` only (mirror the
     existing `CONVERTED_TO_DRAFT` path): PR row stays current, no enqueue.
   - Review submitted on a KNOWN draft PR → skip enqueue (check
     `known.draft`; review events omit `draft`).
   - `ready_for_review` carries `draft: false` and full PR data → first
     generation happens through the normal trigger path. No special-casing.
   - Precedence over repo `entryCommentOnDrafts: true` is automatic (no
     generation → no worker run → no entry comment); DOCUMENT the
     interaction, no logic.
   - Read paths unaffected (verified): `pr-view` supports
     `generation: null`, conversation display is live GitHub reads.
6. **FE visibility (narrow slice of backlog BRIEF-62).** `pr-view` response
   gains `draftPolicy: { generate: boolean, debounceSeconds: number | null }`
   (api holds the config per decision 1; rides the existing poll — no new
   endpoint). FE own-draft view renders:
   - draft + `generate: off` → "brief generation for drafts is disabled on
     this instance";
   - draft + damping configured → refresh-window copy using the REAL
     configured duration (never hardcoded minutes).
7. **Ready-flip semantics.** `ready_for_review` ALWAYS enqueues with a short
   constant window `READY_FLIP_DEBOUNCE_SECONDS = 10` (constant, not a
   knob) — cancels any pending draft-damped job via job-key replacement.
   Rationale: author is actively watching after mark-ready; supersession
   abort (ADR 0006 #6) is the safety net for pushes landing after the 10s.
   Window-selection rule (one small function at the enqueue path):
   - `ready_for_review` → 10s;
   - draft trigger + damping configured + a generation already exists →
     `drafts.debounceSeconds`;
   - everything else → default 60s (no override passed).
8. **Example yaml + docs.** `mergebrief.config.example.yaml` gains the
   `drafts` block (commented `debounceSeconds`), header updated to
   "worker + web/api", zero-config sentence extended ("draft PRs generate
   with the normal debounce"). `docs/self-host/` config docs +
   `repo-config.md` (the BRIEF-64 forward-reference section) updated;
   document the `generate: off` × `entryCommentOnDrafts` precedence.

## Revisit triggers

- Adopter asks for damping-by-default or a per-repo draft policy → revisit
  decision 2 (record: default-off was a UX call, 2026-07-17).
- Storm-before-first-generation shows up in real spend → revisit decision 3's
  accepted edge.
- BRIEF-62 (instance settings UI) builds → fold `draftPolicy` exposure into
  its general surface; pr-view field remains the compatibility path.

## Git requirements (git-eng — mandatory for ALL git operations)

- Branch: `feature/BRIEF-64/draft-policy` off up-to-date `main` (PR 2 stacks
  on PR 1's branch: `feature/BRIEF-64/draft-policy-fe`).
- **Chunked commits** after each logical unit.
- **Pre-commit gate on every commit:** `performance-reviewer` +
  `security-reviewer` in parallel on staged changes; findings ≥80 confidence
  → fix, re-stage, re-run until clean.
- **No `Co-Authored-By` trailers; no AI-attribution in PR descriptions.**
- Push + **ready** PRs, base `main` (PR 2 based on PR 1 until it merges —
  squash-merge stacks need `rebase --onto` per merge, see memory).
- PR titles: `[BRIEF-64] feat: …` per git-eng format.
- Lint per branch by exit code (never grep-for-error).

## Mandatory skills

- `git-eng` — every git/gh operation.
- `typescript-eng` — all TS work (strict, no enum, Result at boundaries).
- `tdd` — test-first on window selection, loaders, and `generate: off` paths.
- `/verify` — end-to-end webhook→worker runtime pass after PR 1 (suites
  alone don't cover the compose wiring).

## PR breakdown

### PR 1 — Backend: `drafts` block + enqueue-path policy (~600–750 LOC)

`[BRIEF-64] feat: Draft Generation Policy — Instance Drafts Block + Enqueue Windows`

1. **Schema/loaders** (generators + new api-side narrow loader):
   `drafts` block schema (Zod: `generate` on|off default on,
   `debounceSeconds` positive finite optional), wired into the existing
   instance-config loader (worker path) and exported via the narrow
   `loadInstancePolicy` (api path — drafts key only, generator block
   untouched/unvalidated). Tests: defaults, unknown-key posture, bad values,
   api loader ignoring generator errors.
2. **Enqueue path** (`packages/api/src/routes/webhook.ts` + ingest
   pass-through): window-selection function per decision 7; `generate: off`
   guards per decision 5 (draft trigger → `recordState`; review-on-known-
   draft skip); `WebhookRouteDeps` + composition root wiring. Tests extend
   `test/webhook.test.ts` (PGlite harness): each window case asserts the
   enqueued job's `run_at`/debounce, off-mode asserts no job + state
   written, ready-flip asserts job-key replacement.
3. **Docs slice:** example yaml, ADR 0020 amendment, self-host config docs.

Invocation: **main thread, Fable 5, medium effort** — window logic + trust-
boundary route edits are the subtle core; everything else rides along.

### PR 2 — pr-view `draftPolicy` + FE copy (~300–450 LOC)

`[BRIEF-64] feat: Draft Policy Visibility — PR-View Field + Own-Draft Copy`

1. `draftPolicy` on the pr-view response (api already holds policy from
   PR 1); route test.
2. FE: own-draft view copy states per decision 6 (real duration formatting,
   disabled-instance explanation); component tests per apps/web conventions.
3. Docs: `repo-config.md` precedence note if not landed in PR 1.

Invocation: **main thread, sequential after PR 1** (depends on loader +
deps shape), **Fable 5, low/medium effort** — mostly mechanical; FE copy is
product-visible so keep Fable rather than delegating.

Review loop: **Fable-subagent reviewer** (codex too slow; quota out until
2026-07-23 anyway). One pre-merge review round per PR on the branch diff —
PR 1 at **high effort** (trust-boundary route + debounce/supersession
races), PR 2 at **medium**. Findings fixed inline; Idan merges.

## Out of scope (recorded)

- Trigger-comment generation machinery (rejected, BRIEF-43 grill).
- Browser extension over GitHub's Ready button (rejected, ADR 0001).
- Configurable ready-flip window; per-repo draft policy; `on-first-view`
  knob (documented-not-built).
- General spend guardrail/budget cap — BRIEF-20.
