# Risk Surface Library

Factual attributes attached to a chunk during categorization. Attributes only, never verdicts. Severity (when needed) emerges from the *combination* of attributes (e.g., `touches-auth` + `no-tests` + `widely-imported` together = deep-review signal) without any verdict applied.

This file is the source of truth for the Risk Surface vocabulary. The Brief schema's attribute enum mirrors it, and every brief names its attributes from here.

**Structure: three buckets.** Each bucket asks one question per chunk.

**Status:** starter set. Expand when real PRs show a gap (see "When to Add a New Attribute").

**Floor attributes.** Five attributes form the de-emphasis **floor**: `touches-auth`, `removes-validation`, `relaxes-permissions`, `adds-secret`, `changes-package-source`, marked **Floor: yes** below. A repo's `.mergebrief/policy.yaml` can de-emphasize (quiet, never suppress) any non-floor attribute's display; floor attributes cannot even be de-emphasized, and a de-emphasized attribute co-firing on a chunk with a floor attribute renders un-quieted (the combination is the signal).

---

## Bucket 1: About the CODE

Properties of the code that exists in the file/chunk being changed (independent of what the diff does).

### `no-tests`
The changed code path has no test coverage in the repo.
- **Detect:** search for the changed file/function in `**/*.test.*`, `**/__tests__/**`, etc. Absence = attribute applies.
- **Cleared by the pipeline:** after validation the pipeline removes the attribute, and its note, from every chunk the model labels `config` and from every chunk whose path it exempts, judged by the file name (case-insensitive): style sheets (`.css`, `.scss`, `.sass`, `.less`), Markdown (`.md`, `.markdown`), `.svg`, `.html`, `.htm`, static image, font, audio, video and PDF files, configuration (`.yml`, `.yaml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.json`), container files (`Dockerfile`, `Containerfile`, `Dockerfile.*`, `*.dockerfile`), Make files (`Makefile`, `GNUmakefile`, `*.mk`) and shell scripts (`.sh`, `.bash`, `.zsh`, `.fish`). `.mdx`, `.vue` and test sources (`*.test.ts` and kin) keep it as observed; a fixture with a listed extension under `test/` loses it like any other file.
- **Reviewer implication:** any change to this chunk requires reviewer to verify behavior manually or via fixture. Triggers extra scrutiny on `bugfix`, `logic-refactor`, `new-feature`.

### `no-types`
The changed code lacks type annotations or is heavily `any`-typed (TypeScript) / dynamically typed without runtime validation.
- **Detect:** look for `any`, `unknown` without narrowing, untyped function params, missing return types.
- **Reviewer implication:** reviewer must reason about types in their head; verify runtime safety claims explicitly.

### `legacy-area`
The file/module carries a marker indicating legacy status: TODO/FIXME comments, `@deprecated` annotations, deprecation notices in CODEOWNERS, or a dedicated `legacy/` directory.
- **Detect:** grep for `@deprecated`, `TODO:`, `FIXME:`, `legacy/` paths.
- **Reviewer implication:** changes here may be inconsistent with current patterns; reviewer should verify the change doesn't entrench the legacy pattern further.

### `dense-logic`
The chunk has high branching factor (deep nesting, multiple conditions per line, state-machine logic).
- **Detect:** count nested `if`/`switch`/`match` levels, ternary depth. Threshold (rough): ≥3 levels of nesting OR ≥5 distinct branches in the chunk.
- **Reviewer implication:** edge cases easy to miss; reviewer should enumerate input space and trace each branch.

---

## Bucket 2: About the CHANGE

Properties of what this specific diff does (independent of where it sits in the codebase).

### `touches-auth`
**Floor: yes**. Cannot be de-emphasized by repo policy.

The diff modifies authentication, authorization, session, or identity code.
- **Detect:** imports/calls into auth modules (`@auth/*`, `passport`, `next-auth`, `clerk`, `withAuth`, JWT libraries), session middleware, identity-token handling.
- **Reviewer implication:** auth changes invalidate prior security assumptions. Reviewer must verify the new code doesn't widen access, leak tokens, or skip checks under any input.

### `mutates-state`
The diff modifies code that writes to persistent state: DB writes, file writes, mutations to globals, cache invalidations.
- **Detect:** `insert`/`update`/`delete`/`upsert` calls, `fs.write*`, mutations to module-level variables, cache.set / invalidation calls.
- **Reviewer implication:** state mutations affect callers/observers downstream. Reviewer must verify ordering, idempotency, concurrency, and rollback semantics.

### `removes-validation`
**Floor: yes**. Cannot be de-emphasized by repo policy.

The diff weakens a check, guard, type narrowing, schema validator, or assertion.
- **Detect:** lines deleted that contained `if (!...)`, `throw`, `assert`, `zod`/`yup` schema constraints, type guards, range checks.
  Mechanically gated (warn-and-drop): the validator drops the attribute when the chunk deletes
  no lines; a purely additive chunk (e.g. a parser accepting a new optional field) is not
  weakened validation. Deliberate trade: an added early-return can weaken a guard without
  deleting lines; that rare shape is sacrificed to kill the observed false-positive class.
- **Reviewer implication:** weakening a check requires explicit justification. Reviewer must confirm the input space that was previously rejected is now safe to accept (or is rejected elsewhere).

### `relaxes-permissions`
**Floor: yes**. Cannot be de-emphasized by repo policy.

The diff broadens an access check, role check, scope, or permission boundary.
- **Detect:** changes from `admin-only` → `member-or-admin`, role list additions, scope additions, ACL widening.
- **Reviewer implication:** every previously-rejected actor is now potentially admitted. Reviewer must enumerate who newly has access and confirm intent.

### `widens-error-handling`
The diff broadens a catch / swallows more errors / converts errors to warnings or no-ops.
- **Detect:** `catch (Exception)` → `catch (Throwable)`, removal of `throw`, addition of `try { ... } catch { /* ignore */ }`, conversion of `error` → `warn` in logs.
- **Reviewer implication:** errors that previously surfaced may now be hidden. Reviewer must verify each broader catch is intentional and that the swallowed error can't mask correctness bugs.

### `adds-feature-flag`
The diff introduces or modifies a feature-flag check.
- **Detect:** new flag-client calls, new constants in a flags config file.
- **Reviewer implication:** reviewer must verify the flag's default state, rollout plan, and cleanup obligation (a flag added without a removal plan becomes permanent debt).

### `new-dependency`
The diff adds a new **direct** dependency to a package manifest.
- **Detect:** a manifest diff (`package.json` dependencies/devDependencies, `requirements.txt`,
  `Cargo.toml`, `go.mod`, …) gains a package that was not there before. Version-only bumps do
  **not** fire (those are the `lib-bump` / `dependency-update` Categories). Mechanically
  confirmable from the diff: the validator drops the attribute (warn-and-drop) if no manifest
  line actually adds a new package.
- **Reviewer implication:** reviewer verifies the dependency earns its place: stdlib or an
  existing dep couldn't do the job; license, maintenance, and footprint acceptable. Most
  informative when the group's Dominant Category is *not* dep-related: a package appearing
  incidentally inside a `new-feature`/`bugfix` group is the attention signal (combination
  reading, as always, with no verdict).

### `new-abstraction`
The diff introduces a new named abstraction (class, interface, service, wrapper, layer of
indirection) that did not exist before.
- **Detect:** new abstraction definitions in the diff (not relocations: `pure-move` /
  `move-with-edits` groups don't fire this). Observational only: fires on *existence*, never
  judges whether the abstraction is warranted.
- **Reviewer implication:** reviewer asks whether the abstraction earns its place: does an
  existing pattern or utility already cover it; is one call site enough to justify a layer.

### `comment-contradicts-code`
A comment or docstring in the diff appears to disagree with what the adjacent code does.
- **Detect:** model-observed. Compare docstrings/comments against the implementation in the
  same chunk; when firing, cite both sides (the comment line and the code line). If either
  side is outside the diff's visible context, stay silent. Expected to carry `uncertain` more
  often than other attributes; first-to-drop under the deprecation rule if it proves noisy.
- **Reviewer implication:** reviewer reads both and resolves which side is right: fix the
  code or fix the comment. Checkable in seconds; the flag routes attention, never asserts
  which side is wrong.

### `adds-secret`
**Floor: yes**. Cannot be de-emphasized by repo policy.
An added line in the chunk holds a credential in a recognizable format (a private key block, a fixed-prefix provider token, a JWT, or a password inside a URL) or a literal under a key named like a secret (`password`, `client_secret`, `apiKey`). The second is matched by its name, so it can be a value that is no credential; one that reads as a name, such as a design token, is hidden from the model and never sets the attribute, unless its key holds a password.
- **Detect:** code-set, never model-observed. After validation the pipeline runs the same patterns that redact the prompt over the raw diff and sets the attribute on every chunk whose added lines hold a match. The model never sees the value, so it is never offered this attribute and cannot emit or drop it. A credential on a removed line does not fire it (removing it is the fix). The Unattributed remainder can carry it, because the pipeline needs no reading of intent to set it.
- **Reviewer implication:** unless the value is plainly no credential, treat it as leaked: rotate it, then ask for it to come out of the repository and its history. Merging only spreads it further.

### `changes-package-source`
**Floor: yes**. Cannot be de-emphasized by repo policy.
The chunk sits in a pnpm, npm or yarn lockfile that moves where a package's code comes from: the same version with a new source or integrity, a version change that moves the package to a different host, or a new package from a host the lockfile did not use before. It also sits in a changed registry config file, which can move where every package installs from.
- **Detect:** code-set, never model-observed. On every generation the pipeline reads each changed file named `pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json` or `yarn.lock`, at any depth, in full at base and head, and compares its package entries. It sets the attribute on every chunk, and every Unattributed remainder file, in a lockfile where one package keeps its version but changes its source or integrity, or changes its version and what it is fetched from, comparing each version on its own. What a package is fetched from is its registry (protocol, host and the registry's base path) when the URL is that package's own registry tarball of a plain semver version, with no query or percent escape, and otherwise the protocol, host and path with the version left out, so a move to plain `http`, to another owner, or to another artifact on the same host counts. Only on GitHub, GitLab and Bitbucket does a commit at the end of an owner/repo path drop out. It also fires when an npm alias appears or changes, and when an added package comes from a source the base side of that lockfile does not use, or from an unknown one. A registry is one source for every package it serves at that package's own tarball path, so a private registry the base already uses counts once, while another package's tarball on the same host does not. A new lockfile has no base side, so any package from other than `https://registry.npmjs.org`, `https://registry.yarnpkg.com` or the registry the repo configures fires. pnpm and yarn berry name that configured registry only by leaving the host out. A bump that keeps its source, and a new package from a private registry the base already uses, do not fire. When the same PR changes, adds, deletes or renames away `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `pnpm-workspace.yaml`, no source counts as known for added or updated packages, since a config file can redirect any host, and every one of them fires. A lockfile it cannot read on either side (missing, over 8 MiB, outside the shape its package manager writes, unparseable, or ambiguous to the package manager) fires. A lockfile name in another case, such as `Package-Lock.json`, is never read and fires: npm, pnpm and yarn install from it on a case-insensitive file system. Any change to a `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `pnpm-workspace.yaml`, a rename into or out of one included, carries the attribute itself, with or without a lockfile change: npm's and yarn's config readers accept quoted and escaped spellings, so no line test can tell a change that moves a registry from one that does not. A firing file with no changed line (a rename, a mode change, a binary diff) has no chunk, so it joins the Unattributed remainder as an entry with no lines that carries the attribute. A lockfile whose patch only changes its mode keeps its bytes and does not fire; a registry config file does. A Delta Brief has no remainder: it lists by path every firing file no delta chunk covers. The model is never offered it and cannot emit or drop it.
- **Reviewer implication:** a lockfile can swap a package's source or integrity at the same version, which a manifest diff never shows. A registry config change in the same PR moves every package the lockfile names by omission; this attribute fires on the ones the PR adds or updates, so check the config change itself. Check that every changed package traces to a manifest change you expect, and that resolved URLs still point at the registry.

---

## Bucket 3: About the BLAST RADIUS

Properties of what depends on the changed code (independent of what the change is).

### `external-io`
The diff calls external services, network endpoints, filesystem, OS, or third-party APIs.
- **Detect:** `fetch`/`axios`/`http` calls, `fs.*` (beyond reads of bundled assets), `child_process`, SDK calls to third-party providers (Stripe, AWS, etc.).
- **Reviewer implication:** external calls add failure modes (network errors, timeouts, partial state). Reviewer must verify retry/timeout/idempotency and what happens on outage.

### `cross-service`
The chunk changes a contract another service or deployable consumes: API request/response bodies, RPC/message-queue payloads, shared DB schemas, a lib's published exported surface. Sibling services in the same repo count only when they are separate deployables sharing a schema or HTTP API; compile-time imports between packages are NOT services (that is `widely-imported` territory). Modifying an existing consumed contract fires even when the change is additive; a wholly NEW endpoint/export has no consumers yet and is NOT cross-service ("exported public API surface" alone is not this attribute).
- **Detect:** changes to OpenAPI/GraphQL schema files, gRPC `.proto`, message-queue payload shapes, an already-consumed route body or shared table, or an already-published API surface consumed by other repos.
- **Reviewer implication:** change is consumed elsewhere. Reviewer must verify backward compatibility, version negotiation, and consumer-side migration plan.

### `schema-adjacent`
The diff is near (but not in) a schema definition, migration, or persistence layer.
- **Detect:** the file is in or imports from `db/`, `schema/`, `models/`, `migrations/`, ORM definition files.
- **Reviewer implication:** even if the diff itself doesn't change a schema, behavior may depend on schema invariants. Reviewer must confirm the change is consistent with the schema's intent.

### `hot-path`
The chunk lives on a demonstrably high-traffic or latency-critical path; not every request handler qualifies.
- **Detect:** the chunk is in (or directly called by) a serving loop, per-request middleware, hot loop, or path annotated `// hot-path` / per-team designation. (Judgment required when no annotation exists; a routine request handler with no traffic/latency evidence does not fire.)
- **Reviewer implication:** performance regressions amplify. Reviewer must verify no new allocations, sync I/O, or unbounded loops on this path.

### `widely-imported`
The modified API has many EXISTING call sites across the repo; a newly-added API has zero importers and never qualifies.
- **Detect:** count existing call sites of the modified function/symbol. Threshold (rough): ≥10 importers. (Bare export from a package's public entry point is not, by itself, enough.)
- **Reviewer implication:** any contract change ripples broadly. Reviewer must enumerate all callers and confirm each tolerates the new behavior.

### `release-imminent`
The PR targets a branch or release that ships soon (within ~24h), or the PR is marked as a backport/hotfix.
- **Detect:** PR title contains `[backport]`/`[hotfix]`, target branch is a release branch, PR description references an imminent ship date.
- **Reviewer implication:** rollback window is short; reviewer should bias toward smaller-surface fixes and explicit revert plans.

---

## How Attributes Compose

Single attributes are factual descriptions. Combinations are signals:

- `touches-auth` + `no-tests` + `widely-imported` → security-critical change with no safety net and broad blast radius. Deep review required.
- `mutates-state` + `external-io` + `release-imminent` → partial-failure surface area on a tight schedule. Reviewer should focus on idempotency and rollback.
- `removes-validation` + `cross-service` → tightening a contract someone else relies on. Migration plan required.

The brief shows attributes as a flat list per chunk; the reviewer reads the combination and makes the judgment. No verdict is asserted by the tool.

---

## Parked candidates (do not label with these)

Registered here so nobody reinvents them; not valid tokens until unblocked.

- **`unresolved-reference`**: a string-keyed reference (feature-flag name, env var,
  translation key, route string, queue name) that doesn't resolve against the repo's
  registries. The genuinely un-linted hallucinated surface: compilers catch unresolved
  *imports* pre-review, nothing catches these. Needs per-repo registry knowledge + repo
  context, so it is parked until a context source can read the repo's registries (today's sources read tickets and PR-linked pages, not repo files). Note: plain
  `unresolved-import` was **rejected**, not parked: compilers/CI own that lane.
- **`diverges-from-sibling-pattern`**: solves the task unlike sibling files do. Needs
  sibling *selection* (a judgment with bad FP shape: accusing the author of inconsistency
  based on our sampling choice) plus repo file fetching (`ContextSource`, escalation-tier),
  and intentional divergence is routine in refactors. Deferred on evidence + FP-shape
  grounds.

---

## When to Add a New Attribute

Add an attribute to the library when:
1. The same observable pattern appears in ≥2 PRs.
2. The pattern is not already covered by an existing attribute.
3. The pattern has a clear reviewer implication: adding the attribute would change what a reviewer should do.

Drop an attribute if it never fires across 10+ PRs, or if it always co-fires with another attribute (redundant).
