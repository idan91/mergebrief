# Plan — BRIEF-52 + BRIEF-58: Repo-local config surface (`.mergebrief/`)

> Status: **LOCKED — joint grill closed 2026-07-16, not started.**
> Tickets: Notion BRIEF-52 (repo-local risk policies) + BRIEF-58 (repo
> instructions file); BRIEF-53 naming note resolved here.
> ADRs: **0032** (repo-local config surface, new — the single source for every
> decision below; this plan does not restate rationale), **0020 as amended
> 2026-07-16** (draft-first retired as absorbed; `entryCommentOnDrafts`).
> Design is locked — execution does not require Fable.

## What this delivers (product + technical context)

**Product:** a repo can commit a `.mergebrief/` directory that (a) extends the
built-in risk-surface library with custom, model-evaluated attributes and tunes
display weight (de-emphasis, never suppression — `policy.yaml`), (b) feeds the
generator repo knowledge the diff can't carry — grouping boundaries, glossary,
noise paths (`instructions.md`), and (c) sets per-repo workflow taste
(`settings.yaml`, v1: `entryCommentOnDrafts`). Every brief shows exactly which
config shaped it (file + blob SHA + outcome). Risk display gets group/chunk
markers and an attribute-keyed jump-rail; story order stays untouched.

**Technical:** five moves. (1) `getRepoFile` operation in `packages/github`
(contents API @ default branch, size guard, blob SHA). (2) new
**`packages/repo-config`**: Zod schemas (`settingsV1`, `policyV1`), caps/budget
constants, pure `validateRepoConfig` — reject-whole, collision resolution
(built-in wins + chip), outcome model (`applied/absent/invalid/over-budget/
fetch-failed`). (3) categorizer prompt: `REPO_INSTRUCTION_CLASSES` const,
`<repo_instructions>` fencing + contract preamble, fenced custom-attributes
block with `paths` pre-filtering, budget enforcement, adversarial fixtures.
(4) worker wiring (fetch → validate → inject, fail-open) + persistence
provenance (per-file path/SHA/outcome + policy snapshot on the artifact) +
migration. (5) FE: chip source variants, de-emphasis rendering, group-header
union chips, jump-rail, provenance chip with warning states; entry-comment
draft gate; docs + authoring template.

## Locked decisions (ADR 0032 — do not re-litigate)

Gist index only; the ADR carries the full text and rationale.

1. **Operator/code-owner line** (#1): instance = provider/model/spend, boot
   fail-fast; repo = policy/prose/workflow, generation-time fail-open. No
   shared keys. Straddle rule recorded (narrow-never-widen), zero straddling
   knobs v1.
2. **Layout** (#2): `.mergebrief/{instructions.md, settings.yaml, policy.yaml,
   rules/(reserved)}`. `.config.` infix = instance-only. Dotdir gitignorable
   for CLI-local mode (working-tree read = CLI only).
3. **Default-branch trust rule** (#3) for every repo-local file; PR-head copy
   is analyzed as ordinary diff data only. Three-lane table (config /
   code-context / third-party agent files — AGENTS.md NOT read, revisit
   trigger recorded).
4. **Fetch** (#4): fresh per generation, three fixed paths, no cache; blob SHA
   → provenance; fetch failure = fail-open + loud `fetch-failed`.
5. **Failure semantics** (#5): syntactic invalidity → reject-whole (never
   partial use); name collision (valid schema) → built-in wins + disclosure
   chip, uniform across versions/upgrades. Errors visible to author AND
   reviewer.
6. **Caps as injected budget** (#6): instructions 16 KB budget; policy 32 KB /
   4k-char criteria / ≤20 attributes; settings 4 KB. Schema constants.
   Usage shown in provenance; warn before reject.
7. **Versioning** (#7): required integer `version: 1` per YAML; unknown
   version/keys = invalid path (strict). Prose unversioned.
8. **Provenance** (#8): per-file `path + blob SHA + outcome` on the generation
   record; understated header chip (expandable, warning state on error);
   Receipt carries the full table + de-emphasis tuning permanently.
9. **Trust tiers** (#9): validated / semi-trusted / untrusted named;
   BRIEF-61's external ContextSource = untrusted, not designed here.
10. **Instructions semantics** (#10): semi-trust via enumerated classes
    (grouping boundaries, glossary/terminology, noise paths, reading
    *conventions* — foundation relations only — summary phrasing); must-ignore
    list; operative source = `REPO_INSTRUCTION_CLASSES` const, unit-tested
    into the prompt; class changes gate on ADR amendment + eval run. Prose
    never mints facts. Root file only; scoped files = separate Later ticket.
11. **Policy semantics** (#11): flat facts `{criteria, implication?, paths?}`,
    no tier representable; de-emphasis-never-suppression; floor =
    `touches-auth` + `removes-validation` + `relaxes-permissions` (declared in
    risk-surface.md); floor co-fire un-quiets; custom criteria evaluated in
    the same single call, path-prefiltered; structural source marker, never a
    string prefix; display = union chips (group), source-variant chips
    (chunk), attribute-keyed collapsible jump-rail (never group-ranked); risk
    tie-breaker DROPPED (revisit trigger recorded); v1 display weight from the
    generation-time policy snapshot stored on the artifact.
12. **Injection posture** (#12): no agentic surface; defense table (write
    gate, caps, fencing, port-level schema enforcement, harness-side policy
    application, provenance, adversarial fixture). Residual risk =
    self-inflicted prose degradation only.
13. **settings.yaml v1** (#13): `entryCommentOnDrafts` default `false` —
    implements ADR 0020 #4 (verified unbuilt: no draft gate in `generate.ts`);
    entry comment posts on `ready_for_review` (webhook already parses it);
    draft-first retired as absorbed. Instance `drafts:` knob (generation for
    drafts, default ON, documented) stays BRIEF-53's build.

## Mandates

- Docs shipped with the stack: authoring guide + `instructions.md` template
  (rendering the class list from the const), self-host docs section for the
  repo surface incl. what the instance `drafts:` knob does and how to turn it
  off, CONTEXT.md glossary entries (de-emphasis, floor, jump-rail, repo
  instructions), risk-surface.md floor markers, README pointer.
- Adversarial + golden fixtures land as categorizer tests now; graduate to the
  eval harness when BRIEF-59 builds (soft dependency, noted on both tickets).
- Error messages carry `path + SHA`, never file content (secret/echo hygiene).
- Repo-wide rules apply: extensionless imports, no `enum`, named exports,
  `Result` for expected failures, Zod at boundaries. CI is path-filtered —
  contract changes (github operation shape, repo-config types consumed by
  worker/api/web) need dependent suites run locally before push.

## Review loop (per PR — pattern from BRIEF-11/43, reconfirm at kickoff)

- codex CLI (GPT 5.6 Sol, reasoning high) inline review → address every
  comment → re-run until a pass has zero new findings. Fable fallback on hang.
- Dedicated security-review agent per PR — this stack is injection surface:
  YAML parsing, prompt fencing, contents-API handling, error hygiene.
- Upstream-first fixes; rebase downstream immediately; CI green before a PR
  waits on Idan; lint judged by exit code, per branch.

## Subtasks → PRs

Seven PRs. Dependency spine: **PR 1 ∥ PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7.**
**Invocation:** PR 1 and PR 2 may run in parallel (independent packages);
everything after is sequential in the main thread (each consumes the previous
contract). Branch naming `feature/BRIEF-52/<slug>` (PRs 1–6) and
`feature/BRIEF-58/<slug>` where the PR is instructions-specific (PR 3 carries
both tags in title). Chunked commits per git-eng defaults; stack rebases
force-with-lease with explicit `:sha`.

**Model + effort per PR** (no Fable required):

| PR | Model / effort | Why |
|---|---|---|
| 1 github-repo-file | Opus medium | One REST operation + Result mapping; risk is API-shape edge cases, not design |
| 2 repo-config-package | Opus high | Schema strictness, reject-whole/collision semantics, outcome model — the contract everything consumes |
| 3 prompt-repo-context | Opus high | Fencing + contract preamble + budget + adversarial fixtures; the one prompt everything rides on |
| 4 worker-wiring-provenance | Opus high | Fail-open paths, migration, snapshot shape; tenancy invariants on new columns |
| 5 fe-attribute-display | Opus high | Chip variants + de-emphasis + floor co-fire rule across Story/Concern views |
| 6 fe-jump-rail-provenance | Opus medium | New rail component + provenance chip; follows PR 5's patterns |
| 7 settings-entry-gate-docs | Opus medium | Small worker gate + ready_for_review post + docs/template writing |

### PR 1 — `feature/BRIEF-52/github-repo-file` (~250–400 LOC)

1. `operations/repo-file.ts`: `getRepoFile(ctx, { path, ref })` via contents
   API — returns `Result<{ content, blobSha, size } | ABSENT, GithubError>`;
   size guard parameter (reject > cap before decode); base64 decode; typed
   404→absent vs other errors. Default-branch ref resolution helper (from the
   persisted repo row / `repos.get` — decide at implementation, note which).
2. Export from `lib.ts`; unit tests incl. 404, oversize, non-file (dir/symlink
   → error), encoding edge cases.

### PR 2 — `feature/BRIEF-52/repo-config-package` (~500–700 LOC)

1. New workspace package `packages/repo-config` (vitest + oxlint + CI job
   path-filtered; AGENTS.md seed).
2. Zod schemas: `settingsV1` (`version`, `entryCommentOnDrafts` default
   false), `policyV1` (`version`, `attributes` map of `{criteria ≤4000,
   implication? ≤500, paths?: glob[]}`, ≤20 entries, `deEmphasize` block
   path-scopable, floor-attribute rejection on deEmphasize). Caps/budget
   constants exported.
3. Pure `validateRepoConfig(files) → { settings?, policy?, outcomes }` —
   source-agnostic (server passes fetched contents; CLI passes working-tree
   reads later). Reject-whole; collision detection against the built-in token
   list + parked candidates + `uncertain` (import the vocabulary from the
   categorizer package — single source; if that import is awkward, re-export
   the token list from categorizer, never duplicate).
4. Outcome vocabulary as `as const` map (SHOUT_CASE keys, kebab-case values).

### PR 3 — `feature/BRIEF-52+58/prompt-repo-context` (~500–800 LOC, mostly tests/fixtures)

1. `REPO_INSTRUCTION_CLASSES` const (may-follow + must-ignore lists) in the
   categorizer prompt module; unit test asserting verbatim presence in the
   assembled prompt.
2. `<repo_instructions path sha>` fenced injection + contract preamble;
   fenced custom-attributes block (name + criteria + implication), chunk-path
   pre-filtering by `paths` globs; 16 KB budget enforcement at assembly.
3. Schema plumbing: model may emit custom-attribute names ONLY from the
   injected set — extend the hand-built json_schema enum per generation with
   the repo's custom names (keep built-in enum enforcement intact); validator
   drops unknown names (warn-and-drop).
4. Fixtures: golden case (instructions improve grouping/terminology, custom
   attribute fires with source marker) + **adversarial case** (schema
   override, verdict insertion, attribute suppression, agent-addressing —
   asserting invariants hold). These are the BRIEF-59 graduation set.

### PR 4 — `feature/BRIEF-52/worker-wiring-provenance` (~500–800 LOC)

1. Generate task: fetch 3 paths (PR 1) → `validateRepoConfig` (PR 2) →
   inject (PR 3). Fail-open on fetch failure; all outcomes recorded.
2. Persistence: repo-config provenance on the generation record (per-file
   path + blob SHA + outcome) + policy snapshot (fired custom-attribute
   definitions + de-emphasis rules in effect) stored with the brief artifact
   (D6 idempotent writes; tenancy stamping per D2b). Migration (drizzle-kit
   generate, append-only).
3. Run dependent suites locally (api/web consume artifact shape) — CI
   path-filter gap rule.

### PR 5 — `feature/BRIEF-52/fe-attribute-display` (~600–900 LOC)

1. Brief payload/viewModel: attribute source marker, de-emphasis resolution
   from the artifact's policy snapshot, floor co-fire un-quiet rule.
2. Chunk chips: source variant (outlined + "defined by repo policy" +
   implication in expansion); de-emphasized quiet render.
3. Group header: deduped union chips, floor-first ordering, "+n" collapse for
   de-emphasized. No counts-as-severity, no aggregate glyph.
4. Characterization coverage across Story/Concern views (data-attrs, not
   hashed classes).

### PR 6 — `feature/BRIEF-52/fe-jump-rail-provenance` (~400–700 LOC)

1. Jump-rail: separate collapsible row sibling to GroupTocBar — attribute
   names + counts, click cycles carrying groups in story order, floor pinned
   first, de-emphasized excluded; collapsed unless a floor attribute fired.
2. Provenance chip (header, both author + reviewer surfaces): "repo config @
   sha", expandable per-file table, warning state on any non-applied outcome;
   Receipt/Review Summary gains the permanent per-file table + de-emphasis
   tuning line.

### PR 7 — `feature/BRIEF-58/settings-entry-gate-docs` (~300–500 LOC + docs)

1. Entry-comment draft gate in the worker: skip post/refresh while
   `draft === true` unless `entryCommentOnDrafts: true`; post entry on
   `ready_for_review` event (enqueue path). Delete/repost semantics unchanged
   (ADR 0016).
2. Docs: authoring guide + `instructions.md` template (class list rendered
   from the const), self-host repo-surface section + instance `drafts:` knob
   explanation, CONTEXT.md glossary entries, risk-surface.md floor markers,
   README pointer.
3. Coordinate with BRIEF-53 if it lands first (its enqueue-path debounce
   touches the same file — rebase order, not a conflict of semantics).

## Deferred (planned slots — do NOT build)

- **Scoped instruction files** — Later ticket (glob frontmatter, drop-largest
  budget rule). Triggers: root file pressing 16 KB on a real monorepo;
  cross-scope noise complaints.
- **AGENTS.md ingestion** — trigger: ≥2 independent "why duplicate my
  AGENTS.md" adopters → opt-in include directive, MD-tier fenced.
- **Blob-SHA content cache** — trigger: rate-limit pressure on large
  instances.
- **Live-policy retroactive re-render** (display weight from current policy
  instead of snapshot) — nicety; needs a policy read route + cache story.
- **Risk tie-breaker** — trigger: ≥2 reviewers hunting flagged groups despite
  the rail → repo-policy opt-in at most.
- **Comment-to-rule output** into `.mergebrief/rules/` — v2+, separate ticket.

## PR budget sanity

Estimates above are net LOC excluding lockfiles/fixtures; the standing LOC
ceiling is a hard gate — measure diff-stat after every part; on a split
trigger, split (PR 5 is the likeliest: chips vs group-header work). Chores
(package scaffolding beyond PR 2's own wiring) get their own PR if they grow.

## Verification (every PR)

```sh
pnpm -C <package> typecheck && pnpm -C <package> test
pnpm lint                       # exit code, per branch
```

Runtime pass before the stack waits on Idan: `/verify` recipe (seeded repo
with a `.mergebrief/` dir on the default branch; confirm provenance chip,
custom attribute firing, de-emphasis render, draft-PR entry silence, ready
flip post; broken-YAML repo showing the warning chip to both roles).

## Context for a fresh session (read before PR 1)

ADR 0032 end to end, then ADR 0020's 2026-07-16 update block. Code entry
points: `packages/worker/src/task/generate.ts` (engine consumption + entry
comment), `packages/github/src/operations/` (operation idiom),
`packages/generators/src/validation/enforceSchema.ts` (port-level schema
floor), categorizer prompt module (fencing idiom at the `<linked_context>`
block), `apps/web/src/features/brief/viewModel.ts:154` (risk-surface flag
derivation), GroupTocBar component (rail sibling). Board tickets BRIEF-52 /
BRIEF-58 carry the grill-locked summaries; BRIEF-53 coordinates on the
enqueue path.
