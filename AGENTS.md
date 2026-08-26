# code-review — repo-wide agent rules

This file is the canonical repo-standards file; the root `CLAUDE.md` is a
symlink to it. Rules here apply to the whole workspace. Every package and
app carries its own `AGENTS.md` for conventions and invariants specific to
it, alongside a `CLAUDE.md` that points at it — a new package adds both.

- **Extensionless relative imports everywhere** (`from "./tenant"`, never
  `from "./tenant.js"`). Every package is bundler-resolved end to end
  (`moduleResolution: "bundler"`; vitest/tsx/vite). Extensions only where
  genuinely required (non-TS assets).
- No `enum`: `as const` maps + `ValueOf<T>`; keys SHOUT_CASE, string values
  kebab-case.
- Strict TS: no `any`, no bare `as` — Zod or type guards at boundaries.
- Expected failures return `Result`; `throw` is for programmer/infra errors.
  Error messages never carry secrets, tokens, or connection strings.
- Named exports only (default exports where a framework requires them, plus
  one convention carve-out: a `packages/api` domain `controller.ts` default-
  exports its single `xxxController` object).
- **Function names start with a verb and name what comes back.**
  `getSocketAddress`, `isAuditRowWritten`, `buildEndpointIndex`,
  `deriveAttentionItems`, `shapeSubmitComment`, `resolveWritableDraft`,
  `readCarryFacts`, `collectChunks`. Not `socketAddress`, not `commentOf`,
  not `withoutDiffRows` — a bare noun, an `xOf` suffix and a preposition all
  say "of what" instead of what you get. A function returning either a value
  or a refusal is `resolve*`, matching `resolveWrite`. Route factories keep
  the established `xxxRoute` / `xxxRoutes` shape.
- **Zod schemas live beside their owner** — the route, operation, store, or
  script that parses with them; never a cross-owner `schemas.ts` grab-bag
  (a domain folder's own `schemas.ts` is fine — the ban is on schemas that
  serve more than one owner).
  Duplicated wire bounds share one module at the closest common owner
  (`packages/api`'s `routes/repos/pr/wire-bounds.ts`). Named exception:
  `packages/brief-core/src/types.ts` IS the domain contract and keeps its
  schemas. `packages/types` stays types-only, zero runtime — no schema may
  move there.
- **Package entry = `src/index.ts`** — a curated barrel, the package's
  `exports["."]` target. A package root conforms when every file is the entry,
  `types.ts`, or a small domain-cued support file (loose count ≤ ~5); a
  category earns a folder only when it clarifies; generic names are defects.
  `index.tsx` feature barrels remain an apps/web convention.
- **User-facing copy lives in the `packages/i18n` catalog** — never
  hard-coded in components or route handlers. A new wire error code follows
  the recipe in `packages/api/AGENTS.md`; its `errors.<code>` template rides
  the same change.
- **Logging goes through the `packages/logging` boundary** — no bare
  `console.*` in `packages/api`, `packages/worker`, or server-side
  `apps/web` code. Secrets ride as structured fields (redacted by path),
  never interpolated into `msg`.
- **Every log line earns its level**: `error` = operator-actionable now;
  `warn` = degraded/suspicious, alertable on sustained rate; `info` = terse
  operational signal; otherwise `debug` or delete the line. First-class `evt`
  names come ONLY from the logging package's taxonomy table — everything else
  stays plain leveled logging.
- **Coverage floors ride inside `pnpm test`**: every package's vitest config
  commits a lines threshold — 75% is the standard, and a package still under
  it carries a temporary floor plus a catch-up ticket. Never lower a floor to
  absorb a drop. A `v8 ignore` comment needs a stated reason, and is reviewed
  like a lint-disable.
- **CI selects changed packages PLUS their dependents** (`--filter
  "...[<base>]"` off the real workspace graph), so changing a contract another
  package consumes does run that consumer's suite. Two holes remain, and both
  need a local run before pushing: a consumer that mirrors a contract without
  declaring the dependency (`apps/web`'s hand-rolled wire types), and any
  agreement that is not a package edge at all (a wire shape a separate service
  parses).
- **Comments stay lean and reference-free**: a comment earns its place only
  by stating a constraint the code can't show on its own — one short line,
  not a paragraph. Delete rationale essays, "why we chose X" writeups, and
  provenance blocks. Never cite a ticket id, ADR number, PR number, or
  review-round name in a comment or in reader-facing docs (`README.md`,
  `CONTEXT.md`, `PRODUCT.md`, any `AGENTS.md`) — that belongs in the commit
  message and PR description, and rots once the ticket closes. `docs/adr/**`
  and `docs/plans/**` are the exceptions: a decision record and a plan are
  identified by the ticket and decisions they cite, and both ship public as-is.
- **Generation-surface changes run the eval harness**: touching
  `packages/brief-core/src/generation/prompt.ts`, the output schema,
  validators/salvage, repo-config injection, or output-affecting adapter
  defaults ⇒ run `pnpm -C tools/categorizer eval`, **scoped by default**:
  one `--case <id>` run per case whose properties could plausibly move
  (the flag takes a single id), justify the selection in the PR body;
  full suite (measured $9.70) for prompt-wide or model-bump changes.
  Compares against the committed baselines; `--rebaseline` on main only when
  the surface legitimately moved. Include the report in the PR body.
  Convention gate, never CI — live API spend. See
  `tools/categorizer/eval/README.md`.
- **No nested ternaries** — one condition per ternary, no exceptions. Reach for
  a lookup map (`Record<State, Value>`), if/else, or an early return instead.
  Enforced by `no-nested-ternary`.
- **Conditional fields are assigned, not spread.** Declare the object with its
  unconditional fields, then assign the optional ones under an `if`; never
  `...(cond ? { x } : {})`. Works with `exactOptionalPropertyTypes`. Enforced
  by `no-restricted-syntax`.
- **`as const` map names are plural, their `ValueOf` type singular** —
  `const PullRequestSources = {...} as const;`
  `type PullRequestSource = ValueOf<typeof PullRequestSources>`. Applies to new
  maps; older singular names in `packages/persistence` stay as they are.
- **Judge a gate by its exit code, never by grepping output.** `pnpm lint`
  short-circuits on `&&`, so a failure in an early step means later steps —
  including `pnpm format:check` — never run at all. Prettier reports violations
  as `[warn]` lines, not "error". Run `cmd >/dev/null 2>&1; echo $?`, and in
  stacked work lint each branch bottom-up: a rule can pass at the tip and fail
  mid-stack.
- **Never search with a glob that can match a real env file.** Target
  `.env.example` and source files explicitly — a filename-list grep still reads
  contents, and real env files hold live keys.
- **Review by re-deriving, not by agreeing.** Form your own read of a diff
  before reading the author's, then name the disagreements as reasoning gaps.
  A finding you believe is wrong gets a reply explaining why, not a compliance
  fix; a question is not a change request.
- **The artifact noun is lowercase "brief"** mid-sentence in user-facing copy;
  the product is "MergeBrief". Identifiers, docs and ADRs are unaffected.
