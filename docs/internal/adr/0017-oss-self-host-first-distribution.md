# 0017: OSS Self-Host-First Distribution (Open-Core)

Status: superseded in part by 0023

> **Superseded in part by [ADR 0023](0023-oss-only-no-hosted-arm.md) (2026-06-30).** The
> **hosted offering** described below as "deferred, not forbidden" is now **not pursued** —
> the project is OSS-only. Everything else here (OSS self-host first, static demo, BYOK
> default, Postgres-only, per-instance App) stands. Read this ADR as: drop the "hosted" run
> mode and the "decide packaging later" hedging; keep the self-host substance.

The product ships **open-source, self-hosted first**, open-core: one codebase runs as a **static demo**, a **self-hosted instance**, or a **hosted offering** — the last deferred behind validation and legal headroom, not forbidden. This is the foundational distribution decision the rest of the architecture (ADR 0015 runtime/store, ADR 0016 trust/tenancy) is shaped around.

## Context

- **No technical moat yet** — `CONTEXT.md` records taxonomy + playbooks as reproducible. We are at validation stage; the kill criterion is **peer reuse, not scale** (`docs/mvp/`).
- **Founder constraints** (rationale, not the sole driver): side-project hours are strictly capped; *hosting* additionally means personally holding other orgs' source code (data-liability), unbounded LLM cost, and oncall against that cap; and contractual **IP constraints** gate building/publishing — written clearance must precede public work. (Details in private project notes.)
- **Our friction floor is structurally higher than the OSS field's.** Stateless reviewers (PR-Agent, OpenReview) avoid setup friction by being stateless; the **Delta Brief requires persistent state**, so we cannot be a pure GitHub Action. This is a fact to accept and soften, not fight.

## Considered Options

- **Hosted SaaS first** — best for adoption (the mainstream competitor model), but heaviest on cost, time, and personal data-liability, and blocked at scale by the founder constraints. Rejected *for now* (not forever).
- **OSS self-host first (chosen).**
- **Both / fork** — rejected: the core is identical; hosted vs self-host is *packaging*, not a fork.

## Decision

1. **OSS self-host first, open-core.** One codebase, three run modes:
   - **Static demo** — the FE replaying pre-generated briefs (today's `apps/web` reading `tools/categorizer/out`). No backend, no LLM calls, free. The zero-friction "see the value" funnel.
   - **Self-host** — `docker compose up`; `instance = tenant`; **code and model keys never leave the adopter**.
   - **Hosted** — *deferred, not forbidden*; same core + multi-tenancy + central auth + BYOK key handling, built only after validation and with legal headroom.
2. **BYOK default** — the adopter brings and pays the model key.
3. **Build one core; decide packaging later.** Do not build hosted-only machinery (multi-tenancy density, billing, central key vault) until validation passes; ADR 0016's boundaries (tenant scoping, auth gate, audit log) keep it additive.
4. **Friction is a growth-stage problem, not a validation-stage one.** For a few design-partner orgs the setup is an afternoon; soften with the app-manifest flow + a one-command deploy + the static demo — don't over-invest now.
5. **Gate:** contractual IP clearance precedes building/publishing under the author's name.

## Why This Way

With no moat and no ability to run a hosted business at scale under current constraints, we compete on the axis that is winnable — being the standard for the *thesis* (mindshare), via OSS — while deferring monetization to when it is legal. Self-host also collapses the trust story (adopter is controller, ADR 0016) and the infra surface (Postgres-only, ADR 0015), which is exactly what makes `docker compose up` viable. Building one core with clean boundaries means the eventual hosted offering is a packaging/ops lift, not a rewrite.

## Consequences

- The architecture optimizes for self-host: Postgres-only (ADR 0015), per-instance App (ADR 0016), no cloud-proprietary dependencies.
- The **static demo** (the existing artifact-reading FE) becomes a first-class funnel artifact, not throwaway.
- **Hosted remains available** as a future open-core arm; ADR 0016's boundaries (tenancy, audit, key-provider) are its readiness.
- Phase-1 validation ships as a **self-hostable repo + demo**, not a service.
- Founder-constraint specifics live in project memory and are **not critical to the architecture** — the design would be identical for any solo, OSS-first author.
