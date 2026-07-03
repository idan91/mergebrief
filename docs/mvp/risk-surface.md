# Risk Surface Library

Factual attributes attached to a chunk during categorization. Attributes only — never verdicts. Severity (when needed) emerges from the *combination* of attributes (e.g., `touches-auth` + `no-tests` + `widely-imported` together = deep-review signal) without any verdict applied.

This file is the source of truth for Phase 1 hand-labeling. Per-PR briefs reference attribute names from here.

**Structure: three buckets.** Hand-labeler asks one question per bucket per chunk.

**Status:** initial starter set. Expand opportunistically as labeling hits gaps.

---

## Bucket 1 — About the CODE

Properties of the code that exists in the file/chunk being changed (independent of what the diff does).

### `no-tests`
The changed code path has no test coverage in the repo.
- **Detect:** search for the changed file/function in `**/*.test.*`, `**/__tests__/**`, etc. Absence = attribute applies.
- **Playbook implication:** any change to this chunk requires reviewer to verify behavior manually or via fixture. Triggers extra scrutiny on `bugfix`, `logic-refactor`, `new-feature`.

### `no-types`
The changed code lacks type annotations or is heavily `any`-typed (TypeScript) / dynamically typed without runtime validation.
- **Detect:** look for `any`, `unknown` without narrowing, untyped function params, missing return types.
- **Playbook implication:** reviewer must reason about types in their head; verify runtime safety claims explicitly.

### `legacy-area`
The file/module carries a marker indicating legacy status — TODO/FIXME comments, `@deprecated` annotations, deprecation notices in CODEOWNERS, or a dedicated `legacy/` directory.
- **Detect:** grep for `@deprecated`, `TODO:`, `FIXME:`, `legacy/` paths.
- **Playbook implication:** changes here may be inconsistent with current patterns; reviewer should verify the change doesn't entrench the legacy pattern further.

### `dense-logic`
The chunk has high branching factor (deep nesting, multiple conditions per line, state-machine logic).
- **Detect:** count nested `if`/`switch`/`match` levels, ternary depth. Threshold (rough): ≥3 levels of nesting OR ≥5 distinct branches in the chunk.
- **Playbook implication:** edge cases easy to miss; reviewer should enumerate input space and trace each branch.

---

## Bucket 2 — About the CHANGE

Properties of what this specific diff does (independent of where it sits in the codebase).

### `touches-auth`
The diff modifies authentication, authorization, session, or identity code.
- **Detect:** imports/calls into auth modules (`@auth/*`, `passport`, `next-auth`, `clerk`, `withAuth`, JWT libraries), session middleware, identity-token handling.
- **Playbook implication:** auth changes invalidate prior security assumptions. Reviewer must verify the new code doesn't widen access, leak tokens, or skip checks under any input.

### `mutates-state`
The diff modifies code that writes to persistent state — DB writes, file writes, mutations to globals, cache invalidations.
- **Detect:** `insert`/`update`/`delete`/`upsert` calls, `fs.write*`, mutations to module-level variables, cache.set / invalidation calls.
- **Playbook implication:** state mutations affect callers/observers downstream. Reviewer must verify ordering, idempotency, concurrency, and rollback semantics.

### `removes-validation`
The diff weakens a check, guard, type narrowing, schema validator, or assertion.
- **Detect:** lines deleted that contained `if (!...)`, `throw`, `assert`, `zod`/`yup` schema constraints, type guards, range checks.
- **Playbook implication:** weakening a check requires explicit justification. Reviewer must confirm the input space that was previously rejected is now safe to accept (or is rejected elsewhere).

### `relaxes-permissions`
The diff broadens an access check, role check, scope, or permission boundary.
- **Detect:** changes from `admin-only` → `member-or-admin`, role list additions, scope additions, ACL widening.
- **Playbook implication:** every previously-rejected actor is now potentially admitted. Reviewer must enumerate who newly has access and confirm intent.

### `widens-error-handling`
The diff broadens a catch / swallows more errors / converts errors to warnings or no-ops.
- **Detect:** `catch (Exception)` → `catch (Throwable)`, removal of `throw`, addition of `try { ... } catch { /* ignore */ }`, conversion of `error` → `warn` in logs.
- **Playbook implication:** errors that previously surfaced may now be hidden. Reviewer must verify each broader catch is intentional and that the swallowed error can't mask correctness bugs.

### `adds-feature-flag`
The diff introduces or modifies a feature-flag check.
- **Detect:** new flag-client calls, new constants in a flags config file.
- **Playbook implication:** reviewer must verify the flag's default state, rollout plan, and cleanup obligation (a flag added without a removal plan becomes permanent debt).

### `new-dependency`
The diff adds a new **direct** dependency to a package manifest.
- **Detect:** a manifest diff (`package.json` dependencies/devDependencies, `requirements.txt`,
  `Cargo.toml`, `go.mod`, …) gains a package that was not there before. Version-only bumps do
  **not** fire (those are the `lib-bump` / `dependency-update` Categories). Mechanically
  confirmable from the diff — the validator drops the attribute (warn-and-drop) if no manifest
  line actually adds a new package.
- **Playbook implication:** reviewer verifies the dependency earns its place — stdlib or an
  existing dep couldn't do the job; license, maintenance, and footprint acceptable. Most
  informative when the group's Dominant Category is *not* dep-related: a package appearing
  incidentally inside a `new-feature`/`bugfix` group is the attention signal (combination
  reading, as always — no verdict).

### `new-abstraction`
The diff introduces a new named abstraction — class, interface, service, wrapper, layer of
indirection — that did not exist before.
- **Detect:** new abstraction definitions in the diff (not relocations — `pure-move` /
  `move-with-edits` groups don't fire this). Observational only: fires on *existence*, never
  judges whether the abstraction is warranted.
- **Playbook implication:** reviewer asks whether the abstraction earns its place — does an
  existing pattern or utility already cover it; is one call site enough to justify a layer.

### `comment-contradicts-code`
A comment or docstring in the diff appears to disagree with what the adjacent code does.
- **Detect:** model-observed — compare docstrings/comments against the implementation in the
  same chunk; when firing, cite both sides (the comment line and the code line). If either
  side is outside the diff's visible context, stay silent. Expected to carry `uncertain` more
  often than other attributes; first-to-drop under the deprecation rule if it proves noisy.
- **Playbook implication:** reviewer reads both and resolves which side is right — fix the
  code or fix the comment. Checkable in seconds; the flag routes attention, never asserts
  which side is wrong.

---

## Bucket 3 — About the BLAST RADIUS

Properties of what depends on the changed code (independent of what the change is).

### `external-io`
The diff calls external services, network endpoints, filesystem, OS, or third-party APIs.
- **Detect:** `fetch`/`axios`/`http` calls, `fs.*` (beyond reads of bundled assets), `child_process`, SDK calls to third-party providers (Stripe, AWS, etc.).
- **Playbook implication:** external calls add failure modes (network errors, timeouts, partial state). Reviewer must verify retry/timeout/idempotency and what happens on outage.

### `cross-service`
The chunk is part of a contract shared with another service — RPC, message-queue payloads, shared schemas, public API surfaces.
- **Detect:** changes to OpenAPI/GraphQL schema files, gRPC `.proto`, message-queue payload shapes, exported public API surfaces consumed by other repos.
- **Playbook implication:** change is consumed elsewhere. Reviewer must verify backward compatibility, version negotiation, and consumer-side migration plan.

### `schema-adjacent`
The diff is near (but not in) a schema definition, migration, or persistence layer.
- **Detect:** the file is in or imports from `db/`, `schema/`, `models/`, `migrations/`, ORM definition files.
- **Playbook implication:** even if the diff itself doesn't change a schema, behavior may depend on schema invariants. Reviewer must confirm the change is consistent with the schema's intent.

### `hot-path`
The chunk lives on a high-traffic / latency-critical / request-handling path.
- **Detect:** the chunk is in (or directly called by) a middleware, request handler, hot loop, or path annotated `// hot-path` / per-team designation. (Hand-labeler judgment required when no annotation exists.)
- **Playbook implication:** performance regressions amplify. Reviewer must verify no new allocations, sync I/O, or unbounded loops on this path.

### `widely-imported`
The modified API has many call sites across the repo.
- **Detect:** count call sites of the modified function/symbol. Threshold (rough): ≥10 importers OR exported from a package's public entry point.
- **Playbook implication:** any contract change ripples broadly. Reviewer must enumerate all callers and confirm each tolerates the new behavior.

### `release-imminent`
The PR targets a branch or release that ships soon (within ~24h), or the PR is marked as a backport/hotfix.
- **Detect:** PR title contains `[backport]`/`[hotfix]`, target branch is a release branch, PR description references an imminent ship date.
- **Playbook implication:** rollback window is short; reviewer should bias toward smaller-surface fixes and explicit revert plans.

---

## How Attributes Compose

Single attributes are factual descriptions. Combinations are signals:

- `touches-auth` + `no-tests` + `widely-imported` → security-critical change with no safety net and broad blast radius. Deep review required.
- `mutates-state` + `external-io` + `release-imminent` → partial-failure surface area on a tight schedule. Reviewer should focus on idempotency and rollback.
- `removes-validation` + `cross-service` → tightening a contract someone else relies on. Migration plan required.

The brief shows attributes as a flat list per chunk; the reviewer reads the combination and makes the judgment. No verdict is asserted by the tool.

---

## Parked candidates (do not label with these)

Registered here so labelers don't reinvent them; not valid tokens until unblocked. See ADR 0026.

- **`unresolved-reference`** — a string-keyed reference (feature-flag name, env var,
  translation key, route string, queue name) that doesn't resolve against the repo's
  registries. The genuinely un-linted hallucinated surface: compilers catch unresolved
  *imports* pre-review, nothing catches these. Needs per-repo registry knowledge + repo
  context — parked until the `ContextSource` seam exists (ADR 0014). Note: plain
  `unresolved-import` was **rejected**, not parked — compilers/CI own that lane (ADR 0026).
- **`diverges-from-sibling-pattern`** — solves the task unlike sibling files do. Needs
  sibling *selection* (a judgment with bad FP shape: accusing the author of inconsistency
  based on our sampling choice) plus repo file fetching (`ContextSource`, escalation-tier per
  ADR 0010/0014), and intentional divergence is routine in refactors. Deferred on evidence +
  FP-shape grounds.

---

## When to Add a New Attribute

During Phase 1 labeling, add an attribute to the library when:
1. The same observable pattern appears in ≥2 PRs.
2. The pattern is not already covered by an existing attribute.
3. The pattern has a clear playbook implication — adding the attribute would change what a reviewer should do.

Drop an attribute if it never fires across 10+ PRs, or if it always co-fires with another attribute (redundant).
