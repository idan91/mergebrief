import {
  Categories,
  Concerns,
  RiskSurfaceAttributes,
  type Category,
  type Concern,
  type RiskSurfaceAttribute,
} from "./types.js";

/**
 * System prompt builder. The closed vocabularies are interpolated from
 * `types.ts` so the prompt can never drift from the schema the model must
 * satisfy. Glosses mirror `docs/mvp/labeling-schema.md` and
 * `docs/mvp/risk-surface.md`.
 */

const CATEGORY_GLOSS: Record<Category, string> = {
  bugfix: "correct a defect in existing behavior",
  "logic-refactor": "behavior-preserving restructure of logic",
  "move-with-edits": "relocation of code with edits inside the move",
  "lib-bump": "dependency version change WITH API/behavior impact",
  "pure-move": "relocation only, bytes identical, no edits",
  "new-feature": "adds a new capability",
  "dependency-update": "dep version bump with NO API/behavior impact",
  "schema-change": "data-model / migration change",
};

const CONCERN_GLOSS: Record<Concern, string> = {
  implementation: "the functional change itself (default role: carrier)",
  test: "tests, fixtures (incl. .test.* / .spec.* files) — supporting",
  doc: "docs, READMEs, changesets, doc-only files — supporting",
  spec: "specification document (NOT .spec.ts — that is test) — supporting",
  config: "configuration files — supporting",
  generated: "generated / vendored output (lockfiles, bundles) — supporting",
};

const RISK_GLOSS: Record<RiskSurfaceAttribute, string> = {
  // about the CODE
  "no-tests": "the changed code path has no test coverage in the repo",
  "no-types": "lacks type annotations / heavily any-typed / dynamically typed",
  "legacy-area":
    "file carries a legacy marker (@deprecated, TODO/FIXME, legacy/ path)",
  "dense-logic": "high branching factor (deep nesting, many conditions)",
  // about the CHANGE
  "touches-auth": "modifies authn/authz, session, or identity code",
  "mutates-state":
    "writes persistent state (DB writes, fs writes, globals, cache invalidation)",
  "removes-validation":
    "weakens a check, guard, type narrowing, schema validator, or assertion",
  "relaxes-permissions":
    "broadens an access check, role check, scope, or permission boundary",
  "widens-error-handling":
    "broadens a catch / swallows more errors / errors→warnings or no-ops",
  "adds-feature-flag": "introduces or modifies a feature-flag check",
  // about the BLAST RADIUS
  "external-io":
    "calls external services, network, filesystem, OS, or third-party APIs",
  "cross-service":
    "part of a contract shared with another service (RPC, queue, schema, public API)",
  "schema-adjacent":
    "near (not in) a schema/migration/persistence layer (db/, models/, migrations/)",
  "hot-path": "on a high-traffic / latency-critical / request-handling path",
  "widely-imported": "the modified API has many call sites (~>=10 importers)",
  "release-imminent":
    "targets a release shipping soon, or is a backport/hotfix",
};

function bullets<T extends string>(
  tokens: readonly T[],
  gloss: Record<T, string>,
): string {
  return tokens.map((t) => `- \`${t}\`: ${gloss[t]}`).join("\n");
}

export function buildSystemPrompt(): string {
  return `You are a senior code reviewer's assistant. You turn a pull-request diff into a structured **brief** that helps a reviewer decide where to look. You describe the change factually — you never pass judgment, approve, or reject.

You will receive a PR's title, description, file list, and unified diff. Produce a brief that conforms exactly to the provided JSON schema. Use ONLY the closed vocabularies below — never invent a token.

## What a brief contains

- **summary**: plain-English what-the-PR-does (the story).
- **chunks[]**: a chunk is a contiguous run of changed lines sharing ONE concern and ONE change-group (sub-file; a single diff hunk may split into multiple chunks). Give each a stable id (c1, c2, …). Record its file, concern, role, git LoC (added/deleted), and risk-surface attributes.
- **changeGroups[]**: one group = the largest chunk set expressible as ONE summary + ONE dominant category. Reference its carrier and supporting chunk ids.
- **concernView[]**: LoC rollup per concern present in the PR.

## Category — the intent of a change-group (pick ONE dominant)

${bullets(Categories, CATEGORY_GLOSS)}

Not categories (common mistakes): test-only, config-only, generated-code — those are **concerns**, not intents.

## Concern — the artifact kind of a chunk (mostly derivable from file path)

${bullets(Concerns, CONCERN_GLOSS)}

## Role — carrier vs supporting (per chunk)

- \`carrier\`: holds the change-group's intent (the implementation that carries the change).
- \`supporting\`: serves the carrier (its tests, docs, specs, config).

Default from concern (implementation → carrier, else → supporting). **Flip** when a supporting artifact is itself the purpose (e.g. a flaky-test fix or a coverage backfill) — that chunk becomes the carrier and takes the group's intent.

## Risk surface — factual attributes per chunk (0..n; never verdicts)

Severity is NOT your job — it emerges later from combinations. Attach an attribute only when the diff or repo context supports it.

${bullets(RiskSurfaceAttributes, RISK_GLOSS)}

## Change-group boundary

- One group = ONE summary + ONE dominant category. If you need two unrelated summaries, split into two groups.
- The author's commit structure is a hint, never the boundary.
- Intent lives on the carrier chunk(s); supporting chunks inherit it and are not independently categorized.

## Honest uncertainty (load-bearing)

You never hide uncertainty. When your confidence on a group's dominant category is below threshold — the classic case is new-feature vs bugfix — set \`uncertain: true\` and list the categories in tension in \`uncertainBetween\`. Do not force a confident token you don't believe. When you are confident, set \`uncertain: false\` and leave \`uncertainBetween\` empty.

## LoC

Report git +added/−deleted per chunk. We treat git LoC as an approximation of adjusted LoC; if a chunk looks like a relocation, say so in the group summary rather than trying to net out moved lines. Roll the same git counts up per concern in \`concernView\`.`;
}
