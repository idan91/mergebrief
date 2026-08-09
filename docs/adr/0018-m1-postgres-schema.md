---
status: accepted
---

# M1 Postgres Schema

ADR 0008's logical persistence model realized as the physical M1 schema on vanilla Postgres + Drizzle (ADR 0015), with GitHub-native numeric identity, mandatory `(installation_id, repo_id)` tenant scoping on every row (ADR 0016), and large artifacts as content-addressed `TEXT`. This ADR records the physical schema decisions; it is filled in incrementally as the schema grill resolves each entity.

Decisions D1–D11 below cover all six ADR 0008 entities plus the tenant scoping, retention + deletion boundary, append-only audit log, the graphile-worker boundary, the `generation` status projection, and reviewer-token storage. The table inventory and the entity→table mapping are in **Consequences**.

> **Amended 2026-07-04** (pre-build validation against ADRs 0020/0021/0024): `activated_at`
> dropped from D5 (the lazy Activation gate it encoded was retired by ADR 0020); **D12**
> (`revision_narrative`) and **D13** (`comparison_marks`) added for the artifacts ADR 0024
> introduced after this schema was grilled.
>
> **Amended 2026-07-05** (BRIEF-2 pre-build grill): D5 gains `entry_comment_id`; D10's
> per-kind job keys superseded by one `generate:{pr}` job (bundle model) + a `superseded`
> generation status; D11 gains `gh_refresh_token_ciphertext` (expiring user tokens + rotating
> refresh via `@octokit/oauth-app`). All three land as BRIEF-2 migrations.
>
> **Amended 2026-07-06** (BRIEF-19 grill): **D14** (`user_settings`) added — the first
> deliberately NON-tenant-scoped row kind besides `audit_log`, keyed by GitHub user id, so a
> reviewer's default installation survives across sessions. Lands as a BRIEF-19 migration.
>
> **Amended 2026-07-23** (BRIEF-40 grill): **D15** (`github_grant`) added — the GitHub
> credential pair moves out of `reviewer_session`/`api_token` into one grant row per
> authorization, referenced by FK, making the token-refresh divergence unrepresentable
> (ADR 0016 #4 as amended). The inventory also now records `api_token` (BRIEF-17), which
> this ADR had missed. Lands as a BRIEF-40 migration.

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
  title           text              -- purgeable display (D1), refreshed on webhook
                                    --   (2026-07-06, BRIEF-19: the picker list's label;
                                    --   nullable — pre-column rows backfill on next event)
  state           text not null     -- open | closed | merged
  entry_comment_id bigint           -- branded Entry comment id (2026-07-05; delete+repost per
                                    --   ADR 0016 #3; dangling id self-heals by posting fresh)
  closed_at       timestamptz
  purge_after     timestamptz       -- nullable; the sweep target
  created_at / updated_at
  UNIQUE (installation_id, repo_id, pr_number)
```

- **Clean mutable/immutable line:** `pull_request` is the one mutable lifecycle row; Brief/Delta/DiffSnapshot/Checkpoint/Disposition/overlay are immutable and **FK to it**.
- **Simplifies child keys:** children carry `installation_id` (tenant filter, no join) + a `pull_request_id` FK, replacing the loose `(repo_id, pr_number)`. Brief key → `(installation_id, pull_request_id, base_sha, head_sha)`.
- **No `repo` table in M1** — `repo_id`/`repo_slug` are columns here; a real `repo` table waits for per-repo config (M3).
- **Deletion boundary (ADR 0015 #6 / 0016 #11):** per-PR children FK `pull_request.id` **`ON DELETE CASCADE`**. Purge by PR = delete one row; by repo / installation = scoped predicate-delete on `pull_request` (cascades) + explicit deletes for the non-PR tables (reviewer sessions; audit retained — numeric-only). The DB guarantees erasure completeness (no forgotten child table). **No `installation→repo→pull_request` hierarchy in M1** — `instance = tenant` means one installation, so the small explicit purge routine is cheaper than a hierarchy we don't use.
- **Retention:** `purge_after` is **nullable** — null while the PR is open *and* when retention is disabled / set to "never" (the row is never swept). Set to `closed_at + grace` at close per config. Sweep = `WHERE purge_after IS NOT NULL AND purge_after < now()`, backed by a partial index on `purge_after`.
- ~~`activated_at` gates compute (Activation).~~ **Dropped (2026-07-04, ADR 0020):** the lazy compute-on-first-click gate is retired — Trigger is eager-on-push, the deep-link click is pure Entry, so there is no gating state to store. Re-adding a `first_entered_at` later (e.g. if ADR 0020's `on-first-view` escape hatch is ever exercised) is an additive migration; first-entry *analytics* belong in the purgeable web access log (D9), never here.

### D6 — Artifact storage: inline `TEXT` + a code-level `ArtifactStore` boundary

- Each typed table (`brief`, `delta`, `diff_snapshot`) holds its blob **inline** as `body TEXT` (passthrough, TOASTed) with `byte_size` + `created_at`. **No shared blob table.**
- Blob read/write is routed through a code-level **`ArtifactStore`** keyed by an opaque content key; the API's opaque key is the typed row's surrogate `id`. The deferred object-storage migration is a **localized code change** — `body` becomes an object-storage pointer and `ArtifactStore` redirects — touching one code path, not every call site (the "single boundary" of ADR 0008, realized in code rather than a table).
- **Rejected Option B** (shared content-addressed `artifact` table): the split is ~1:1 (cross-span/PR content dedup essentially never fires), and it **breaks D5's erasure cascade** — a PR purge cascades the typed rows but *orphans the blobs*, reintroducing the deferred ref-counted GC (or forcing a redundant second cascade + duplicated tenant columns). Inline keeps erasure atomic. Soft, deliberate deviation from ADR 0008's literal "one blob table" phrasing, justified by YAGNI (object storage + GC both deferred) + the code boundary giving equivalent migration locality.
- **Origin = columns**, not blob: `provider`, `model`, `effort` on `brief` + `delta` (surfaced on the Receipt — ADR 0013/0016 #7). `diff_snapshot` carries none — it is a fetched diff, not LLM output.
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

### D8 — Carry-over overlay: M2 boundary, not materialized in M1

The overlay is the **per-reviewer** layer on the shared delta core: `Rendered Delta = delta core (shared by span) + this reviewer's overlay`. It holds flag carry-over statuses + comment anchoring (ADR 0007). Planned shape mirrors the delta core under Option A, adding `reviewer_id`:

```
delta_overlay   -- M2; documented boundary, NOT created in M1
  id, installation_id, pull_request_id (FK CASCADE), reviewer_id
  baseline_sha, head_sha            -- pairs with the shared delta core's span
  provider, model, effort           -- small-model origin
  body text, byte_size, created_at  -- carry-over + anchoring (ADR 0007), passthrough
  UNIQUE (installation_id, pull_request_id, reviewer_id, baseline_sha, head_sha)
```

- **Not materialized in M1** — nothing reads/writes it; the M2 Drizzle migration adds it with **zero rewrite** to any M1 table.
- The single forward-compat requirement — the **delta core key stays reviewer-agnostic** (span only, no `reviewer_id`) so the overlay can be the per-reviewer layer — is already honored (D6/D7). (Contrast D9's audit log, which *is* materialized in M1 because it is a named architectural boundary with an emit interface.)

### D9 — Audit log (append-only boundary)

A named SOC2-readiness boundary (ADR 0016 #12): one immutable, tenant-scoped emit per boundary. **Materialized in M1** (table + a single `audit(...)` emit interface), unlike the overlay.

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
- **M1 emits = the low-volume boundaries** — `generate` (worker write), `delete` (purge — ADR 0016 #11), `config`, and **auth *denials***. The **high-volume firehoses** (every-request auth-success, every-fetch `view`) are **excluded** — they'd make a never-purged table the largest one and never shrink; they belong in the **purgeable web access log** (route/method/status/latency — since BRIEF-51 the structured stdout `evt: "api.access"` line, renamed from `evt: "read"`; see [ADR 0034](./0034-observability-v1-logging-health.md)), which is also the better debugging tool. View sampling + retention revisited in the hosted program.

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

**Concurrency policy:** ~~Brief = one in-flight **per PR** (shared artifact; `job_key = pull_request_id`); Delta = one **per `(PR, reviewer)`** (`job_key = delta:{pr}:{reviewer}`)~~ **Superseded (2026-07-05, BRIEF-2 grill):** there is **one job kind, `generate`, `job_key = generate:{pull_request_id}`** — every generation-relevant webhook event enqueues it (with `run_at = now + debounce`; job-key replacement of the pending job IS the trailing debounce), and the **worker derives the artifact bundle from state at execution time** (brief + marks + narrative + one delta core per distinct checkpoint SHA, huge-span rule per span). Per-kind delta job keys predate the core/overlay hardening and are retired. A **global cap** (graphile `concurrency` + a provider rate-limit budget) still bounds total parallel generations; single-flight per PR enforced by `job_key`, **not** `generation`. `generation.status` gains a terminal **`superseded`** value (mid-call abort on head advance — ADR 0006 #6 as amended); web enqueue writes the one row it can know (`kind: brief`, queued), the worker upserts rows for the artifacts it derives.

### D11 — Reviewer auth: GitHub OAuth via a library, behind an identity-provider boundary

GitHub **is** the IdP — no passwords/MFA/credential storage. We build an **OAuth client + session/token store**, not an auth system, via a maintained framework-agnostic library (e.g. **Arctic** + own sessions, or **Better Auth** — both hand us the provider token, which we need). No auth SaaS on the self-host critical path; no heavy self-hostable IdP (Ory/Keycloak — against fewest-services). Since GitHub is our *only* IdP, a general auth SaaS would mostly wrap the single provider we integrate directly anyway.

```
reviewer_session   -- the self-host default adapter; the ONE secret-bearing table
  id                  bigint identity   PK
  session_token_hash  text not null UNIQUE   -- cookie value stored only as a hash
  installation_id     bigint not null        -- tenant scope
  reviewer_id         bigint not null
  reviewer_login      text                   -- purgeable display (D1)
  gh_token_ciphertext text not null          -- the GitHub OAuth token, encrypted at rest
  gh_refresh_token_ciphertext text not null  -- rotating refresh token, encrypted (2026-07-05)
  key_ref             text not null          -- key resolved via the provider interface (env→KMS, ADR 0016 #7)
  expires_at          timestamptz not null   -- short-lived; deleted on expiry/logout
  created_at
  INDEX (installation_id, reviewer_id)
```

> **Amended 2026-07-05 (BRIEF-2 grill) — library + token model resolved.** Library =
> **`@octokit/oauth-app`** (GitHub-official; we are GitHub-only, so its native handling of
> **expiring user access tokens (~8h) + rotating refresh tokens (~6mo)** beats a generic
> OAuth lib; Arctic stays the fallback, Better Auth rejected — wants to own session tables).
> Both tokens stored, both encrypted (`encryptToken`, own columns). Refresh is **lazy at
> next use and serialized per session** (`SELECT … FOR UPDATE` — GitHub refresh tokens are
> single-use, concurrent requests must not race the exchange); any refresh failure → delete
> session → redirect re-login (the degradation path). Session ceiling = GitHub's rotation
> limit + the TTL sweep; no extra cap.

- **The one dynamic secret in the DB.** Every static secret stays in env (ADR 0016 #7).
- **Encryption = direct, provider-resolved key + `key_ref`** — *not* a per-row envelope DEK: tokens are short-lived and deleted on expiry, so KEK rotation rides on natural token churn. Full envelope is the documented hardening reserved for any future *long-lived* secret.
- **Not FK'd to `pull_request`** (per `(installation, reviewer)`). Cleared by: TTL sweep (`expires_at`), logout, and the installation-purge routine (D5).
- **Behind an identity-provider boundary** (same pattern as the key provider #7 and Generator port 0013) so the hosted arm can swap in a managed provider. **Clerk is cloud-only → cannot be a self-host dependency**; it stays a hosted-arm option, not used in M1.

### D12 — Revision narrative (added 2026-07-04, from ADR 0024)

ADR 0024 introduced the **Revision narrative** after this schema was grilled: a lean, shared,
generated explanation of the `prevHead→head` span, produced for every **non-first** Brief in an
additional LLM call, explicitly *not* the Delta Brief schema (no Checkpoint, no carry-over, no
"since you last looked"), attaching narrative chunks to the full Brief's Change-group IDs, and
able to fail independently of the Brief.

```
revision_narrative
  id              bigint identity   PK
  installation_id bigint not null
  pull_request_id bigint not null   FK → pull_request(id) ON DELETE CASCADE
  brief_id        bigint not null   FK → brief(id)        ON DELETE CASCADE
  prev_head_sha   text   not null   -- the previously briefed head (a THIRD SHA role — neither
                                    --   Brief base nor Checkpoint baseline; own column name)
  head_sha        text   not null
  provider / model / effort         -- LLM origin (D6), surfaced on the Receipt
  body text, byte_size, created_at  -- passthrough, inline (D6)
  UNIQUE (installation_id, pull_request_id, prev_head_sha, head_sha)
```

- **Own table, not a `delta.kind` discriminator** — packing two artifacts whose lower-bound SHA
  means different things (`baseline_sha` = checkpoint vs `prev_head_sha` = prior briefed head)
  into one table re-blurs exactly the SHA-role distinction D3 exists to keep apart, and ADR 0024
  rejected Delta-Brief reuse at the concept level. Not embedded in the `brief` body either — the
  narrative is a separate call that can fail/arrive independently; embedding would delay the
  Brief write or make `brief` rows mutable (D5).
- **`brief_id` FK = the anchoring rule.** The narrative points into brief-local Change-group IDs,
  which dangle on regeneration (same hazard D7 guards against). The FK makes the coupling
  explicit: **1:1 with a specific `brief` row, optional** (first Brief has none; failed call =
  row absent, UI shows "summary unavailable"). A narrative **never spans Briefs** and is never
  re-anchored forward — a new head gets a new Brief with its own narrative; a regenerated Brief
  cascades the old narrative away and regenerates it against the new group IDs.
- `generation.kind` (D10) gains `revision-narrative` so the wait UX can reflect the extra call;
  single-flight rides the same per-PR `job_key` (it runs inside the Brief generation job).

### D13 — Comparison marks (added 2026-07-04, from ADR 0024)

ADR 0024: "every selectable comparison span gets a mechanical changed-line sidecar keyed by
`(baselineSha, headSha)`" — the **source of truth for FE highlighting**, LLM-independent.
Two span families consume it: `prevHead→head` (Previous Brief compare) and `checkpoint→head`
(Your-last-review compare); the marks themselves are a pure tree-diff of two SHAs, so one table
serves both.

```
comparison_marks
  id              bigint identity   PK
  installation_id bigint not null
  pull_request_id bigint not null   FK → pull_request(id) ON DELETE CASCADE
  baseline_sha    text   not null   -- span lower bound: a prevHead OR a checkpoint SHA
  head_sha        text   not null
  body text, byte_size, created_at  -- marks payload, passthrough, inline (D6)
  UNIQUE (installation_id, pull_request_id, baseline_sha, head_sha)
```

- **Persisted, not recomputed on demand** — the same GC argument that justified `diff_snapshot`
  (D4): a comparison span's *lower* bound is exactly the kind of SHA force-push GC makes
  unreachable; on-demand recompute would silently kill the Previous-Brief compare on older
  timeline points. Written by the worker at generation/pre-warm time (ADR 0024 §Generation).
- **Coordinates-only, unconditional — NOT code-bearing.** A mark is `file + side + line-range +
  change kind`, never line *content*. That keeps it outside D4's "no raw code in the DB" rule —
  no `persist_baseline_snapshot` gate needed, and `diff_snapshot` remains the **single**
  persisted-code exception. The FE paints marks onto diff content fetched live (D4's ephemeral
  path); removed-at-head content on a GC'd span degrades to an honest "content unavailable" —
  same degradation family as delta→full-Brief.
- **No origin columns** — mechanical output, not LLM output (same rule as `diff_snapshot`).
- Reviewer-agnostic by construction (SHA-pair key, no `reviewer_id`) — a returning reviewer's
  `checkpoint→head` marks are shareable by any reviewer at the same checkpoint, mirroring the
  delta-core/overlay split (D8).

### D14 — `user_settings` (added 2026-07-06, from BRIEF-19 grill)

Per-GitHub-user settings that must survive across sessions and installations. First (and so
far only) column: `default_installation_id` — the installation a multi-org reviewer's login
binds to when it is still in their accessible set (BRIEF-19; ADR 0016 #4 as amended).

```
user_settings
  gh_user_id              bigint  PK      -- GitHub's numeric user id (same id sessions carry)
  default_installation_id bigint  null
  created_at / updated_at timestamptz
```

- **Deliberately NOT tenant-scoped** — the D2b exception, second after `audit_log`. A person
  spans installations (reviewer in one org, author in another; same human either way), so the
  row cannot carry `installation_id` as its key. Reads/writes go through a dedicated
  `userSettings` boundary, not `forTenant` — the type-level containment tests must treat it like
  `audit`, not like a tenant table.
- **Typed columns, never a JSON blob.** Every new setting is a column + migration, same
  closed-vocabulary discipline as the CHECK-constrained enums — the table must not rot into a
  preferences dump.
- **Dangling defaults degrade, never bind.** Login binds the default only when it appears in
  the viewer's live accessible-installations set (`GET /user/installations`); otherwise falls
  back to the first accessible one. Installation purge (D5/ADR 0015) may leave a stale
  `default_installation_id` — harmless by construction, and overwritten on next switch.
- No FK to any tenant table (same isolation rationale as `audit_log`'s no-FK rule).

### D15 — `github_grant` (added 2026-07-23, from BRIEF-40 grill)

One row per GitHub user-to-server authorization; the ONLY holder of the encrypted GitHub
token pair. `reviewer_session` and `api_token` drop `gh_token_ciphertext` /
`gh_refresh_token_ciphertext` / `key_ref` and gain `grant_id` (FK, not null). Exists because
GitHub refresh tokens are single-use: two rows carrying copies of one pair race each other's
refresh and the loser is stranded (BRIEF-40); one physical copy makes that impossible.

```
github_grant
  id                          bigint identity  PK
  gh_token_ciphertext         text not null          -- access token, encrypted at rest
  gh_refresh_token_ciphertext text not null          -- rotating refresh token, encrypted
  key_ref                     text not null          -- provider-resolved key (ADR 0016 #7)
  refresh_expires_at          timestamptz not null   -- the pair's outer bound (~6mo, rotating)
  created_at / updated_at     timestamptz
```

- **Refresh = the same lazy, serialized CAS as D11**, re-anchored from the session row to the
  grant row — both presentation channels (cookie, Bearer) converge on one rotation path.
  Session `expires_at` keeps its D11 semantics, maintained from the grant's rotation.
- **Deliberately NOT tenant-scoped** — third D2b exception after `audit_log` and
  `user_settings`: the credential belongs to a GitHub *user* and spans installations; the
  installation binding stays on the referencing session/token rows.
- **Lifecycle: dies with its last referent**, deleted in the same transaction that removes the
  last referencing session/token row — no orphan sweeper. Refresh failure keeps per-channel
  postures (cookie deletes the session; a token row is never auto-deleted), so a dead grant
  may linger behind a dead-but-unrevoked token — inert ciphertext, harmless. The converse
  also holds (noted 2026-07-23, BRIEF-40 review): a soft-REVOKED token keeps its `grant_id`
  (NOT NULL FK; the row stays listable), so revocation retains the — possibly still-live —
  encrypted pair until installation purge. Accepted: MergeBrief-side revoke severs access
  through this instance; actually invalidating/releasing the GitHub credential is the
  "grant revocation hygiene" follow-up (outbound per-token DELETE).
- **Migration backfill dedups by exact ciphertext match** (mint copied ciphertext verbatim,
  so a not-yet-diverged token matches its source session byte-for-byte and joins its grant);
  unmatched rows get their own grant.

## Consequences

**Table inventory (M1, materialized):**

| Table | Kind | Notes |
|---|---|---|
| `pull_request` | mutable aggregate root | retention/cascade anchor; `activated_at`, `purge_after` (nullable) |
| `brief` | immutable artifact (inline `body`) | key `(installation_id, pull_request_id, base_sha, head_sha)` + origin + `head_index`/`commit_count` |
| `delta` | immutable artifact (inline `body`) | key `(…, baseline_sha, head_sha)`, reviewer-agnostic core |
| `diff_snapshot` | immutable artifact (inline `body`) | the configurable baseline snapshot; key `(…, sha)` |
| `revision_narrative` | immutable artifact (inline `body`) | 1:1-optional with a `brief` row (FK, cascades); key `(…, prev_head_sha, head_sha)` (D12) |
| `comparison_marks` | immutable artifact (inline `body`) | mechanical, coordinates-only, no origin; key `(…, baseline_sha, head_sha)` (D13) |
| `checkpoint` | per-reviewer position | `last_submitted_sha`; webhook-driven |
| `disposition` | anchored decision | table in M1, **rows written M2** |
| `generation` | mutable CQRS status projection | poll target; not a domain entity |
| `audit_log` | append-only boundary | numeric-only, no FKs, never purged |
| `user_settings` | per-user settings | NON-tenant-scoped (D14); keyed `gh_user_id`; typed columns only |
| `reviewer_session` | session (cookie channel) | credential via `grant_id` FK (D15) |
| `api_token` | user-managed credential (Bearer channel) | ADR 0016 #4 as amended (BRIEF-17); hash-resolved, mint-chosen expiry, soft-revoke; credential via `grant_id` FK (D15) |
| `github_grant` | secret-bearing | the ONE encrypted-token table (D15); NON-tenant-scoped; dies with last referent |

`graphile_worker.*` is owned and migrated by graphile-worker — not ours.

**Deferred (additive migrations, zero rewrite):** `delta_overlay` (carry-over overlay → M2), a `repo` table (per-repo config → M3).

**Entity → table (anchored to ADR 0008 / CONTEXT):** Brief→`brief`, Delta core→`delta`, Carry-over overlay→`delta_overlay` (M2 boundary), DiffSnapshot→`diff_snapshot`, Checkpoint→`checkpoint`, Disposition→`disposition`, Revision narrative→`revision_narrative` (ADR 0024), Revision changes / comparison marks→`comparison_marks` (ADR 0024).

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
- **Auth library (D11):** lean Arctic (+ own sessions) or Better Auth behind the identity-provider boundary; verify the chosen lib's maintenance status at build time (Lucia is winding down).

## Model vocabulary (persistence-domain terms)

Collected here so the model terms live next to the schema; `CONTEXT.md` stays product/UX-facing (a reviewer never sees these). Product terms (Disposition, Submit, …) live in `CONTEXT.md`.

- **Span artifact** — a Brief or Delta identified by two SHA endpoints `[lower, head]`.
- **Brief base** (`base_sha`) — the PR-base endpoint; a Brief covers the whole PR, `base→head`.
- **Checkpoint baseline** (`baseline_sha`) — a Delta's lower endpoint = the reviewer's **Checkpoint** (a prior head). Distinct from the Brief base.
- **Prior briefed head** (`prev_head_sha`) — a Revision narrative's lower endpoint = the head of the immediately previous Brief. The third SHA role; neither Brief base nor Checkpoint baseline (D12).
- **Comparison marks** — the mechanical, coordinates-only changed-line sidecar for a comparison span `(baseline_sha, head_sha)`; source of truth for FE highlighting; table `comparison_marks` (D13). Not code-bearing; not an LLM artifact.
- **Delta core** — the shared, reviewer-agnostic code-change narrative for a span (the expensive LLM part); table `delta`.
- **Carry-over overlay** — the per-reviewer layer (flag carry-over + comment anchoring) on top of the core; `Rendered Delta = core + overlay`; table `delta_overlay` (M2).
- **DiffSnapshot / baseline snapshot** — the persisted `base→checkpoint` diff at a Checkpoint; config-gated; lets a Delta survive force-push GC; table `diff_snapshot`.
- **Generation (projection)** — the mutable CQRS status mirror of a worker job (queued/running/succeeded/failed); table `generation`; not a domain artifact.
- **Tenant / installation** — the trust-boundary unit; `instance = tenant`; every row scoped by `installation_id`.
