---
status: accepted
---

# M1 Postgres Schema

ADR 0008's logical persistence model realized as the physical M1 schema on vanilla Postgres + Drizzle (ADR 0015), with GitHub-native numeric identity, mandatory `(installation_id, repo_id)` tenant scoping on every row (ADR 0016), and large artifacts as content-addressed `TEXT`. This ADR records the physical schema decisions; it is filled in incrementally as the schema grill resolves each entity.

Decisions D1–D11 below cover all six ADR 0008 entities plus the tenant scoping, retention + deletion seam, append-only audit log, the graphile-worker boundary, the `generation` status projection, and reviewer-token storage. The table inventory and the entity→table mapping are in **Consequences**.

## Decisions

### D1 — Identity columns

- Key on GitHub's **stable numeric ids** as `bigint`: `installation_id`, `repo_id`, `reviewer_id` — the integer `database_id`, **not** the GraphQL `node_id` (opaque base64, fatter index, no internal upside since these keys are never client-facing).
- We **never mint our own ids** or hold a GitHub-id↔our-id mapping table — that linkage would itself be the PII to protect and erase. GitHub ids are pseudonymous, stable across rename/transfer, and delivered in every webhook payload.
- Mutable labels (`repo_slug` = `owner/repo`, `reviewer_login`) are **non-key, purgeable** display columns, refreshed on webhook. They are the only directly-identifying data; the numeric ids are pseudonymous.
- **Names live only in mutable working tables.** The append-only audit log is **numeric-only** — it cannot be purged, so it must hold nothing identifying (ids resolved to names at admin read-time). A `store_display_names` config (default **on** for self-host) can null the working-table name columns for hosted minimization with no schema change.

### D2a — Primary keys

- Every table: surrogate `id bigint generated always as identity` PK + a `UNIQUE` constraint on the full natural key. **FKs reference the surrogate**, never the wide SHA-laden tuple.
- The unique index **leads with `installation_id, repo_id, pr_number, …`** so one index serves uniqueness *and* every left-prefix read (tenant filter → per-repo → per-PR). No separate tenant index.
- SHAs stored as `text` (hex) for M1 — debuggable, GitHub-native. `bytea` (raw) deferred as an index-size optimization.

### D2b — Tenancy enforcement

- `installation_id` on every row and in every query — the trust boundary (ADR 0016 #6) and the redesign-avoider, carried though M1 is single-tenant (`instance = tenant`).
- Enforced at the **application layer**: a tenant-scoped repository (`forTenant(ctx)`) is the only DB surface — raw handle not exported (compile-time), context asserted (runtime). Tenant context comes from the authz middleware (web path) or the job payload (worker path).
- **RLS deferred** to the hosted offering. It protects against a second tenant not present in an M1 instance, and costs policy + a second DB role + per-transaction `SET LOCAL` plumbing that fights connection pooling. It is **additive later** — the context-threading built now is exactly the input RLS consumes (`SET LOCAL app.installation_id`), so deferring wastes nothing and requires no schema change.

### D3 — Brief key is the `(base, head)` span

Three SHA roles, previously blurred under "baseline":

| Role | Meaning | Where | Column |
|---|---|---|---|
| **PR-base** | merge-base / base-branch tip — Brief's lower bound (whole-PR span) | Brief | `base_sha` |
| **head** | current PR head — upper bound | Brief + Delta | `head_sha` |
| **Checkpoint** | a reviewer's *prior head* at last submit — Delta's lower bound | Delta | `baseline_sha` |

- Brief keyed `(installation_id, repo_id, pr_number, base_sha, head_sha)` — its content is a function of **both** endpoints, so a head-only key would go stale (and force a mutating overwrite) when the base advances under a static head. Distinct column names (`base_sha` vs Delta's `baseline_sha`) prevent the PR-base/checkpoint collision in schema and queries.
- ADR 0012's index stays a per-distinct-head **display label**, resolving to the current Brief for that head. Storage identity = the span; human label = `index + head8`.

### D4 — Diffs and the baseline snapshot (DiffSnapshot)

Two diffs, two lifetimes — this is how "no raw code in the DB" (ADR 0016 #10) and "durable baseline" (ADR 0006 #8) coexist:

| Diff | Reachable on GitHub? | Storage |
|---|---|---|
| **Current-head diffs** (UI read path, per-file lazy — ADR 0008) | Always (live head) | Fetched **on-demand by token**, ephemeral per-session cache, **never persisted** |
| **Baseline snapshot** (the checkpoint input to delta gen) | Not after force-push GC | **DiffSnapshot** row — the *one* config-gated persisted-code exception |

- `persist_baseline_snapshot`: default **ON for self-host** (adopter is controller of its own code — no liability; delta is force-push-proof), **OFF for hosted strict-minimization** (nothing code-bearing stored; if GitHub GCs the checkpoint, the delta **degrades gracefully to the full Brief**, which needs only base + live head).
- **Snapshot payload = the `base→checkpoint` diff** we already fetched to brief that head (Option A — essentially free). A later head touching a file unchanged at the checkpoint degrades that file to the full view; full-tree robustness deferred to M2.
- **DiffSnapshot** keyed `(installation_id, repo_id, pr_number, sha)` where `sha` = a **checkpoint** SHA; TEXT passthrough; written **only at submit**, never per-push, never for head-side diffs. M1 retention is coarse (retain for PR life, sweep on close + grace — ADR 0015 #5); no ref-counting, so the snapshot survives the PR without pinning logic.
- **No commit-list snapshot.** The delta is a **tree diff, not commit replay** (ADR 0006 #5) — commit SHAs lie on a pure rebase (all-new SHAs, identical tree → a false delta). Force-push *detection* uses the webhook `before`/`after` ancestry (free, per-event); commit count/range for display is ADR 0012's `commitRange`.

### D5 — `pull_request` aggregate root

A single **mutable** `pull_request` row is the parent of all (immutable) per-PR artifacts:

```
pull_request
  id              bigint identity   -- PK
  installation_id bigint not null
  repo_id         bigint not null
  pr_number       int    not null
  repo_slug       text              -- purgeable display (D1), refreshed on webhook
  state           text not null     -- open | closed | merged
  activated_at    timestamptz       -- null until first deep-link click (Activation gate)
  closed_at       timestamptz
  purge_after     timestamptz       -- nullable; the sweep target
  created_at / updated_at
  UNIQUE (installation_id, repo_id, pr_number)
```

- **Clean mutable/immutable line:** `pull_request` is the one mutable lifecycle row; Brief/Delta/DiffSnapshot/Checkpoint/Disposition/overlay are immutable and **FK to it**.
- **Simplifies child keys:** children carry `installation_id` (tenant filter, no join) + a `pull_request_id` FK, replacing the loose `(repo_id, pr_number)`. Brief key → `(installation_id, pull_request_id, base_sha, head_sha)`.
- **No `repo` table in M1** — `repo_id`/`repo_slug` are columns here; a real `repo` table waits for per-repo config (M3).
- **Deletion seam (ADR 0015 #6 / 0016 #11):** per-PR children FK `pull_request.id` **`ON DELETE CASCADE`**. Purge by PR = delete one row; by repo / installation = scoped predicate-delete on `pull_request` (cascades) + explicit deletes for the non-PR tables (reviewer sessions; audit retained — numeric-only). The DB guarantees erasure completeness (no forgotten child table). **No `installation→repo→pull_request` hierarchy in M1** — `instance = tenant` means one installation, so the small explicit purge routine is cheaper than a hierarchy we don't use.
- **Retention:** `purge_after` is **nullable** — null while the PR is open *and* when retention is disabled / set to "never" (the row is never swept). Set to `closed_at + grace` at close per config. Sweep = `WHERE purge_after IS NOT NULL AND purge_after < now()`, backed by a partial index on `purge_after`. `activated_at` gates compute (Activation).

### D6 — Artifact storage: inline `TEXT` + a code-level `ArtifactStore` seam

- Each typed table (`brief`, `delta`, `diff_snapshot`) holds its blob **inline** as `body TEXT` (passthrough, TOASTed) with `byte_size` + `created_at`. **No shared blob table.**
- Blob read/write is routed through a code-level **`ArtifactStore`** keyed by an opaque content key; the API's opaque key is the typed row's surrogate `id`. The deferred object-storage migration is a **localized code change** — `body` becomes an object-storage pointer and `ArtifactStore` redirects — touching one code path, not every call site (the "single boundary" of ADR 0008, realized in code rather than a table).
- **Rejected Option B** (shared content-addressed `artifact` table): the split is ~1:1 (cross-span/PR content dedup essentially never fires), and it **breaks D5's erasure cascade** — a PR purge cascades the typed rows but *orphans the blobs*, reintroducing the deferred ref-counted GC (or forcing a redundant second cascade + duplicated tenant columns). Inline keeps erasure atomic. Soft, deliberate deviation from ADR 0008's literal "one blob table" phrasing, justified by YAGNI (object storage + GC both deferred) + the code seam giving equivalent migration locality.
- **Provenance = columns**, not blob: `provider`, `model`, `effort` on `brief` + `delta` (surfaced on the Receipt — ADR 0013/0016 #7). `diff_snapshot` carries none — it is a fetched diff, not LLM output.
- **Content-key semantics:** no content-hash column in M1 — the natural `UNIQUE` key already gives idempotent content-addressed writes (same span → same row — ADR 0006 #6). Content-hash dedup is deferred with ref-counted GC.

### D7 — Checkpoint (M1) + Disposition (table now, rows M2)

**Scope reconciliation:** the epic calls M1 a "read-only view" yet requires "a delta core when a reviewer **returns**" (i.e. has a prior Checkpoint). Resolved: **Checkpoints are webhook-driven, not an in-app write** — a reviewer's native GitHub review submission arrives as `pull_request_review` (already subscribed, ADR 0016 #2) and yields the Checkpoint. M1 stays read-only *view* while still creating Checkpoints and selecting deltas.

```
checkpoint
  id                 bigint identity  PK
  installation_id    bigint not null
  pull_request_id    bigint not null  FK → pull_request(id) ON DELETE CASCADE
  reviewer_id        bigint not null
  reviewer_login     text             -- purgeable display (D1)
  last_submitted_sha text   not null  -- = the Delta's baseline_sha; advances on submit, never on view
  submitted_at       timestamptz not null
  UNIQUE (installation_id, pull_request_id, reviewer_id)
```
One row per `(reviewer, PR)`. **M1.**

```
disposition
  id              bigint identity   PK
  installation_id bigint not null
  pull_request_id bigint not null   FK → pull_request(id) ON DELETE CASCADE
  reviewer_id     bigint not null
  file_path       text   not null   -- canonical within an artifact (Q6); rename-stable id is M2
  attribute       text   not null   -- the risk-surface attribute token (the Flag's identity)
  region_start    int    not null
  region_end      int    not null
  decided_at_sha  text   not null   -- SHA the region coordinates are anchored at
  decision        text   not null   -- addressed | dismissed
  reason          text              -- dismissal reason, verbatim on Receipt; null if addressed
  decided_at      timestamptz not null
  UNIQUE (installation_id, pull_request_id, reviewer_id, file_path, attribute, region_start, region_end, decided_at_sha)
```
- **Anchored by content coordinates, never a brief-local id** (ADR 0008) — brief-local ids dangle on regeneration.
- **Table designed in M1; rows written in M2** (needs the engagement write-side / Mind-Map dismiss flow). The forward line-map matching into New/Reopened/Settled/Dropped is M2 (ADR 0007); M1 fixes the anchored shape so the Receipt can freeze dispositions and M2 can match them forward.
- **M1 covers only region-anchored risk-surface flags** (`region NOT NULL`). Playbook-item dispositions (nullable region + a `flag_kind` discriminator) deferred to M2 with the overlay — playbook carry-over is M2 anyway, and Playbook is demoted (CONTEXT reshape).

### D8 — Carry-over overlay: M2 seam, not materialized in M1

The overlay is the **per-reviewer** layer on the shared delta core: `Rendered Delta = delta core (shared by span) + this reviewer's overlay`. It holds flag carry-over statuses + comment anchoring (ADR 0007). Planned shape mirrors the delta core under Option A, adding `reviewer_id`:

```
delta_overlay   -- M2; documented seam, NOT created in M1
  id, installation_id, pull_request_id (FK CASCADE), reviewer_id
  baseline_sha, head_sha            -- pairs with the shared delta core's span
  provider, model, effort           -- small-model provenance
  body text, byte_size, created_at  -- carry-over + anchoring (ADR 0007), passthrough
  UNIQUE (installation_id, pull_request_id, reviewer_id, baseline_sha, head_sha)
```

- **Not materialized in M1** — nothing reads/writes it; the M2 Drizzle migration adds it with **zero rewrite** to any M1 table.
- The single forward-compat requirement — the **delta core key stays reviewer-agnostic** (span only, no `reviewer_id`) so the overlay can be the per-reviewer layer — is already honored (D6/D7). (Contrast D9's audit log, which *is* materialized in M1 because it is a named architectural seam with an emit interface.)

### D9 — Audit log (append-only seam)

A named SOC2-readiness seam (ADR 0016 #12): one immutable, tenant-scoped emit per boundary. **Materialized in M1** (table + a single `audit(...)` emit interface), unlike the overlay.

```
audit_log
  id              bigint identity   PK
  installation_id bigint not null         -- tenant scope; plain column, NOT an FK
  occurred_at     timestamptz not null default now()
  actor_type      text   not null         -- reviewer | app | system
  actor_id        bigint                  -- github user id for a reviewer; null for app/system
  action          text   not null         -- generate | delete | config | auth (+ view later)
  target_type     text                    -- pull_request | brief | delta | installation | ...
  target_id       bigint                  -- numeric ref to the target row
  metadata        jsonb                   -- small semantic, non-PII detail only (e.g. {"decision":"403"})
```

- **No outbound FKs.** Audit must survive the target's deletion (you log a *delete*, then the target is gone); `installation_id` / `target_id` are loose numeric refs. This is what makes it a durable ledger.
- **Numeric-only (D1) and never purged (D5).** No names, no transport detail — **no route/method/headers/IP** (headers + IP are PII/secrets in an un-erasable table). An immutable trail including "tenant X offboarded" is the SOC2 value.
- **`jsonb` metadata** (vs artifact bodies' `TEXT`, D6): audit detail is small + queried, so a queryable type fits.
- **Append-only by convention in M1**; DB `REVOKE UPDATE/DELETE` from the app role is the hosted hardening step.
- **M1 emits = the low-volume boundaries** — `generate` (worker write), `delete` (purge — ADR 0016 #11), `config`, and **auth *denials***. The **high-volume firehoses** (every-request auth-success, every-fetch `view`) are **excluded** — they'd make a never-purged table the largest one and never shrink; they belong in the **purgeable web access log** (route/method/status/latency), which is also the better debugging tool. View sampling + retention revisited in the hosted program.

### D10 — graphile-worker boundary + the `generation` status projection

**Boundary (ADR 0015):**
- graphile-worker **owns its own schema** (`graphile_worker.*`) and runs **its own migrations on boot**; our Drizzle migrations never touch it. Two migration systems, two schemas.
- **Enqueue is transactional** with our writes (one tx: `upsert pull_request` + `add_job`).
- **Debounce/coalesce + single-flight via `job_key`; cancellation** by head-SHA compare. The **job payload carries tenant context** (`{installation_id, pull_request_id, base_sha, head_sha}`) → worker builds `forTenant(payload)`. graphile's own rows aren't tenant-scoped (shared infra; isolation is in the payload).

**`generation` — a CQRS status projection (NOT a queue, NOT a domain entity):**
```
generation
  id, installation_id, pull_request_id (FK CASCADE)
  kind         text not null   -- brief | delta
  head_sha     text not null
  baseline_sha text            -- null for brief; checkpoint for delta
  status       text not null   -- queued | running | succeeded | failed
  phase        text            -- fetching | redacting | generating | writing (optional)
  error        text            -- sanitized reason when failed
  attempts     int  not null default 0
  created_at / updated_at
  UNIQUE (installation_id, pull_request_id, kind, head_sha, baseline_sha)
```
- Justified because graphile **deletes succeeded jobs** (so "job gone" can't mean "done") and is internal/untenanted. The web tier polls `generation`: `succeeded` → fetch the immutable artifact; `failed` → error + retry; `running`+`phase` → determinate progress (ADR 0006 #10). Mutable process state; the `brief`/`delta` rows stay immutable results.
- **No new locks, no DLQ.** Single-flight + the global concurrency cap live in graphile (`job_key` + advisory lock + worker `concurrency`); retries + the de-facto dead-letter are graphile's persisted failed jobs (`last_error`). `generation` only *reflects* — using it as a lock would be a second source of truth.

**Concurrency policy:** Brief = one in-flight **per PR** (shared artifact; `job_key = pull_request_id`); Delta = one **per `(PR, reviewer)`** (`job_key = delta:{pr}:{reviewer}`); a **global cap** (graphile `concurrency` + an Anthropic rate-limit budget) bounds total parallel generations. A Brief and a Delta may run concurrently. Enforced by `job_key`, **not** `generation`.

### D11 — Reviewer auth: GitHub OAuth via a library, behind an identity-provider seam

GitHub **is** the IdP — no passwords/MFA/credential storage. We build an **OAuth client + session/token store**, not an auth system, via a maintained framework-agnostic library (e.g. **Arctic** + own sessions, or **Better Auth** — both hand us the provider token, which we need). No auth SaaS on the self-host critical path; no heavy self-hostable IdP (Ory/Keycloak — against fewest-services). Since GitHub is our *only* IdP, a general auth SaaS would mostly wrap the single provider we integrate directly anyway.

```
reviewer_session   -- the self-host default adapter; the ONE secret-bearing table
  id                  bigint identity   PK
  session_token_hash  text not null UNIQUE   -- cookie value stored only as a hash
  installation_id     bigint not null        -- tenant scope
  reviewer_id         bigint not null
  reviewer_login      text                   -- purgeable display (D1)
  gh_token_ciphertext text not null          -- the GitHub OAuth token, encrypted at rest
  key_ref             text not null          -- key resolved via the provider interface (env→KMS, ADR 0016 #7)
  expires_at          timestamptz not null   -- short-lived; deleted on expiry/logout
  created_at
  INDEX (installation_id, reviewer_id)
```

- **The one dynamic secret in the DB.** Every static secret stays in env (ADR 0016 #7).
- **Encryption = direct, provider-resolved key + `key_ref`** — *not* a per-row envelope DEK: tokens are short-lived and deleted on expiry, so KEK rotation rides on natural token churn. Full envelope is the documented hardening reserved for any future *long-lived* secret.
- **Not FK'd to `pull_request`** (per `(installation, reviewer)`). Cleared by: TTL sweep (`expires_at`), logout, and the installation-purge routine (D5).
- **Behind an identity-provider seam** (same pattern as the key provider #7 and Generator port 0013) so the hosted arm can swap in a managed provider. **Clerk is cloud-only → cannot be a self-host dependency**; it stays a hosted-arm option, not used in M1.

## Consequences

**Table inventory (M1, materialized):**

| Table | Kind | Notes |
|---|---|---|
| `pull_request` | mutable aggregate root | retention/cascade anchor; `activated_at`, `purge_after` (nullable) |
| `brief` | immutable artifact (inline `body`) | key `(installation_id, pull_request_id, base_sha, head_sha)` + provenance + `head_index`/`commit_count` |
| `delta` | immutable artifact (inline `body`) | key `(…, baseline_sha, head_sha)`, reviewer-agnostic core |
| `diff_snapshot` | immutable artifact (inline `body`) | the configurable baseline snapshot; key `(…, sha)` |
| `checkpoint` | per-reviewer position | `last_submitted_sha`; webhook-driven |
| `disposition` | anchored decision | table in M1, **rows written M2** |
| `generation` | mutable CQRS status projection | poll target; not a domain entity |
| `audit_log` | append-only seam | numeric-only, no FKs, never purged |
| `reviewer_session` | secret-bearing | the only encrypted-token table |

`graphile_worker.*` is owned and migrated by graphile-worker — not ours.

**Deferred (additive migrations, zero rewrite):** `delta_overlay` (carry-over overlay → M2), a `repo` table (per-repo config → M3).

**Entity → table (anchored to ADR 0008 / CONTEXT):** Brief→`brief`, Delta core→`delta`, Carry-over overlay→`delta_overlay` (M2 seam), DiffSnapshot→`diff_snapshot`, Checkpoint→`checkpoint`, Disposition→`disposition`.

**Confirmations (per the task):**
- **No raw diffs persisted.** Current-head diffs are fetched **on-demand by token**, ephemeral per-session cache, never in the DB (D4). The *only* persisted code is the configurable baseline snapshot.
- **Baseline snapshot is configurable.** `persist_baseline_snapshot` — default ON self-host / OFF hosted-strict; OFF → the delta degrades to the full Brief when the checkpoint commit is GC'd (D4).

**Other consequences:**
- Two migration systems coexist: Drizzle (our schema) + graphile-worker (its own schema).
- `installation_id` on every row from day one (the redesign-avoider); RLS is an additive hosted hardening, not a schema change (D2b).
- All blob access goes through one code-level `ArtifactStore`; the object-storage migration is localized there (D6).
- Erasure (purge by PR / repo / installation) is mostly an FK cascade off `pull_request` + a small explicit routine for the non-PR tables (`reviewer_session`); `audit_log` is retained, numeric-only (D5/D9).

## Implementation notes (for workstream 1 — not yet built)

High-level reminders so the Drizzle build doesn't re-derive these; no schema written yet.

- **Drizzle expresses the tables; a few things drop to raw SQL in the migration:** the **partial** index `WHERE purge_after IS NOT NULL` (D5 sweep); the **`REVOKE UPDATE/DELETE` on `audit_log`** that enforces append-only (D9 — convention in M1, REVOKE is the hosted hardening); and `INSERT … ON CONFLICT (natural_key) DO UPDATE` for content-addressed artifact writes (idempotency, D6) and `generation` status transitions (D10).
- **Column conventions:** surrogate PK via `.generatedAlwaysAsIdentity()`; SHAs as `text` (D2); timestamps `withTimezone`. Factor shared `tenant` (`id` + `installation_id`) and `stamps` (`created_at`) column groups to keep every table uniform.
- **Two migration systems, kept apart:** graphile-worker runs its own migrations into the `graphile_worker` schema; scope Drizzle (and especially `drizzle-kit push`) to the app schema only so it never tries to manage graphile's tables (D10).
- **Tenant repo is the only DB surface:** `forTenant(ctx)` injects `installation_id`; do not export the raw handle (D2b). Worker builds its context from the job payload; web from the authz middleware.
- **Auth library (D11):** lean Arctic (+ own sessions) or Better Auth behind the identity-provider seam; verify the chosen lib's maintenance status at build time (Lucia is winding down).

## Model vocabulary (persistence-domain terms)

Collected here so the model terms live next to the schema; `CONTEXT.md` stays product/UX-facing (a reviewer never sees these). Product terms (Disposition, Submit, …) live in `CONTEXT.md`.

- **Span artifact** — a Brief or Delta identified by two SHA endpoints `[lower, head]`.
- **Brief base** (`base_sha`) — the PR-base endpoint; a Brief covers the whole PR, `base→head`.
- **Checkpoint baseline** (`baseline_sha`) — a Delta's lower endpoint = the reviewer's **Checkpoint** (a prior head). Distinct from the Brief base.
- **Delta core** — the shared, reviewer-agnostic code-change narrative for a span (the expensive LLM part); table `delta`.
- **Carry-over overlay** — the per-reviewer layer (flag carry-over + comment anchoring) on top of the core; `Rendered Delta = core + overlay`; table `delta_overlay` (M2).
- **DiffSnapshot / baseline snapshot** — the persisted `base→checkpoint` diff at a Checkpoint; config-gated; lets a Delta survive force-push GC; table `diff_snapshot`.
- **Generation (projection)** — the mutable CQRS status mirror of a worker job (queued/running/succeeded/failed); table `generation`; not a domain artifact.
- **Tenant / installation** — the trust-boundary unit; `instance = tenant`; every row scoped by `installation_id`.
