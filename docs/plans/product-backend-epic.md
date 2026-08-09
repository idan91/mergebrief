# Plan — Product Backend Epic

The stateless categorizer (`tools/categorizer/`) is proven. Everything that makes it a *product* — per-reviewer delta, persistence, automatic triggering — needs a backend. This is the epic. It is **not a single task**, and several pieces are blocked on decisions that aren't made yet. This doc sequences the work and names the blocking decisions; it is deliberately not code.

Grounded in: ADR 0006 (delta generation/state), 0007 (carry-over/anchoring), 0008 (persistence/fetching), 0010 (triage), 0013 (provider-agnostic generation + YAML config), 0014 (external-context boundary). Read those for the *decisions*; this is the *build order*.

> **Update (2026-06):** the gating decisions below are now **resolved** — see `docs/system-overview.md` and ADRs **0015** (runtime + Postgres single dependency), **0016** (GitHub App + auth + trust/tenancy), **0017** (OSS self-host-first distribution). Milestones reframed accordingly: **self-host is M1**, and **BYOK is the default**, not a deferred slice.

## Gating decisions — RESOLVED (2026-06)

The four forks are decided (see `docs/system-overview.md` + ADRs 0015–0017); none block the workstreams any longer. A fifth, foundational decision — **distribution** — was added and resolved.

0. **Distribution (new, foundational).** OSS **self-host first**, open-core; one core / three modes (static demo · self-host · deferred hosted). → **ADR 0017**.
1. **Datastore.** Vanilla Postgres as the **single stateful dependency** (data + `graphile-worker` queue + advisory lock); no broker, no swappable DB. → **ADR 0015**.
2. **Runtime / hosting.** **Long-lived worker** (not serverless — the minutes-long generation can't fit a 60 s function); the web tier stays serverless-compatible. → **ADR 0015**.
3. **GitHub App.** Per-instance App; least-privilege `Contents:read`, `Pull requests:write`, `Metadata:read`; events `pull_request`, `pull_request_review`, `installation*`; activation = one branded comment (delete+repost). → **ADR 0016**.
4. **Secret/BYOK storage.** All static secrets in env/secret-manager by name (never DB/repo); reviewer token envelope-encrypted; **BYOK is the default**. → **ADR 0013/0016**.

## Workstreams, in dependency order

1. **Persistence layer (ADR 0008; physical schema ADR 0018).** Schema: Brief keyed by the `(base, head)` span; Delta by `(baseline, head)` SHA-pair; per-reviewer Checkpoint; configurable baseline snapshot (survives force-push/GC). Brief-as-index + per-file lazy diff fetch; `(installation_id, repo)` tenant scoping; cascade deletion boundary + append-only audit log; `generation` status projection for the wait UX. → unblocks everything.
2. **GitHub App + webhooks + polling (ADR 0006).** Events: `push`/`synchronize` → brief; `ready_for_review` → author self-review warm; `review_requested` → delta warm. Client polls latest head SHA (~30–60s) for mid-review follow-ups (no SSE). **Trigger = eager-on-push, debounced (no lazy first-click gate); the deep-link click is Entry (navigation), not a compute trigger; the reviewer Entry comment posts only on ready state. → ADR 0020** (supersedes the earlier "Activation = first deep-link click").
3. **Background worker (ADR 0006).** Debounced (~60s trailing) trigger → single-flight lock → fetch PR data → call the **existing stateless `Generator`** → write content-keyed artifact. Cancellation on superseded head; never abort a generation a human is awaiting. The categorizer is reused as-is — this wraps it, doesn't rewrite it.
4. **Triage cascade (ADR 0010).** Deterministic floor (dep/migration/auth-config paths + size) → Haiku trivial-vs-escalate → Opus full brief/delta. Risk decides escalation, size decides spend; touching a reviewer's prior flag/comment is itself an escalation. Emits Fast-lane for trivial. Uses the `Generator` port's per-call `model`/`effort` (already in place from ADR 0013/step C).
5. **Per-reviewer carry-over overlay (ADR 0007).** Checkpoint advance on submit; flag carry-over (New/Reopened/Settled/Dropped, bias-to-reopen, positional); comment anchoring (GitHub-native for shipped comments, our line-map for flags/drafts). This is the per-reviewer layer on top of the shared delta core the CLI already produces.
6. **Config loader + BYOK (ADR 0013).** Per-repo YAML (`generator:` block + debounce/size/triggers), Zod-validated; org defaults + per-repo override; keys resolved by env-name. Wire additional `Generator` adapters (OpenRouter / AI-SDK) behind the port — the interface already exists.
7. **ContextSource interface (ADR 0014) — deferred.** Cited-only enrichment of Intent check / Risk Surface; the headless dual-consumer lane (org's agent reviews using our Brief). Post core-validation; not part of the first backend cut.

## Suggested milestones

- **M1 — "warm artifacts" (self-hosted)**: workstreams 1–3. A **self-hostable** GitHub App that, on push, generates and persists a Brief (and a delta core when a reviewer returns), served to an **auth-gated** read-only view — plus the **static demo** funnel. No triage, no carry-over. **BYOK default** (single adapter, adopter's key). The smallest thing that makes the tool live.
- **M2 — "cheap + per-reviewer"**: workstreams 4 (triage) + 5 (carry-over overlay). The delta becomes per-reviewer and most PRs get the cheap Fast-lane.
- **M3 — "open"**: workstream 6 (YAML config + **additional** provider adapters) **+ the hosted open-core arm**. The "keys/code never leave the org" trust story is already delivered by self-host in M1; M3 adds provider breadth and the optional hosted multi-tenant offering (on ADR 0016's tenancy/audit boundaries).
- **Later**: workstream 7.

## What stays out of scope here

Everything is reuse of the stateless core via the `Generator` port — this epic adds state, triggering, and per-reviewer overlays around it, and must not fork the categorizer's analysis logic. The no-verdict / no-bug-bot invariants (ADR 0003/0014) hold throughout.
