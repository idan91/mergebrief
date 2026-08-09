# BRIEF-20 — Self-host hardening: spend guardrail + exposure hardening

Status: planned 2026-08-03. Decisions: spend-guardrail spec locked in the
2026-08-03 grill (resolution comment on the board ticket — restated below
as binding). Board ticket: BRIEF-20 (In progress). Release-gated under
BRIEF-38.

## Scope

Two PRs:
1. **Spend guardrail** — the daily generation cap, end to end.
2. **Hardening bundle** — postgres credential parameterization, the
   server-function error-leak sweep (folds in the path-disclosure board
   ticket), exposure docs, lifecycle ops docs.

Host-header validation (ticket item 2) is DONE (PR #30). Non-goals stand:
no auth changes, no port re-binding.

## Locked spend-guardrail spec (grill 2026-08-03 — do not relitigate)

- **Unit**: generations per repo per day.
- **Config**: instance file only (`mergebrief.config.yaml`):
  `spend.dailyGenerationCap` (global default) + `spend.perRepo`
  (operator-side overrides, keyed `owner/name`). Unset = uncapped.
  NEVER readable from `.mergebrief/` repo-config.
- **Reset**: calendar day UTC; count via date-truncated `created_at`.
  FE renders reset time viewer-local.
- **At-cap**: skip the generation. Surfaces: (a) FE generation status
  gains a distinct `capped` state (never a fake `failed`) with reset
  time; (b) an EXISTING Entry comment updates via the BRIEF-22
  replace-never-duplicate machinery — no comment is created for a capped
  PR; (c) `evt: spend.cap.trip` at warn on EVERY capped skip, structured
  fields `{ repo, prId, cap, dayUtc }`, nothing interpolated into msg,
  no audit row.
- Per-repo counter; no instance-wide total ceiling in v1.

## Implementation notes (PR 1 — spend guardrail)

- **Enforcement point: the single boundary where a generation run starts in
  the worker** (before any provider call, after the job is claimed) — one
  choke point covers every entry path. Verify at implementation whether
  URL-box/userspace generations flow through the same boundary; if they
  don't, decide-and-document whether they count (lean: they do — same
  bill) and enforce at their boundary too with the same store query.
- **Counting**: query the generation store for runs of that repo in the
  current UTC day. Determine which run states count — lean: any run that
  reached a provider call (superseded runs count, they spent; capped
  skips do NOT create runs, or create them in a `capped` state that is
  excluded from the count — pick whichever the existing state machine
  absorbs more cleanly and record it in the PR body).
- **Config**: extend the instance-config schema (packages where
  `MERGEBRIEF_CONFIG` is parsed — repo-config package owns the parse?
  verify; spend keys are INSTANCE config, keep them out of the
  repo-config surface) with Zod validation: positive integers, unknown
  repo keys tolerated (installation set changes), `perRepo` beats
  default.
- **FE**: `capped` in the generation-status union (server projection +
  FE Disposition rendering); copy per grill ("Daily generation cap
  reached — resumes <local time>"). Check BRIEF-21's lastReview-union
  precedent for how status unions extend.
- **Entry comment**: reuse the existing replace path; add the capped
  variant ONLY on update of an existing comment.
- **Logging**: `spend.cap.trip` joins the ADR 0034 taxonomy table (docs
  edit — the evt name is already reserved there; flip it from reserved
  to live).
- **Tests**: store-count query (UTC boundary cases — 23:59/00:00),
  config parse (default/override/unset), worker gate (cap reached →
  skip + event + no provider call; under cap → proceeds), FE state
  render, comment-update-only-if-exists. Property test NOT required
  (fast-check is BRIEF-115's scope).

## Implementation notes (PR 2 — hardening bundle)

- **Postgres creds**: `${POSTGRES_PASSWORD:-code_review}`-style
  interpolation in `docker-compose.yml` (user, password, db — one value
  each, `DATABASE_URL` overrides derive), `.env.example` entries, loud
  first-boot callout in `docs/self-host/compose.md`.
- **Error-leak sweep**: fix the BriefError ENOENT path disclosure (map to
  a friendly not-found at the server-function boundary; never render raw
  `error.message` from server errors on the local-brief path). Then grep
  ALL `**/*.functions.ts` / `**/*.server.ts` server functions for raw
  error passthrough to the client (the BRIEF-97 cause-leak family) and
  apply the same boundary treatment. Close the path-disclosure board
  ticket with a comment when it lands.
- **Exposure docs** (`docs/self-host/compose.md` §hardening expansion):
  reverse-proxy example (Caddy), TLS, webhook-secret strength, the note
  that webhook HMAC is the only gate on the webhook route.
- **Lifecycle ops docs** (new `docs/self-host/` page per the BRIEF-51
  per-concern pattern): what a version bump means for a running instance
  (drizzle migrations apply at boot — verify and state the actual
  mechanism), Postgres backup/restore (single stateful dependency).

## Git requirements (git-eng — mandatory)

Same contract as BRIEF-110–113: two stacked branches
`chore/BRIEF-20/spend-guardrail` → `chore/BRIEF-20/hardening-bundle`,
chunked commits, performance-reviewer pre-commit (≥80 → fix), no
Co-Authored-By/AI attribution, stop before push; then the approved
PR-ready flow (push, PRs, fable-reviewer loop, CI green, hand to Idan).
PR bodies: eval-presence note if any generation-surface path is touched —
the worker gate sits OUTSIDE `brief-core/src/generation` and adapter
defaults, so expect "skipped — no generation-surface files"; if config
parsing lands in `packages/repo-config/src/**`, the eval-presence check
WILL fire — the justification is that spend keys are instance-side
plumbing with zero effect on brief content; consider placing the spend
schema outside repo-config's `src` if it honestly belongs to instance
config anyway.

## Specialist skills (mandatory)

`typescript-eng`. ADR 0034 for the logging contract; ADR 0032/BRIEF-53
for the instance-vs-repo config boundary.

## Gates

Per branch: `pnpm -r test`, `pnpm lint`, `pnpm -r typecheck`,
`pnpm -C apps/web build` (FE union change is isomorphic — the
import-protection gotcha), e2e suite untouched but runs in CI.

## Out of scope

- Cost summaries/dashboard (v2 Backlog ticket, filed).
- Instance-wide total ceiling (recorded as future knob).
- Auth changes, port re-binding (ticket non-goals).
- BRIEF-36's release pass itself.
