# System Overview

How the individual architecture decisions compose into one running system. Scoped to **M1** ("what M1 needs and what would be expensive to get wrong" — not speculative scale). The existing ADRs slot **under** this doc; new ADRs are created for the gating decisions as they crystallize. Living document.

Status: **distribution + topology locked**; gating decisions Q2–Q7 in progress (§5).

---

## 1. Distribution model — LOCKED

**Self-host first, fair source.** The same codebase runs in three modes; we do **not** fork.

- **Static demo** — the FE replaying pre-generated briefs (today's `apps/web` reading `tools/categorizer/out/*.json`). No live backend, no LLM calls. Free on Vercel. The zero-friction "see the value" funnel.
- **Self-host** — `docker compose up` (or a Railway/Render blueprint). The adopter runs it in their own infra; **code and model keys never leave them**. `instance = tenant` (one installation per instance) — defers multi-tenancy entirely.
- **Hosted** — *deferred, not forbidden.* Same core + multi-tenancy + central auth + BYOK key handling, built **only after validation** and with legal headroom.

**Rationale (compressed):** no technical moat yet (taxonomy/playbooks reproducible — `CONTEXT.md`); founder constraints make a hosted SaaS the heaviest path — side-project hours are strictly capped, and *hosting* means personally holding other orgs' source code (data-liability) + unbounded LLM cost + oncall against that cap. Validation stage needs **peer reuse, not scale** (kill criterion), so self-host friction is tolerable now. The OSS field's stateless reviewers (PR-Agent, OpenReview) avoid this friction by being stateless — we can't, because the **Delta Brief requires persistent state**, so our friction floor is structurally higher by design.

**Defaults:** **BYOK** (adopter brings + pays the model key). **Gate:** contractual IP clearance before building/publishing.

## 2. Deployment topology — LOCKED

One repo. Three components, one stateful dependency:

```
                ┌──────────────────────────┐
   GitHub  ───► │  web + api  (TanStack)    │  webhook ingress + brief UI + read API
   webhook      │  - serverless-compatible  │
                └──────────┬────────────────┘
                           │ writes job row
                           ▼
                    ┌──────────────┐        ┌───────────────┐
                    │   Postgres   │ ◄────► │    worker     │  long-lived; generation
                    │ data+queue+  │  polls │  (Generator)  │  (minutes-long Opus)
                    │   lock       │        └───────────────┘
                    └──────────────┘
```

- **`packages/core`** = the categorizer + `Generator` port, extracted from `tools/categorizer`, consumed by the worker (and the CLI).
- **One opinionated store: Postgres** — no SQS/Redis/Dynamo/S3, and **no swappable DB** (adopters run the Postgres we ship; the DB is an implementation detail, not a choice). One dependency does **data + queue + lock**: the job queue is **`graphile-worker`** (Postgres-native — *job keys* give debounce/single-flight per `(repo, pr)`, `LISTEN/NOTIFY` gives low-latency wakeups, and enqueue is transactional with our data writes). A broker stays behind a port for a future scale migration we haven't earned. The object-storage boundary stays deferred.
- **Worker is long-lived, not serverless** — Vercel Hobby caps functions at 60s; our generation runs minutes. Vercel is for the static demo only.
- **Web tier is serverless-compatible** — it only does fast DB writes on webhook + read queries; the long work is the worker's.

## 3. End-to-end flow

1. **PR opened / ready** → webhook → web tier writes a (coalesced) job row. The **App posts a branded activation comment** with a deep-link. No model call yet (Activation gate, `CONTEXT.md`).
2. **Reviewer clicks the link** → web app → **GitHub OAuth sign-in** (establishes *who* is reviewing — needed to select their per-reviewer delta).
3. **Worker generates** the Brief (debounced; pre-warmed on subsequent pushes) → writes the content-keyed artifact to Postgres.
4. **Brief is read in the web app** — never posted into the PR thread.
5. **Reviewer submits** → native GitHub review **authored by them** + a one-line **Signature line** → static **Review Summary** (the Receipt).

**PR footprint, total:** one branded bot comment (a link) + one signature line on the human's review. Two identities: the **App** posts the comment (installation token); the **reviewer** posts the review (their OAuth token).

## 4. GitHub integration

- **Per-instance GitHub App** (created via app-manifest; logo uploaded by the adopter on self-host). Branded comment via installation token.
- **Reviewer GitHub OAuth** for identity + to author their own review.
- **Least-privilege (RESOLVED):** `Contents: read` (read diffs — **never write code**), `Pull requests: write`, `Metadata: read`. A PR-conversation comment accepts *either* `issues:write` or `pull_requests:write`; since `pull_requests:write` is already needed for the reviewer's review submission (user-to-server), it **also covers the bot comment** — so **no `Issues` permission**. Events: `pull_request`, `pull_request_review`, `installation`, `installation_repositories`.
- **One tool comment, kept at the bottom:** on each debounced generation the bot **deletes its prior comment and posts a fresh one** (not edit-in-place) — keeps it at the bottom *and* fires a GitHub notification ("re-review ready"); the debounce caps it to one ping per settled head, never per push. Check Run surface deferred.

## 5. Open gating decisions (in progress)

| # | Decision | Current lean |
|---|---|---|
| Q2 | Runtime / worker mechanism | **RESOLVED** — long-lived worker container + `graphile-worker` on Postgres (no external broker, no swappable DB); web tier serverless-compatible. See §2. |
| Q3 | Datastore specifics | **RESOLVED** — vanilla Postgres + Drizzle migrations; M1 retention = retain-during-PR, freeze Receipt at submit; closed PRs are swept past the operator's `PR_RETENTION_DAYS` (unset keeps everything); no baseline snapshot is stored. Sweep is **config-driven** + a **deletion interface** is left for compliance. See [ADR 0015](./adr/0015-self-hosted-runtime-postgres-single-dependency.md); physical schema in [ADR 0018](./adr/0018-m1-postgres-schema.md). |
| Q4 | GitHub App scopes | **RESOLVED** — `Contents:read`, `Pull requests:write`, `Metadata:read` (no Issues — PR:write covers the comment); events `pull_request`, `pull_request_review`, `installation*`. Activation = one branded comment, **delete+repost** per debounced gen (bottom + notify). Check Run deferred. See §4. |
| Q5 | Auth / reviewer identity | **RESOLVED** — GitHub OAuth (user-to-server) + session; **every artifact read gated by the viewer's GitHub repo access** (briefs = private source). M1 identity scope = per-`(repo,pr,reviewer)` Checkpoint + delta-core selection; carry-over overlay deferred to M2. User token short-lived / encrypted / minimal. |
| Q6 | FE↔backend API contract | **RESOLVED** — keep TanStack server fns (no REST until the headless lane); brief-as-index + **per-file lazy diff keyed by artifact id** (`getDiff({artifactId, file})`, not loose SHA — the id encodes the brief/delta span: brief recomputes base→head, delta fetches checkpoint→head live and falls back to the full Brief when GitHub cannot serve it). File path is canonical *within* an artifact (renames contained in the diff; rename-stable identity is a carry-over/M2 concern). `submitReview` write path; every read gated by repo access. |
| Q7 | Trust / tenancy + secrets + **compliance** | **RESOLVED** (see [ADR 0016](./adr/0016-github-app-auth-and-trust-tenancy-boundary.md)) — instance = trust boundary, rows scoped by `(installation_id, repo)`; all static secrets in env (none in DB/repo), reviewer token envelope-encrypted/short-lived. **Prompt injection: ALL model inputs fenced as data** (title/desc/code/comments/fetched) + instruction hierarchy + structured-output floor + no-verdict/human-in-loop blast-radius bound + raw HTML in model output shown as text, never parsed (`rehype-sanitize` guards only text written on GitHub). **Hosted stores no raw code** — diffs fetched on-demand by token; baseline snapshot configurable (off = delta degrades to full Brief); brief = analysis (optional quote-minimization). High-confidence **secret redaction** (line-preserving, default-on). Configurable **retention** + **purge by org/installation** (erasure). **Audit-log interface** for hosted SOC2; self-host SOC2 = adopter's. |

## 6. Deferred / out-of-scope for M1

Explicitly parked so the build doesn't scope-creep and nothing reads as forgotten:

- **Triage cascade** → M2.
- **Per-reviewer carry-over overlay + comment anchoring mechanics** → M2. M1 ships only the delta *core* + Checkpoint selection.
- **Multi-provider adapters** → M3. M1 = **Anthropic adapter only**; BYOK = the adopter's *Anthropic* key. **M1 trust limitation (honest):** code still egresses to Anthropic — true "code never touches a third party" needs a self-hosted/VPC-model adapter, which is gated by the structured-output floor. The Generator port boundary already exists, so adapters are additive.
- **ContextSource enrichment + headless dual-consumer lane** → post-validation.
- **Reference-counted GC** → deferred; M1 = retain-during-PR + sweep on close.
- **Hosted multi-tenant mode, billing, central key vault** → post-validation; boundaries in place (tenant scoping / audit / key-provider).
- **Audit-log population + the SOC2 program** → boundary in M1, populated/hardened in the hosted offering.
- **Object storage + response streaming** → deferred.
- **Check Run surface + redaction beyond high-confidence patterns** → deferred; M1 = branded comment + line-preserving high-confidence redaction.

## 7. Versioning and releases

One git tag `vX.Y.Z` is the version of everything a release ships; the
repository itself carries no version (`dev` from a source build, `0.0.0` in
the CLI manifest). The decision and its trade-offs are in the versioning
decision record under `docs/adr/`.

| Question | Where it is answered |
| --- | --- |
| The words (Release, Instance, Image, Expand and Contract step, Breaking release, Skew, Dev build, Version notice) | `CONTEXT.md` |
| How a release is cut, what the tag publishes, candidates, the rehearsal | `docs/dev/releasing.md` |
| The pass before a tag | `docs/dev/pre-release-testing.md` |
| How an operator learns of a release, upgrades, rolls back, turns the check off | `docs/self-host/operations.md` |
| What the CLI prints when versions differ | `docs/self-host/cli.md` |
| The rules each member holds (anonymous update check, the version header, `instance_version`, the migration lint, the stamp and prune) | the `AGENTS.md` of `apps/api`, `packages/persistence`, `apps/cli`, `tools/release` |
| Consumer-visible API changes by version | `docs/api-changelog.md` |

## References

- [ADR 0006](./adr/0006-delta-brief-generation-and-state-model.md) — delta / state model
- [ADR 0007](./adr/0007-delta-comment-anchoring-and-flag-carry-over.md) — carry-over and anchoring
- [ADR 0008](./adr/0008-brief-delta-persistence-and-fetching.md) — persistence and fetching
- [ADR 0010](./adr/0010-tiered-generation-triage.md) — tiered generation triage
- [ADR 0013](./adr/0013-provider-agnostic-generation-and-byok.md) — provider-agnostic generation, BYOK
- [ADR 0014](./adr/0014-external-context-and-ai-review-boundary.md) — external-context boundary
- [ADR 0015](./adr/0015-self-hosted-runtime-postgres-single-dependency.md) — runtime + Postgres single dependency
- [ADR 0016](./adr/0016-github-app-auth-and-trust-tenancy-boundary.md) — GitHub App, auth, trust/tenancy
- [ADR 0017](./adr/0017-oss-self-host-first-distribution.md) — OSS self-host-first distribution
- [ADR 0018](./adr/0018-m1-postgres-schema.md) — M1 Postgres schema
- `CONTEXT.md` (glossary)
