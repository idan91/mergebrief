# Contributing

The most valuable thing you can contribute to Brief is not code. It's review vocabulary.

Brief's taxonomy is the shared, versioned vocabulary of *what kinds of change exist*
(Categories, Concerns) and *what factual attributes make a chunk worth attention*
(Risk Surface). The engine's prompt and output schema are generated from it: every token
you register shapes what the tool can recognize in every PR anyone reviews with it. That
vocabulary lives in plain markdown in this repo, and sharpening it is the main
contribution surface.

If you have reviewed enough PRs to know that a factual pattern — `removes-validation`,
`widens-trust-boundary` — reliably deserves a second look, you already have something to
contribute here.

> **Where did the Playbooks go?** The per-Category checklist layer is **parked to v2**
> (ADR 0035). `docs/mvp/playbooks.md` is kept as the v2 seed, but no product surface
> consumes it and no new playbook items are accepted while parked. Any revival is bound
> to ADR 0035's rubric identity: coverage *measurement* of finished reviews, never
> prompt material for reviewers or agents.

## Where everything lives

The vocabulary is split across files with a strict division of labor:

| File | Role |
|---|---|
| [`docs/mvp/labeling-schema.md`](./docs/mvp/labeling-schema.md) | The authoritative **index** of valid tokens on every axis. A token not registered here is not valid, full stop. |
| [`CONTEXT.md`](./CONTEXT.md) | The **glossary** — what each concept means, what terms are deliberately avoided. |
| [`docs/mvp/risk-surface.md`](./docs/mvp/risk-surface.md) | The per-attribute detail for **Risk Surface** — detection notes and reviewer implications. |
| [`docs/mvp/playbooks.md`](./docs/mvp/playbooks.md) | **Parked** (ADR 0035). The v2 seed for the coverage-rubric layer; read-only while parked. |

Always edit in that order: register the token in the index first, then write the deep
content. Never invent a token inline anywhere else.

## The schema

Three axes, three attach points. (Full glossary in [`CONTEXT.md`](./CONTEXT.md).)

- **Category** — the *intent* of a Change-group (`bugfix`, `lib-bump`, `schema-change`, …).
  One dominant per group, optional secondaries.
- **Concern** — the *artifact* a chunk touches (`implementation`, `test`, `doc`, `spec`,
  `config`, `generated`). Orthogonal to Category.
- **Risk Surface** — zero or more *factual attributes* on a chunk (`no-tests`,
  `mutates-state`, `new-dependency`, …), in three buckets: about the code, about the change,
  about the blast radius. Facts a reviewer can check in seconds. Never verdicts — severity,
  when it matters, emerges from combinations, and the reviewer makes that call.

All three vocabularies are **closed sets**. The engine's prompt and output schema are
generated from them, so an unregistered token cannot appear in a Brief. That closedness is
the point: it's what makes the same kind of change recognizable across every PR. Expansion
is deliberate, never casual.

### Risk-Surface attribute format

Each attribute entry in `risk-surface.md` carries:

- a **name** (kebab-case, factual, no severity words — `touches-auth`, never `dangerous-auth`),
- its **bucket** (code / change / blast radius),
- a **Detect** note — how a labeler or the engine recognizes it, as mechanically as possible,
- a **Reviewer implication** — what a reviewer should do differently because the attribute
  fires. If firing wouldn't change reviewer behavior, the attribute carries no information.

## How to contribute

### Add a Risk-Surface attribute (the best first contribution)

The bar (from `risk-surface.md`, "When to Add a New Attribute"):

1. The same observable pattern appears in **at least two real PRs** — cite them in your PR
   description.
2. No existing attribute already covers it.
3. It has a clear reviewer implication — the attribute would change what a reviewer does.

Then: register the token in `labeling-schema.md` (correct bucket), write the full entry in
`risk-surface.md`, and keep the name factual. If detection needs repo context the engine
doesn't have (registries, sibling files), expect it to be **parked** rather than accepted —
see the "Parked candidates" section of `risk-surface.md` for two worked examples of that
outcome and why.

### Sharpen an existing entry

Better detection notes, a sharper reviewer implication, or evidence that an attribute is
dead weight — all welcome, same evidence bar.

### Add a Category

The rarest change, and the highest bar — every Category dilutes the recognizability of the
others. Be ready to show that real Change-groups exist whose intent no current Category
expresses (and that the gap isn't actually a Concern, the classic mistake: `test-only` and
`config-only` looked like Categories and were not). Register in `labeling-schema.md` and
gloss in `CONTEXT.md` in the same PR. (While the playbook layer is parked, no checklist
ships with it; ADR 0035 governs what happens when that layer revives.)

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

Token changes touch the generation surface, so the eval harness applies
(`pnpm -C tools/categorizer eval` — see `tools/categorizer/eval/README.md`).
Verification for code-touching PRs:

```bash
pnpm --dir tools/categorizer typecheck && pnpm --dir tools/categorizer test
pnpm --dir apps/web typecheck && pnpm --dir apps/web test
pnpm lint
```

Docs-only PRs need no build step. Yes, the mirror step is manual for now; generating the
code from the markdown is a welcome future contribution.

## Ground rules

- **No verdicts, anywhere.** No severity grades, no "critical", no scores, no "this is
  probably a bug". Attributes are facts. This is the product's load-bearing rule and it
  applies to contributed content too.
- **Register first.** The index in `labeling-schema.md` gates validity. Deep content for an
  unregistered token will be bounced back.
- **`uncertain` is a valid output.** Don't design tokens that force a judgment the
  evidence can't support.
- **Terminology matters.** `CONTEXT.md` records the words this project uses and the ones it
  deliberately avoids. Match it; propose changes to it explicitly rather than drifting.

## Governance

One maintainer, stated plainly: **final call on every contribution — vocabulary, code,
docs — rests with the maintainer** (ADR 0036). What you can rely on in exchange:

- **Reasons, always.** Every accept, reject, or park gets a short written reason in the
  PR thread, tied to the published bars above (evidence rule, deprecation rule, the
  Concern-vs-Category check). No silent closes.
- **"Parked" is a real outcome.** Good ideas that need something the project doesn't
  have yet (usually repo context the engine can't see) are parked with the reason
  recorded, not rejected — see the worked examples in `risk-surface.md`.
- **Token changes wait on a maintainer-run check.** Vocabulary PRs touch the generation
  surface, so they merge only after the maintainer runs the eval harness (it needs API
  spend and keys that fork PRs can't have). That step is on the maintainer, not you.

There are no auto-accept windows, votes, or response-time promises. Disputes are argued
in the PR or issue — convincing the maintainer is the process. This model has recorded
loosening triggers (ADR 0036) and will be revisited when the project earns a second
maintainer.

## Code contributions

Bug fixes and features are welcome through ordinary PRs — run the verification commands
above before opening one. For anything architectural, read the relevant ADRs in
[`docs/adr/`](./docs/adr/) first and open an issue to discuss; several tempting features
(severity scores, AI-authored review comments, general-purpose bug hunting) are documented
non-goals, and a PR won't change that.
