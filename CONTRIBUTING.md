# Contributing

The most valuable thing you can contribute to Brief is not code. It's review knowledge.

Brief's taxonomy and Playbooks are the ESLint-rules of code-review comprehension: a shared,
versioned vocabulary of *what kinds of change exist* and *what is known to go wrong with each
kind*. Every Category token, every Playbook item, every Risk-Surface attribute is a piece of
engineering experience made reusable — written once, applied to every PR anyone reviews with
the tool. That library lives in plain markdown in this repo, and growing it is the main
contribution surface.

If you have reviewed enough PRs to know that lib bumps break at the call sites nobody swept,
or that a "pure move" is never quite pure, you already have something to contribute here.

## Where everything lives

The vocabulary is split across four files with a strict division of labor:

| File | Role |
|---|---|
| [`docs/mvp/labeling-schema.md`](./docs/mvp/labeling-schema.md) | The authoritative **index** of valid tokens on every axis. A token not registered here is not valid, full stop. |
| [`CONTEXT.md`](./CONTEXT.md) | The **glossary** — what each concept means, what terms are deliberately avoided. |
| [`docs/mvp/playbooks.md`](./docs/mvp/playbooks.md) | The per-**Category** review checklists and per-**Concern** checks — the deep content. |
| [`docs/mvp/risk-surface.md`](./docs/mvp/risk-surface.md) | The per-attribute detail for **Risk Surface** — detection notes and playbook implications. |

Always edit in that order: register the token in the index first, then write the deep content.
Never invent a token inline anywhere else.

## The schema

Three axes, three attach points. (Full glossary in [`CONTEXT.md`](./CONTEXT.md).)

- **Category** — the *intent* of a Change-group (`bugfix`, `lib-bump`, `schema-change`, …).
  One dominant per group, optional secondaries. Each Category owns a Playbook.
- **Concern** — the *artifact* a chunk touches (`implementation`, `test`, `doc`, `spec`,
  `config`, `generated`). Orthogonal to Category. Supporting Concerns own Concern checks.
- **Risk Surface** — zero or more *factual attributes* on a chunk (`no-tests`,
  `mutates-state`, `new-dependency`, …), in three buckets: about the code, about the change,
  about the blast radius. Facts a reviewer can check in seconds. Never verdicts — severity,
  when it matters, emerges from combinations, and the reviewer makes that call.

All three vocabularies are **closed sets**. The engine's prompt and output schema are
generated from them, so an unregistered token cannot appear in a Brief. That closedness is
the point: it's what makes the same kind of change recognizable across every PR, and what
lets a Playbook attach reliably. Expansion is deliberate, never casual.

### Playbook item format

Every Playbook item must be all four of these:

1. **Action-shaped** — "Verify X", "Check Y", "Confirm Z". Not a declarative observation.
2. **Mechanically checkable** — the reviewer can answer yes or no. Not "kind of".
3. **Specific to its token** — a `bugfix` item does not belong in `logic-refactor`; a `test`
   check does not belong in `doc`.
4. **Failure-mode-grounded** — the item encodes something that historically goes wrong with
   this change type. Each Playbook section opens with its failure-mode list; every item
   should trace back to one.

Engineering rules, not AI hypotheses. If you can't name the failure mode an item catches, the
item isn't ready.

### Risk-Surface attribute format

Each attribute entry in `risk-surface.md` carries:

- a **name** (kebab-case, factual, no severity words — `touches-auth`, never `dangerous-auth`),
- its **bucket** (code / change / blast radius),
- a **Detect** note — how a labeler or the engine recognizes it, as mechanically as possible,
- a **Playbook implication** — what a reviewer should do differently because the attribute
  fires. If firing wouldn't change reviewer behavior, the attribute carries no information.

## How to contribute

### Improve an existing Playbook (the best first contribution)

Found a failure mode a Playbook misses? Add it to that section's failure-mode list and write
the item that catches it, in the format above. Sharper wording for an existing item, or
evidence that an item is dead weight, is just as welcome.

### Add a Concern check

Same format as a Playbook, keyed on a supporting Concern instead of a Category. Check first
that the failure mode isn't really Category-shaped — Concern checks apply to supporting
chunks regardless of the group's intent.

### Add a Risk-Surface attribute

The bar (from `risk-surface.md`, "When to Add a New Attribute"):

1. The same observable pattern appears in **at least two real PRs** — cite them in your PR
   description.
2. No existing attribute already covers it.
3. It has a clear playbook implication — the attribute would change what a reviewer does.

Then: register the token in `labeling-schema.md` (correct bucket), write the full entry in
`risk-surface.md`, and keep the name factual. If detection needs repo context the engine
doesn't have (registries, sibling files), expect it to be **parked** rather than accepted —
see the "Parked candidates" section of `risk-surface.md` for two worked examples of that
outcome and why.

### Add a Category

The rarest change, and the highest bar — every Category dilutes the recognizability of the
others. Be ready to show that real Change-groups exist whose intent no current Category
expresses (and that the gap isn't actually a Concern, the classic mistake: `test-only` and
`config-only` looked like Categories and were not). A new Category ships with its Playbook —
register in `labeling-schema.md`, gloss in `CONTEXT.md`, checklist in `playbooks.md`, in the
same PR.

### Deprecate a token

The library stays sharp by shedding, too. A token that never fires across 10+ PRs, or always
co-fires with another (redundant), should be dropped. Bring the evidence; remove it from the
index and the deep file together.

## Keeping docs and code in lockstep

The markdown is the source of truth; the code mirrors it. A PR that changes *tokens* (adds,
renames, or removes one) must update the mirrors in the same PR:

- `packages/brief-core/src/types.ts` — the closed enums the output schema validates against.
- `packages/brief-core/src/prompt.ts` — the gloss maps interpolated into the prompt.
- `apps/web/src/features/brief/types.ts` — the FE copy of the vocabularies.
- `apps/web/src/features/brief/playbooks.ts` — the rendered Playbook / Concern-check items.

A PR that only edits Playbook *items* touches `playbooks.md` and `playbooks.ts` (the FE
renders a condensed form of the doc items — keep them semantically identical, terseness
aside). Verification for code-touching PRs:

```bash
pnpm --dir tools/categorizer typecheck && pnpm --dir tools/categorizer test
pnpm --dir apps/web typecheck && pnpm --dir apps/web test
pnpm lint
```

Docs-only PRs need no build step. Yes, the mirror step is manual for now; generating the
code from the markdown is a welcome future contribution.

## Ground rules

- **No verdicts, anywhere.** No severity grades, no "critical", no scores, no "this is
  probably a bug". Attributes are facts; Playbook items are questions a reviewer answers.
  This is the product's load-bearing rule and it applies to contributed content too.
- **Register first.** The index in `labeling-schema.md` gates validity. Deep content for an
  unregistered token will be bounced back.
- **`uncertain` is a valid output.** Don't design tokens or items that force a judgment the
  evidence can't support.
- **Terminology matters.** `CONTEXT.md` records the words this project uses and the ones it
  deliberately avoids. Match it; propose changes to it explicitly rather than drifting.

## Governance

Small project, early days: contributions land by maintainer review, and the bar is the rules
above. A fuller governance model (who can approve vocabulary changes, how disputes resolve)
is deliberately not designed yet — it will be, once there are contributors to govern.

## Code contributions

Bug fixes and features are welcome through ordinary PRs — run the verification commands
above before opening one. For anything architectural, read the relevant ADRs in
[`docs/adr/`](./docs/adr/) first and open an issue to discuss; several tempting features
(severity scores, AI-authored review comments, general-purpose bug hunting) are documented
non-goals, and a PR won't change that.
