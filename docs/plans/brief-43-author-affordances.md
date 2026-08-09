# BRIEF-43 — Author-State Affordances (Implementation Plan)

Ticket: BRIEF-43 (Now / In progress). Contract: ADR 0031 (locked, not re-litigated).
Build decisions: the 2026-07-14 grill outcome recorded on the ticket — Q1–Q7 are settled;
this plan turns the locked 4-PR spine into execution.

Related spawned tickets (NOT in this plan's scope): "Draft generation policy" chore
(debounce + knob), "Intent check" feature (generation-side).

## Locked decisions this plan builds to (summary — full text on the ticket)

- Trigger state server-derived: PR row gains `draft` + `author_login`; `PrView` gains
  `draft` + `viewerIsAuthor` (server compares `session.reviewerLogin` vs row). FE never
  sees logins. **Gate: audit that pr-view has no shared-across-viewers cache.**
- Header chip **"Self-review — your draft"** + tooltip; never "mode" vocabulary.
  Mark-ready CTA takes the submit button's slot. Non-dismissible.
- Own-draft state: submit/receipt hidden; flags read-only; chunk tracking available;
  comment drafting available; **per-comment post-now** (inline only, viewer token).
- Soft gate (PreSubmitModal shape): all current-head flags + "N unposted draft comments"
  reminder; zero flags → skip modal; "Mark ready anyway" records nothing.
- Mark-ready: GraphQL `markPullRequestReadyForReview`, viewer token, POST route flips
  row `draft=false` in-request; already-ready race = converged; failure = toast + stay.
- Post-ready: affordances vanish via pr-view invalidation/poll.

## Git workflow (git-eng — mandatory for all git operations)

- **Stacked branches** off `main`:
  `feature/BRIEF-43/state-plumbing` → `feature/BRIEF-43/mark-ready-op` →
  `feature/BRIEF-43/own-draft-fe` ; `feature/BRIEF-43/comment-post-now` bases on
  the state-plumbing branch.
- Squash-merge stack discipline per memory: after each merge, `rebase --onto` the
  remaining branches; never plain-pull a just-rebased branch.
- **Chunked commits** (user-confirmed): logical units per PR (e.g. migration / webhook
  write / route / FE component / tests).
- **Pre-commit gate (user-confirmed): `security-reviewer`** on the staged diff before
  every commit. Findings with confidence ≥ 80 → fix, re-stage, re-run until clean.
  (Highest-value on PRs 2 and 4 — token-wielding write routes — but runs on all.)
- No `Co-Authored-By` trailers; no AI-attribution in commits or PR bodies.
- PR titles: `[BRIEF-43] feat: <Part> In Title Case`; standard Overview/Changelog body.
  PRs go up ready-for-review after the review loop passes; **Idan merges**.

## Specialist skills (user-confirmed, mandatory)

- **typescript-eng** — repo TS conventions (extensionless imports, no enum, Result for
  expected failures, named exports).
- **tdd** — test-first for route logic, webhook write, and FE state derivation.
- **verify** — end-to-end runtime verification (webhook → row → PrView → FE state;
  mark-ready round-trip) instead of trusting unit tests alone.

## Review loop (user-directed, replaces the codex loop — quota depleted)

Every PR, before it goes up and after any substantive change:

1. Implementer finishes the part; lint + suites green by exit code (per-branch lint;
   CI is path-filtered, so run dependent-package suites locally when contracts move —
   PR 1 touches `packages/github`/`api` contracts consumed by `apps/web`).
2. Dispatch a **Fable-medium reviewer subagent** on the branch diff vs its base:
   adversarial review, contract-compliance against the ticket's locked decisions,
   plus the PR-specific focus lines below.
3. Address every finding (fix or explicit justified-reject recorded in the PR body),
   then re-dispatch. **Loop until a round returns zero findings.** Fresh reviewer
   agent each round — do not reuse the prior round's agent to grade its own fixes.

## Part / PR breakdown

Measure `git diff --stat` after every part (LOC ceilings are hard gates; split triggers
acted on, not noted).

### PR 1 — State plumbing (backend) · ~300 LOC · **Opus, medium effort**, subagent

- Drizzle migration: `draft boolean not null default false`, `author_login text` on the
  PR row; webhook write populates both (`pull_request.draft` already parsed; add
  `pull_request.user.login` to the event parse in `packages/github/src/webhook/events.ts`).
- `PrView` (packages/api/src/routes/pr-view.ts) gains `draft` + `viewerIsAuthor`
  (computed per request from `session.reviewerLogin`).
- **Cache audit**: verify pr-view has no shared-across-viewers cache; if one exists,
  session-key it or move the derived boolean out of the cached shape.
- Reviewer focus: migration reversibility; webhook events that must NOT touch the new
  columns; `viewerIsAuthor` never true for signed-out/token-less reads.

### PR 2 — Mark-ready operation (backend) · ~300 LOC · **Opus, medium effort**, subagent, after PR 1

- `markPullRequestReadyForReview` GraphQL op in `packages/github/src/operations/`
  (viewer token; node-id resolution as the conversation ops do).
- Session-authed POST route: mutation → on success flip row `draft=false` in-request;
  already-ready GitHub error → converged (200, state refreshed); other failures →
  typed error for the FE toast. Audit-log line per ADR 0016 boundary conventions.
- Reviewer focus: race semantics, token handling (no secrets in errors), idempotency
  vs the later `ready_for_review` webhook.

### PR 3 — Own-draft FE state · ~500 LOC (watch the gate; split FE-state/modal if breached) · **Fable, medium effort**, subagent, after PR 2

- State derivation from PrView (`draft && viewerIsAuthor`); chip + tooltip in Header;
  submit/receipt machinery hidden; flag disposition controls read-only; CTA slot swap.
- Soft-gate modal reusing PreSubmitModal's shape: current-head flag list, unposted-drafts
  reminder line (jump link), "Mark ready anyway"; zero-flag bypass.
- Post-ready transition: mutation success → invalidate pr-view; ready-elsewhere flips
  propagate via existing polling.
- Reviewer focus: no vocabulary drift ("mode"), hidden-not-broken (nothing dangling that
  references submit), reduced-motion + focus management on the modal, state flicker on
  the mutation path.

### PR 4 — Comment post-now · ~400 LOC · **Opus, medium effort**, subagent, after PR 1 (parallelizable with 2/3 — but it shares composer/BriefPage surface with PR 3; run it after PR 3 unless the diff areas prove disjoint at start time)

- Standalone inline-comment write route (viewer token; anchoring from the composer's
  existing chunk-region data; commit_id pinning per BRIEF-23 conventions).
- Composer "Post" affordance gated to own-draft state; posted comment renders as a
  conversation thread ("yours" tag) — draft cleared on confirmed post.
- Reviewer focus: reviewer-state must be completely unaffected (private-until-submit,
  ADR 0004); anchor validity on stale heads; double-post protection.

## Verification (beyond per-PR suites)

- `verify` skill end-to-end after PR 3: seeded session as PR author on a draft →
  own-draft state renders; mark-ready round-trip flips to reviewer view; non-author
  session on the same PR sees plain reviewer view throughout.
- After PR 4: post-now → thread appears in conversation section with "yours" tag;
  reviewer-state composer unchanged.
- Webhook loop per `docs/dev/webhook-loop.md` for the `ready_for_review` idempotency
  check (route already flipped the row; webhook must no-op cleanly + trigger regen).

## Orchestration

Main session (this one) orchestrates: passes locked-decision context to each implementer
subagent, manages the stack (git-eng), runs the review loops, reports each PR to Idan for
merge. Sequential 1 → 2 → 3 → 4 unless PR 4's start-time diff-area check clears parallel.
