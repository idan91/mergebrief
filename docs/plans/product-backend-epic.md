# Plan — Product Backend Epic

The stateless categorizer (`tools/categorizer/`) is proven. Everything that makes it a *product* — per-reviewer delta, persistence, automatic triggering — needs a backend. This is the epic. It is **not a single task**, and several pieces are blocked on decisions that aren't made yet. This doc sequences the work and names the blocking decisions; it is deliberately not code.

Grounded in: ADR 0006 (delta generation/state), 0007 (carry-over/anchoring), 0008 (persistence/fetching), 0010 (triage), 0013 (provider-agnostic generation + YAML config), 0014 (external-context boundary). Read those for the *decisions*; this is the *build order*.

## Hard prerequisite decisions (block all code below)

These are genuine forks with no default — decide before building, don't let the first PR pick them by accident:

1. **Datastore.** A single relational DB (ADR 0008). Which one (Postgres vs hosted equivalent) + where it runs. The repo memory notes the stack is not finalized — this is the gating decision.
2. **Runtime / hosting.** Serverless (keeps the polling-not-SSE choice of ADR 0006 cheap) vs a long-lived worker. ADR 0006 deliberately chose polling to keep the serverless option open — honor or revisit.
3. **GitHub App** registration + **least-privilege** permission set (the deferred GPT-5.5 review item #6). Exactly which scopes (contents:read, pull_requests:read/write for the signature-line comment, checks?) and which webhook events.
4. **Secret/BYOK key storage** — where per-org provider keys live (env/secret-manager), referenced by name from the per-repo YAML (ADR 0013). Never in the DB as plaintext, never in the repo YAML.

Until 1–3 are decided, the workstreams below cannot start; #4 only gates the BYOK slice.

## Workstreams, in dependency order

1. **Persistence layer (ADR 0008).** Schema: Brief keyed by head SHA; Delta keyed by `(baseline, head)` SHA-pair; per-reviewer Checkpoint; baseline tree/diff snapshot (survives force-push/GC). Brief-as-index + per-file lazy diff fetch; retention policy. → unblocks everything.
2. **GitHub App + webhooks + polling (ADR 0006).** Events: `push`/`synchronize` → brief; `ready_for_review` → author self-review warm; `review_requested` → delta warm. Client polls latest head SHA (~30–60s) for mid-review follow-ups (no SSE). Activation = first deep-link click.
3. **Background worker (ADR 0006).** Debounced (~60s trailing) trigger → single-flight lock → fetch PR data → call the **existing stateless `Generator`** → write content-keyed artifact. Cancellation on superseded head; never abort a generation a human is awaiting. The categorizer is reused as-is — this wraps it, doesn't rewrite it.
4. **Triage cascade (ADR 0010).** Deterministic floor (dep/migration/auth-config paths + size) → Haiku trivial-vs-escalate → Opus full brief/delta. Risk decides escalation, size decides spend; touching a reviewer's prior flag/comment is itself an escalation. Emits Fast-lane for trivial. Uses the `Generator` port's per-call `model`/`effort` (already in place from ADR 0013/step C).
5. **Per-reviewer carry-over overlay (ADR 0007).** Checkpoint advance on submit; flag carry-over (New/Reopened/Settled/Dropped, bias-to-reopen, positional); comment anchoring (GitHub-native for shipped comments, our line-map for flags/drafts). This is the per-reviewer layer on top of the shared delta core the CLI already produces.
6. **Config loader + BYOK (ADR 0013).** Per-repo YAML (`generator:` block + debounce/size/triggers), Zod-validated; org defaults + per-repo override; keys resolved by env-name. Wire additional `Generator` adapters (OpenRouter / AI-SDK) behind the port — the seam already exists.
7. **ContextSource seam (ADR 0014) — deferred.** Cited-only enrichment of Intent check / Risk Surface; the headless dual-consumer lane (org's agent reviews using our Brief). Post core-validation; not part of the first backend cut.

## Suggested milestones

- **M1 — "warm artifacts"**: decisions 1–3 + workstreams 1–3. A GitHub App that, on push, generates and persists a Brief (and a delta core when a reviewer returns), served to a read-only view. No triage, no carry-over, single provider. This is the smallest thing that makes the tool live.
- **M2 — "cheap + per-reviewer"**: workstreams 4 (triage) + 5 (carry-over overlay). The delta becomes per-reviewer and most PRs get the cheap Fast-lane.
- **M3 — "open"**: workstream 6 (YAML config + BYOK adapters). Enterprise trust story (keys never leave the org).
- **Later**: workstream 7.

## What stays out of scope here

Everything is reuse of the stateless core via the `Generator` port — this epic adds state, triggering, and per-reviewer overlays around it, and must not fork the categorizer's analysis logic. The no-verdict / no-bug-bot invariants (ADR 0003/0014) hold throughout.
