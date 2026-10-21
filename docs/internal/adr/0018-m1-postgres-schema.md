# 0018: M1 Postgres Schema

Status: superseded in part by 0040, 0043

ADR 0008's logical persistence model realized as the physical M1 schema on vanilla Postgres + Drizzle (ADR 0015), with GitHub-native numeric identity, mandatory `(installation_id, repo_id)` tenant scoping on every row (ADR 0016; amended, see Amendments), and large artifacts as content-addressed `TEXT`. This ADR records the physical schema decisions; it is filled in incrementally as the schema grill resolves each entity.

Decisions D1–D15 below cover all six ADR 0008 entities plus the tenant scoping, retention + deletion boundary, append-only audit log, the graphile-worker boundary, the `generation` status projection, reviewer-token storage, and the artifacts and rows later records added. The table inventory and the entity→table mapping are in **Consequences**.

## Decisions

### D1 — Identity columns

- Key on GitHub's **stable numeric ids** as `bigint`: `installation_id`, `repo_id`, `reviewer_id` — the integer `database_id`, **not** the GraphQL `node_id` (opaque base64, fatter index, no internal upside since these keys are never client-facing).
- We **never mint our own ids** or hold a GitHub-id↔our-id mapping table — that linkage would itself be the PII to protect and erase. GitHub ids are pseudonymous, stable across rename/transfer, and delivered in every webhook payload.
- Mutable labels (`repo_slug` = `owner/repo`, `reviewer_login`) are **non-key, purgeable** display columns, refreshed on webhook. They are the only directly-identifying data; the numeric ids are pseudonymous.
- **Names live only in mutable working tables.** The append-only audit log is **numeric-only** — it cannot be purged, so it must hold nothing identifying (ids resolved to names at admin read-time). A `store_display_names` config (default **on** for self-host) can null the working-table name columns for hosted minimization with no schema change.

### D2a — Primary keys

- Every tenant table: surrogate `id bigint generated always as identity` PK + a `UNIQUE` constraint on the full natural key. **FKs reference the surrogate**, never the wide SHA-laden tuple. `user_settings` (PK `gh_user_id`), `instance_version` (a single-row boolean PK) and `generation_attempt` (unique `run_id`) are the exceptions.
- The unique index **leads with `installation_id`** and then the parent key (`repo_id, pr_number` on `pull_request`; `pull_request_id` on its children; session-owned tables key on `review_session_id`) so one index serves uniqueness *and* every left-prefix read (tenant filter → per-PR). Every FK column also leads an index (migration 0060), since a parent delete scans the child for it.
- SHAs stored as `text` (hex) for M1 — debuggable, GitHub-native. `bytea` (raw) deferred as an index-size optimization.

### D2b — Tenancy enforcement

- `installation_id` on every row and in every query — the trust boundary (ADR 0016 #6) and the redesign-avoider, carried though M1 is single-tenant (`instance = tenant`). (Amended, see Amendments.)
- Enforced at the **application layer**: a scope-bound repository (`createTenantRepository` over a `RowScope` from `resolveScope`, `packages/persistence/src/stores/tenant.ts` and `scope.ts`) is the only DB surface — the raw drizzle handle hides behind the opaque `AppDatabase` (compile-time), context asserted (runtime). Scope context comes from the api's access gate (request path) or the job payload (worker path).
- **RLS deferred** to the hosted offering. It protects against a second tenant not present in an M1 instance, and costs policy + a second DB role + per-transaction `SET LOCAL` plumbing that fights connection pooling. It is **additive later** — the context-threading built now is exactly the input RLS consumes (`SET LOCAL app.installation_id`), so deferring wastes nothing and requires no schema change.

### D3 — Brief key is the `(base, head)` span

Three SHA roles, previously blurred under "baseline":

| Role | Meaning | Where | Column |
|---|---|---|---|
| **PR-base** | merge-base / base-branch tip — Brief's lower bound (whole-PR span) | Brief | `base_sha` |
| **head** | current PR head — upper bound | Brief + Delta | `head_sha` |
| **Checkpoint** | a reviewer's *prior head* at last submit — Delta's lower bound | Delta | `baseline_sha` |

- Brief keyed `(installation_id, repo_id, pr_number, base_sha, head_sha)` — its content is a function of **both** endpoints, so a head-only key would go stale (and force a mutating overwrite) when the base advances under a static head. Distinct column names (`base_sha` vs Delta's `baseline_sha`) prevent the PR-base/checkpoint collision in schema and queries.
- ADR 0012's index is the brief's address since its 2026-09-26 amendment: `head_index`, unique per pull request (`brief_pull_request_head_index_key`), the `rev` a link names. Storage identity = the span; the index addresses one brief on the PR.

### D4 — Diffs and the baseline snapshot (DiffSnapshot)

Two diffs, two lifetimes — this is how "no raw code in the DB" (ADR 0016 #10) and "durable baseline" (ADR 0006 #8) coexist (amended, see Amendments):

| Diff | Reachable on GitHub? | Storage |
|---|---|---|
| **Current-head diffs** (UI read path, one live span diff — ADR 0008 as amended) | Always (live head) | Fetched **on-demand by token**, ephemeral per-session cache, **never persisted** |
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
                                    --   (2026-07-06: the picker list's label;
                                    --   nullable — pre-column rows backfill on next event)
  state           text not null     -- open | closed | merged
  entry_comment_id bigint           -- branded Entry comment id (2026-07-05; delete+repost per
                                    --   ADR 0016 #3; dangling id self-heals by posting fresh)
  closed_at       timestamptz
  purge_after     timestamptz       -- nullable; the sweep target (retired, see Amendments)
  created_at / updated_at
  UNIQUE (installation_id, repo_id, pr_number)
```

Columns added since this block was grilled (`packages/persistence/src/schema/pull-request.ts`): `source` and `owner_user_id` (the url-box owner world, see Amendments; `installation_id` is nullable there), `base_sha`, `draft`, `author_login`, `github_updated_at`, `github_read_at`, `github_head_sha`, `github_unreachable_at`, `stack`, `stack_read_at`, and `row_version`, which every update bumps.

- **Clean mutable/immutable line:** `pull_request` is the one mutable lifecycle row; Brief/Delta/Checkpoint/Disposition and the other artifacts are immutable and **FK to it**.
- **Simplifies child keys:** children carry `installation_id` (tenant filter, no join) + a `pull_request_id` FK, replacing the loose `(repo_id, pr_number)`. Brief key → `(installation_id, pull_request_id, base_sha, head_sha)`.
- **No `repo` table in M1** — `repo_id`/`repo_slug` are columns here; a real `repo` table waits for per-repo config (M3).
- **Deletion boundary (ADR 0015 #6 / 0016 #11):** per-PR children FK `pull_request.id` **`ON DELETE CASCADE`**. Purge by PR = delete one row; by repo / installation = scoped predicate-delete on `pull_request` (cascades); sessions and tokens hold no installation and stay through offboarding (ADR 0043); audit retained, numeric-only. The DB guarantees erasure completeness (no forgotten child table). **No `installation→repo→pull_request` hierarchy in M1** — `instance = tenant` means one installation, so the small explicit purge routine is cheaper than a hierarchy we don't use.
- **Retention** (amended, see Amendments): `purge_after` is **nullable** — null while the PR is open *and* when retention is disabled / set to "never" (the row is never swept). Set to `closed_at + grace` at close per config. Sweep = `WHERE purge_after IS NOT NULL AND purge_after < now()`, backed by a partial index on `purge_after`.
- `activated_at` gates compute (Activation). (Dropped, see Amendments.)

### D6 — Artifact storage: inline `TEXT` + a code-level `ArtifactStore` boundary

- Each typed artifact table (`brief`, `delta`, `revision_narrative`, `comparison_marks`) holds its blob **inline** as `body TEXT` (passthrough, TOASTed) with `byte_size` + `created_at`, and the model-written three carry a nullable `body_version` (migration 0048). `hunk_span` holds its coordinates as `spans TEXT` with stamps only. **No shared blob table.**
- Blob read/write is routed through a code-level **`ArtifactStore`** keyed by an opaque content key (`packages/persistence/src/stores/artifact-store/`); the API's opaque key is the typed row's surrogate `id`. The deferred object-storage migration is a **localized code change** — `body` becomes an object-storage pointer and `ArtifactStore` redirects — touching one code path, not every call site (the "single boundary" of ADR 0008, realized in code rather than a table).
- **Rejected Option B** (shared content-addressed `artifact` table): the split is ~1:1 (cross-span/PR content dedup essentially never fires), and it **breaks D5's erasure cascade** — a PR purge cascades the typed rows but *orphans the blobs*, reintroducing the deferred ref-counted GC (or forcing a redundant second cascade + duplicated tenant columns). Inline keeps erasure atomic. Soft, deliberate deviation from ADR 0008's literal "one blob table" phrasing, justified by YAGNI (object storage + GC both deferred) + the code boundary giving equivalent migration locality.
- **Origin = columns**, not blob: `provider`, `model`, `effort` on `brief` + `delta` (surfaced on the Receipt — ADR 0013/0016 #7). The mechanical artifacts carry none.
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

The `disposition` shape below is the M1 grill's; the shipped row is session-owned (amended, see Amendments).

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
- **M1 covers only region-anchored risk-surface flags** (`region NOT NULL`). Playbook-item dispositions were deferred with the overlay; the playbook layer is parked (ADR 0035) and the overlay was never built.

### D8 — Carry-over overlay: M2 boundary, not materialized in M1

Superseded by ADR 0040 (see Amendments); the text stays as history.

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

A named SOC2-readiness boundary (ADR 0016 #12): one immutable, tenant-scoped emit per boundary. **Materialized in M1** (table + a single `audit(...)` emit interface), unlike the overlay. (Amended, see Amendments.)

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
- **Append-only by convention in M1**; DB `REVOKE UPDATE/DELETE` from the app role is the hosted hardening step (a commented-out statement in `packages/persistence/drizzle/0001_raw-sql-hardening.sql`).
- **M1 emits = the low-volume boundaries** — `generate` (worker write), `delete` (purge — ADR 0016 #11), `config`, and **auth *denials***. The **high-volume firehoses** (every-request auth-success, every-fetch `view`) are **excluded** — they'd make a never-purged table the largest one and never shrink; they belong in the **purgeable web access log** (route/method/status/latency — since observability v1 the structured stdout `evt: "api.access"` line, renamed from `evt: "read"`; see [ADR 0034](0034-observability-v1-logging-health.md)), which is also the better debugging tool. View sampling + retention revisited in the hosted program.

### D10 — graphile-worker boundary + the `generation` status projection

**Boundary (ADR 0015):**
- graphile-worker **owns its own schema** (`graphile_worker.*`) and runs **its own migrations on boot**; our Drizzle migrations never touch it. Two migration systems, two schemas.
- **Enqueue is transactional** with our writes (one tx: `upsert pull_request` + `add_job`).
- **Debounce/coalesce + single-flight via `job_key`; cancellation** by head-SHA compare. The **job payload carries scope context** → the worker resolves its `RowScope` from it. Two payload variants exist (`packages/types/src/jobs.ts`): installation `{installation_id, pull_request_id, head_sha}` and url-box `{owner_user_id, grant_id, pull_request_id, head_sha}`, plus trace context; the brief's base comes from the stored row, not the payload. graphile's own rows aren't tenant-scoped (shared infra; isolation is in the payload).

**`generation` — a CQRS status projection (NOT a queue, NOT a domain entity):**
```
generation
  id, installation_id, pull_request_id (FK CASCADE)
  kind         text not null   -- brief | delta | revision-narrative
  head_sha     text not null
  baseline_sha text            -- null for brief; checkpoint for delta
  status       text not null   -- pending | running | succeeded | failed | superseded | capped
  phase        text            -- fetching | redacting | generating | writing (optional)
  error_code   text            -- failure vocabulary code, CHECK-constrained (migration 0017)
  error_params jsonb           -- the code's template params, detail pre-sanitized
  attempts     int  not null default 0
  created_at / updated_at
  UNIQUE (installation_id, pull_request_id, kind, head_sha, baseline_sha)   -- NULLS NOT DISTINCT
```
`queued` was renamed `pending` (migration 0036) and `capped` added for a skip under the daily cap (migration 0015); the vocabulary is `GenerationStatuses` in `packages/types/src/generations.ts`. The row also carries `repo_config` (per-file repo-config origin, written before generation), the claim columns of the 2026-10-05 amendment and `triggered_at` (2026-10-19); `packages/persistence/src/schema/generation.ts` holds the CHECKs and indexes.
- Justified because graphile **deletes succeeded jobs** (so "job gone" can't mean "done") and is internal/untenanted. The web tier polls `generation`: `succeeded` → fetch the immutable artifact; `failed` → error + retry; `running`+`phase` → determinate progress (ADR 0006 #10). Mutable process state; the `brief`/`delta` rows stay immutable results.
- **No new locks, no DLQ.** (Amended, see Amendments.) Single-flight + the global concurrency cap live in graphile (`job_key` + advisory lock + worker `concurrency`); retries + the de-facto dead-letter are graphile's persisted failed jobs (`last_error`). `generation` only *reflects* — using it as a lock would be a second source of truth.

**Concurrency policy** (amended, see Amendments): Brief = one in-flight **per PR** (shared artifact; `job_key = pull_request_id`); Delta = one **per `(PR, reviewer)`** (`job_key = delta:{pr}:{reviewer}`).

### D11 — Reviewer auth: GitHub OAuth via a library, behind an identity-provider boundary

GitHub **is** the IdP — no passwords/MFA/credential storage. We build an **OAuth client + session/token store**, not an auth system, via a maintained framework-agnostic library (e.g. **Arctic** + own sessions, or **Better Auth** — both hand us the provider token, which we need). No auth SaaS on the self-host critical path; no heavy self-hostable IdP (Ory/Keycloak — against fewest-services). Since GitHub is our *only* IdP, a general auth SaaS would mostly wrap the single provider we integrate directly anyway.

The block below is the M1 grill's shape; the shipped table is `auth_session`, holding neither ciphertext (D15) nor an installation (ADR 0043), indexed on `expires_at` and `grant_id` (`packages/persistence/src/schema/auth-session.ts`). (Amended, see Amendments.)

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

- **The one dynamic secret in the DB.** Every static secret stays in env (ADR 0016 #7).
- **Encryption = direct, provider-resolved key + `key_ref`** — *not* a per-row envelope DEK: tokens are short-lived and deleted on expiry, so KEK rotation rides on natural token churn. Full envelope is the documented hardening reserved for any future *long-lived* secret.
- **Not FK'd to `pull_request`** (per reviewer). Cleared by: TTL sweep (`expires_at`) and logout; installation purge leaves it (ADR 0043).
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

- **Persisted, not recomputed on demand** — the GC argument D4 makes: a comparison span's
  *lower* bound is exactly the kind of SHA force-push GC makes unreachable; on-demand recompute
  would silently kill the Previous-Brief compare on older timeline points. Written by the worker
  at generation/pre-warm time (ADR 0024 §Generation).
- **Coordinates-only, unconditional — NOT code-bearing.** A mark is `file + side + line-range +
  change kind`, never line *content*. That keeps it outside D4's "no raw code in the DB" rule,
  so no persistence gate is needed; nothing persisted carries code. The FE paints marks onto
  diff content fetched live (D4's ephemeral path); removed-at-head content on a GC'd span
  degrades to an honest "content unavailable" — same degradation family as delta→full-Brief.
- **No origin columns** — mechanical output, not LLM output.
- Reviewer-agnostic by construction (SHA-pair key, no `reviewer_id`) — a returning reviewer's
  `checkpoint→head` marks are shareable by any reviewer at the same checkpoint, mirroring the
  delta-core/overlay split (D8).

### D14 — `user_settings` (added 2026-07-06)

Per-GitHub-user settings that must survive across sessions and installations. First column:
`default_installation_id`, the installation a multi-org reviewer's login binds to when it is
still in their accessible set (ADR 0016 #4 as amended); dropped by ADR 0043 (see Amendments).
The one setting today is `dismissed_version`, the release the user dismissed the version notice
for (migration 0047; `packages/persistence/src/schema/user-settings.ts`).

```
user_settings
  gh_user_id              bigint  PK      -- GitHub's numeric user id (same id sessions carry)
  default_installation_id bigint  null    -- dropped 2026-09-21 (ADR 0043)
  dismissed_version       text    null    -- added by migration 0047
  created_at / updated_at timestamptz
```

- **Deliberately NOT tenant-scoped** — the D2b exception, second after `audit_log`. A person
  spans installations (reviewer in one org, author in another; same human either way), so the
  row cannot carry `installation_id` as its key. Reads/writes go through a dedicated
  `userSettings` boundary, not the tenant repository — the type-level containment tests must
  treat it like `audit`, not like a tenant table.
- **Typed columns, never a JSON blob.** Every new setting is a column + migration, same
  closed-vocabulary discipline as the CHECK-constrained enums — the table must not rot into a
  preferences dump.
- **Dangling defaults degrade, never bind** (the retired login binding). Login binds the default
  only when it appears in the viewer's live accessible-installations set
  (`GET /user/installations`); otherwise falls back to the first accessible one. Installation
  purge (D5/ADR 0015) may leave a stale `default_installation_id` — harmless by construction,
  and overwritten on next switch.
- No FK to any tenant table (same isolation rationale as `audit_log`'s no-FK rule).

### D15 — `github_grant` (added 2026-07-23)

One row per GitHub user-to-server authorization; the ONLY holder of the encrypted GitHub
token pair. `reviewer_session` and `api_token` drop `gh_token_ciphertext` /
`gh_refresh_token_ciphertext` / `key_ref` and gain `grant_id` (FK, not null). Exists because
GitHub refresh tokens are single-use: two rows carrying copies of one pair race each other's
refresh and the loser is stranded; one physical copy makes that impossible.

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
  `user_settings`: the credential belongs to a GitHub *user* and spans installations. The
  referencing session and token rows hold no installation either since ADR 0043 (see
  Amendments).
- **Lifecycle: dies with its last referent**, deleted in the same transaction that removes the
  last referencing session/token row — no orphan sweeper. Refresh failure keeps per-channel
  postures (cookie deletes the session; a token row is never auto-deleted), so a dead grant
  may linger behind a dead-but-unrevoked token — inert ciphertext, harmless. The converse
  also holds (noted 2026-07-23): a soft-REVOKED token keeps its `grant_id`
  (NOT NULL FK; the row stays listable), so revocation retains the — possibly still-live —
  encrypted pair until installation purge. Accepted: MergeBrief-side revoke severs access
  through this instance; actually invalidating/releasing the GitHub credential is the
  "grant revocation hygiene" follow-up (outbound per-token DELETE).
- **Migration backfill dedups by exact ciphertext match** (mint copied ciphertext verbatim,
  so a not-yet-diverged token matches its source session byte-for-byte and joins its grant);
  unmatched rows get their own grant.

## Consequences

**Table inventory (materialized; `packages/persistence/src/schema/`):**

| Table | Kind | Notes |
|---|---|---|
| `pull_request` | mutable aggregate root | retention/cascade anchor; `closed_at` drives the opt-in sweep; `source` + `owner_user_id` pick the scope world |
| `brief` | immutable artifact (inline `body`) | key `(installation_id, pull_request_id, base_sha, head_sha)` + origin + `head_index` (unique per PR) / `commit_count`, `repo_config`, `anchor_state`/`anchor_reason`, `carried_chunk_ids`, `used_group_ids`, `body_version`, `session_{chunk,group,flag}_count` |
| `delta` | immutable artifact (inline `body`) | key `(…, baseline_sha, head_sha)`, reviewer-agnostic core |
| `revision_narrative` | immutable artifact (inline `body`) | 1:1-optional with a `brief` row (FK, cascades); key `(…, prev_head_sha, head_sha)` (D12) |
| `comparison_marks` | immutable artifact (inline `body`) | mechanical, coordinates-only, no origin; key `(…, baseline_sha, head_sha)` (D13) |
| `hunk_span` | immutable artifact (coordinates only) | key `(installation_id, pull_request_id, baseline_sha, head_sha)`; the durable carry-over hop, written pre-model like `comparison_marks` (ADR 0040); column `spans` |
| `checkpoint` | per-reviewer position | `last_submitted_sha`; webhook-driven |
| `disposition` | session-owned anchored decision | key `(review_session_id, file_path, attribute, region_start, region_end)`; `carry_status`, `evidence_status`, `evidence_kind`, `evidence_ref` (D7 as amended) |
| `review_session` | per-(reviewer × brief) workspace | key `(installation_id, brief_id, reviewer_id)`; FK `brief` cascades, so `pull_request` still reaches it; holds `review_outcome` and `carried_item_count` |
| `review_draft_comment` | session-owned | `kind` (line/file), file/side/`start_side`/line range + body + `status` + `anchor_status`; `carried_from_session_id`/`carried_from_comment_id`; `publish_claim`/`publish_claimed_at` |
| `review_read_mark` | session-owned | `chunk_id` |
| `review_group_reclassification` | session-owned | overrides only; Brief supplies defaults |
| `review_submitted_review` | session-owned | GitHub review ids, for conversation reconciliation |
| `inbox_archive` | per-reviewer view state | key `(installation_id, pull_request_id, reviewer_id)`, nulls not distinct for the url world; FK `pull_request` cascades; nullable `head_sha` anchors the archive on the latest brief's head, lifted once a brief at a new head exists |
| `generation` | mutable CQRS status projection | poll target and run claim; not a domain entity |
| `generation_attempt` | spend ledger | one row per paid run, unique `run_id`, no FK to `generation`; the daily cap's counter |
| `audit_log` | append-only boundary | numeric-only, no FKs; retention configurable (`AUDIT_RETENTION_DAYS`, unset = forever); `source` marks the scope world |
| `user_settings` | per-user settings | NON-tenant-scoped (D14); keyed `gh_user_id`; typed columns only |
| `auth_session` | session (cookie channel) | credential via `grant_id` FK (D15); no installation (ADR 0043) |
| `api_token` | user-managed credential (Bearer channel) | ADR 0016 #4 as amended; hash-resolved, mint-chosen expiry, soft-revoke, `scope`; credential via `grant_id` FK (D15); no installation |
| `github_grant` | secret-bearing | the ONE encrypted-token table (D15); NON-tenant-scoped; dies with last referent |
| `instance_version` | single row | the version that last booted and applied the schema (ADR 0045) |

`graphile_worker.*` is owned and migrated by graphile-worker — not ours.

**Deferred (additive migrations, zero rewrite):** a `repo` table (per-repo config → M3).

**Entity → table (anchored to ADR 0008 / CONTEXT):** Brief→`brief`, Delta core→`delta`, Carry-over→the Review Session rows plus `hunk_span` (ADR 0040), Checkpoint→`checkpoint`, Disposition→`disposition`, Revision narrative→`revision_narrative` (ADR 0024), Revision changes / comparison marks→`comparison_marks` (ADR 0024).

**Confirmations (per the task):**
- **No raw diffs or code persisted.** Current-head diffs are fetched **on-demand by token**, cached per session, never in the DB (D4). The baseline snapshot was never built (see Amendments), so nothing code-bearing is stored.

**Other consequences:**
- Two migration systems coexist: Drizzle (our schema) + graphile-worker (its own schema).
- `installation_id` on every installation-world tenant row from day one (the redesign-avoider); NULL on url-box owner rows and absent from credential rows (D2b as amended); RLS is an additive hosted hardening, not a schema change (D2b).
- All blob access goes through one code-level `ArtifactStore`; the object-storage migration is localized there (D6).
- Erasure (purge by PR / repo / installation) is mostly an FK cascade off `pull_request`; sessions and tokens hold no installation and stay through offboarding (ADR 0043), swept only by expiry; `audit_log` is retained, numeric-only (D5/D9).

## Model vocabulary (persistence-domain terms)

Collected here so the model terms live next to the schema; `CONTEXT.md` stays product/UX-facing (a reviewer never sees these). Product terms (Disposition, Submit, …) live in `CONTEXT.md`.

- **Span artifact** — a Brief or Delta identified by two SHA endpoints `[lower, head]`.
- **Brief base** (`base_sha`) — the PR-base endpoint; a Brief covers the whole PR, `base→head`.
- **Checkpoint baseline** (`baseline_sha`) — a Delta's lower endpoint = the reviewer's **Checkpoint** (a prior head). Distinct from the Brief base.
- **Prior briefed head** (`prev_head_sha`) — a Revision narrative's lower endpoint = the head of the immediately previous Brief. The third SHA role; neither Brief base nor Checkpoint baseline (D12).
- **Comparison marks** — the mechanical, coordinates-only changed-line sidecar for a comparison span `(baseline_sha, head_sha)`; source of truth for FE highlighting; table `comparison_marks` (D13). Not code-bearing; not an LLM artifact.
- **Hunk span**: the coordinates-only record of a Brief-to-Brief span's hunks, the durable hop carry-over remaps through; table `hunk_span` (ADR 0040).
- **Delta core** — the shared, reviewer-agnostic code-change narrative for a span (the expensive LLM part); table `delta`.
- **Generation (projection)** — the mutable CQRS status mirror of a worker job (`pending` / `running` / `succeeded` / `failed` / `superseded` / `capped`); table `generation`; not a domain artifact.
- **Tenant / installation** — the trust-boundary unit; `instance = tenant`; every installation-world row scoped by `installation_id`. The url-box owner world scopes by `pull_request.owner_user_id` instead (see Amendments).

## Amendments

### 2026-07-04: `activated_at` dropped; D12 and D13 added

Pre-build validation against ADRs 0020/0021/0024. `activated_at` is dropped from D5: the lazy compute-on-first-click gate it encoded was retired by ADR 0020; Trigger is eager-on-push, the deep-link click is pure Entry, so there is no gating state to store. Re-adding a `first_entered_at` later (if ADR 0020's `on-first-view` escape hatch is ever exercised) is an additive migration; first-entry *analytics* belong in the purgeable web access log (D9), never here. **D12** (`revision_narrative`) and **D13** (`comparison_marks`) are added for the artifacts ADR 0024 introduced after this schema was grilled.

### 2026-07-05: Entry comment id, one `generate` job, and the token model

D5 gains `entry_comment_id`. D10's per-kind job keys are superseded by one job kind, `generate`, `job_key = generate:{pull_request_id}`: every generation-relevant webhook event enqueues it (with `run_at = now + debounce`; the job key with `preserve_run_at` is the debounce, see `packages/persistence/src/stores/ingest.ts`), and the worker derives the artifact bundle from state at execution time (brief + marks + narrative + one delta core per distinct checkpoint SHA, huge-span rule per span). Per-kind delta job keys predate the core/overlay hardening and are retired. A global cap (graphile `concurrency` + a provider rate-limit budget) still bounds total parallel generations; single-flight per PR is enforced by `job_key`, not `generation`. `generation.status` gains a terminal `superseded` value (mid-call abort on head advance, ADR 0006 #6 as amended); web enqueue writes the one row it can know (`kind: brief`, pending), the worker upserts rows for the artifacts it derives. D11 gains `gh_refresh_token_ciphertext` (expiring user tokens + rotating refresh).

### 2026-07-05: Auth library and token model resolved

D11: the library is **`@octokit/oauth-app`** (GitHub-official; we are GitHub-only, so its native handling of **expiring user access tokens (~8h) + rotating refresh tokens (~6mo)** beats a generic OAuth lib; Arctic stays the fallback, Better Auth rejected: it wants to own session tables). Both tokens stored, both encrypted (`encryptToken`, own columns). Refresh is **lazy at next use and serialized per session** (`SELECT … FOR UPDATE`; GitHub refresh tokens are single-use, concurrent requests must not race the exchange); any refresh failure → delete session → redirect re-login (the degradation path). Session ceiling = GitHub's rotation limit + the TTL sweep; no extra cap.

### 2026-07-06: D14 `user_settings` added

The first deliberately NON-tenant-scoped row kind besides `audit_log`, keyed by GitHub user id, so a reviewer's default installation survives across sessions.

### 2026-07-23: D15 `github_grant` added

The GitHub credential pair moves out of `reviewer_session`/`api_token` into one grant row per authorization, referenced by FK, making the token-refresh divergence unrepresentable (ADR 0016 #4 as amended). The inventory also now records `api_token`, which this record had missed.

### 2026-08-17: Review Session tables, the audit vocabulary and the disposition key

Per [ADR 0040](0040-review-session-server-store.md).

- **Five session tables and `hunk_span`** join the inventory: `review_session`, `review_draft_comment`, `review_read_mark`, `review_group_reclassification`, `review_submitted_review`, and the coordinates-only `hunk_span` artifact (the durable carry-over hop, written pre-model like `comparison_marks`).
- **D7.** `disposition` is re-keyed to the session: `(review_session_id, file_path, attribute, region_start, region_end)`, with `decided_at_sha`, `pull_request_id` and `reviewer_id` dropped and the carry columns added (`carry_status`; later `evidence_status`, `evidence_kind`, `evidence_ref`, migrations 0020, 0021, 0029). The review-session store writes rows (`packages/persistence/src/stores/review-session.ts`).
- **D8.** The carry-over overlay is realized by those session rows plus `hunk_span`, not a `delta_overlay` table (see the 2026-10-20 entry).
- **D9.** `action`'s eight-value vocabulary is replaced by **`operation`** (the Product Operation descriptor id), joined by `classification`, `channel`, `credential_id`, `outcome`, `request_id`, `client`, and a nullable `caller_ip`; the row no longer carries an HTTP status. Coverage is every **action** plus **denials**, never a read, emitted from the single `productRouter.action()` choke point rather than hand-placed sites. The metadata rule inverts to **open keys, closed values** (token, number, boolean): no bodies, no free text, no truncation. "Never purged" becomes a policy knob: `AUDIT_RETENTION_DAYS` (unset = keep forever = default, 30-day floor when set), swept by the system's first scheduled worker job, so the numeric-only rule rests on **self-host grounds**: adopters will run the "never" setting, and `docs/self-host/operations.md` tells every adopter to `pg_dump` the volume it says holds this table, so anything stored here lands in every backup copy they keep. `AUDIT_PRIVATE_WRITES` (default on) can drop private writes; external writes and denials are never switchable. `caller_ip` is populated only under an operator PII flag, default off.
- `brief` gains `carried_chunk_ids` (the frozen chunk ids `stitchBrief` already computes); `api_token` gains `scope` (`read` / `private-write` / `external-write`, CHECK-constrained, chosen at mint, immutable); and `reviewer_session` renames to `auth_session` (migration 0018), clearing the collision with the product term.

### 2026-09-21: Credential rows hold no installation

Per [ADR 0043](0043-no-credential-holds-a-current-installation.md). D2b: three tables carry no `installation_id`: `audit_log` (D9), `user_settings` (D14), and the credential rows `auth_session` and `api_token`, whose columns migration 0042 dropped. A credential names its reviewer; every request resolves the installation from its repository. D14: `default_installation_id` is dropped by the same migration; the table keeps its key and stamps, and the next setting is a typed column plus a migration and its own store. Sessions and tokens outlive installation offboarding.

### 2026-09-25: `inbox_archive` added

Per-reviewer view state keyed `(installation_id, pull_request_id, reviewer_id)`, nulls not distinct for the url world; FK `pull_request` cascades; `head_sha` (nullable) anchors the archive on the latest brief's head at the time, and the inbox predicate lifts it once a brief at a new head exists, so nothing sweeps a stale row.

### 2026-10-05: The `generation` row may act as a lock

D10: graphile's job lock outlives a killed worker by hours and cannot stop a second job for the same head, so a run now **claims** its `generation` row: `run_id` (uuid) plus `lease_expires_at`, a 2-minute lease on the database clock the holder renews. Only the holder advances, finishes or releases the row; a live lease keeps ingest from re-projecting it, a lapsed one frees it. Each paid claim also writes one `generation_attempt` row (`run_id` unique, `generation_id` with no FK, `started_at`), and the daily cap counts those by `started_at`: `attempts`, the row's `created_at` window and its status missed graphile retries, re-queued rows' earlier runs and later-day re-runs. A paid run that takes no claim, one over a stored brief, writes its `generation_attempt` row at its first provider call under the same cap lock. The `generate` job's graphile `max_attempts` is 3, since every retry is paid, and the row's `claims` column holds a head to 3 claims between triggers across every job that claims it. A claim also queues a per-head `recover-generation` job for after the lease in the same transaction, so a claim whose worker died is taken over once the lease lapses rather than when graphile frees the dead job's lock, which may never happen: an `add_job` on its key detaches it with its attempts spent.

### 2026-10-17: The baseline snapshot was never built

D4: no code wrote or read `diff_snapshot`, and `PERSIST_BASELINE_SNAPSHOT` gated nothing. Both are removed (migration 0058), so every instance runs the OFF posture D4 describes: a checkpoint span GitHub can no longer serve gets no delta, and the view falls back to the full Brief. Nothing code-bearing is stored. Building the snapshot later is a new table and a new decision. The D4 text stays as history.

### 2026-10-17: Retention sweeps by `closed_at`

D5: retention is opt-in through `PR_RETENTION_DAYS`; unset keeps every pull request forever. A daily, instance-wide worker job deletes the rows whose `closed_at` is older than the window at run time, so a row closed before retention was enabled is covered too, with no per-row deadline to backfill. `purge_after`, its partial index and its CHECK are retired (migration 0057); a partial index on `closed_at` (`WHERE closed_at IS NOT NULL`) backs the sweep, and the CHECK becomes `state <> 'open' OR closed_at IS NULL`. The D5 text stays as history.

### 2026-10-18: `caller_ip` removed from the audit log

D9: `caller_ip` and `AUDIT_CALLER_IP` are removed (migration 0062), column and CHECK together. The api is reached only through the web tier's proxy, so the socket address it recorded was the web container's for every caller, never the visitor's. The row holds no address of any kind.

### 2026-10-19: `triggered_at` names a PR's current brief row

D10: `triggered_at` (timestamptz) records when an accepted trigger last named a row's head. Ingest stamps it with `clock_timestamp()`, after the trigger holds the pull request's row lock, on an event GitHub ordered (`updated_at`) or a live read, held rows and triggers a stored brief covers included; a review event, which may carry a head the PR has left, stamps nothing. The worker's own projection never moves it, and a row the worker creates before any trigger named its head starts at the epoch. A PR's current brief row is the newest `triggered_at`, whatever its status, never the newest `updated_at`: an older head's run that finishes after a newer push writes a fresher `updated_at`, and a head pushed back to over its stored brief may sit superseded. Migration 0064 backfills live rows from `updated_at` and superseded rows below them.

### 2026-10-20: `installation_id` is nullable: the url-box owner world

D2b's "`installation_id` on every row" has a second scope world beside it, the url-box owner world of ADR 0047. A pull request its owner pasted is anchored on `pull_request.owner_user_id` with a NULL `installation_id`, CHECK-paired with `pull_request.source` (`installation` / `url`) by `pull_request_owner_shape`, and a partial unique index `pull_request_owner_natural_key` keeps the two worlds' rows apart for one `(repo, number)` (`packages/persistence/src/schema/pull-request.ts`, migration 0033). Every per-PR child's `installation_id` is nullable for the same reason (`tenantColumns` in `packages/persistence/src/schema/columns.ts`), natural keys are NULLS NOT DISTINCT, and `audit_log` carries `source` under `audit_log_source_shape`. The worker payload has a url-box variant carrying `owner_user_id` and `grant_id` (`packages/types/src/jobs.ts`). Every read and write resolves one `RowScope` (`packages/persistence/src/stores/scope.ts`); owner-world child reads add a `pull_request` semi-join for isolation.

### 2026-10-20: D8's `delta_overlay` is superseded by ADR 0040

No `delta_overlay` table exists and none is planned. Carry-over is realized by the session-owned rows: `disposition.carry_status`, `review_draft_comment.anchor_status` and `carried_from_*`, `review_session.carried_item_count` and `brief.carried_chunk_ids`, remapped through `hunk_span` hops in memory on read (`packages/persistence/src/stores/carry-over.ts`). The reviewer-agnostic delta core key D8 required still holds. "Delta overlay" is an avoid-term in `CONTEXT.md`.

### 2026-10-20: D7's `disposition` body as shipped

The shipped row is keyed `(review_session_id, file_path, attribute, region_start, region_end)`, takes its SHA from the session's Brief, and carries `carry_status`, `evidence_status`, `evidence_kind` and `evidence_ref` beside `decision`, `reason` and `decided_at`; there is no `pull_request_id`, `reviewer_id` or `decided_at_sha` column (`packages/persistence/src/schema/disposition.ts`). Rows are written by the review-session store, not deferred to a later milestone. The anchored-by-coordinates principle holds.
