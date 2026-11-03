# Contributing

The most valuable thing you can contribute to MergeBrief is not code. It's review vocabulary.

MergeBrief's taxonomy is the shared, versioned vocabulary of *what kinds of change exist*
(Categories, Concerns) and *what factual attributes make a chunk worth attention*
(Risk Surface). The engine's prompt and output schema are built from code maps that mirror
it: every token you register shapes what the tool can recognize in every PR anyone reviews with it. That
vocabulary lives in plain markdown in this repo, and sharpening it is the main
contribution surface.

If you have reviewed enough PRs to know that a factual pattern such as `removes-validation`
or `widens-trust-boundary` reliably deserves a second look, you already have something to
contribute here.

> **Where did the Playbooks go?** The per-Category checklist layer is **parked to v2**.
> No product surface consumes it and no new playbook items are accepted while parked. Any revival is bound to the
> layer's rubric identity: coverage *measurement* of finished reviews, never prompt
> material for reviewers or agents.

## Where everything lives

The vocabulary is split across files with a strict division of labor:

| File | Role |
|---|---|
| [`docs/vocabulary/labeling-schema.md`](docs/vocabulary/labeling-schema.md) | The authoritative **index** of valid tokens on every axis. A token not registered here is not valid, full stop. |
| [`CONTEXT.md`](./CONTEXT.md) | The **glossary**: what each concept means, what terms are deliberately avoided. |
| [`docs/vocabulary/risk-surface.md`](docs/vocabulary/risk-surface.md) | The per-attribute detail for **Risk Surface**: detection notes and reviewer implications. |

Always edit in that order: register the token in the index first, then write the deep
content. Never invent a token inline anywhere else.

## The schema

Three axes, three attach points. (Full glossary in [`CONTEXT.md`](./CONTEXT.md).)

- **Category**: the *intent* of a Change-group (`bugfix`, `lib-bump`, `schema-change`, …).
  One dominant per group, optional secondaries.
- **Concern**: the *artifact* a chunk touches (`implementation`, `test`, `doc`, `spec`,
  `config`, `generated`). Independent of Category.
- **Risk Surface**: zero or more *factual attributes* on a chunk (`no-tests`,
  `mutates-state`, `new-dependency`, …), in three buckets: about the code, about the change,
  about the blast radius. Facts a reviewer can check in seconds. Never verdicts. Severity,
  when it matters, emerges from combinations, and the reviewer makes that call.

All three vocabularies are **closed sets**. The engine's prompt and output schema are
built from code maps that mirror them, so an unregistered token cannot appear in a Brief. That closedness is
the point: it's what makes the same kind of change recognizable across every PR. Expansion
is deliberate, never casual.

### Risk-Surface attribute format

Each attribute entry in `risk-surface.md` carries:

- a **name** (kebab-case, factual, no severity words: `touches-auth`, never `dangerous-auth`),
- its **bucket** (code / change / blast radius),
- a **Detect** note: how a labeler or the engine recognizes it, as mechanically as possible,
- a **Reviewer implication**: what a reviewer should do differently because the attribute
  fires. If firing wouldn't change reviewer behavior, the attribute carries no information.

## How to contribute

### Add a Risk-Surface attribute (the best first contribution)

The bar (from `risk-surface.md`, "When to Add a New Attribute"):

1. The same observable pattern appears in **at least two real PRs**; cite them in your PR
   description.
2. No existing attribute already covers it.
3. It has a clear reviewer implication: the attribute would change what a reviewer does.

Then: register the token in `labeling-schema.md` (correct bucket), write the full entry in
`risk-surface.md`, and keep the name factual. If detection needs repo context the engine
doesn't have (registries, sibling files), expect it to be **parked** rather than accepted;
see the "Parked candidates" section of `risk-surface.md` for two worked examples of that
outcome and why.

### Sharpen an existing entry

Better detection notes, a sharper reviewer implication, or evidence that an attribute is
dead weight: all welcome, same evidence bar.

### Add a Category

The rarest change, and the highest bar, because every Category dilutes the recognizability of the
others. Be ready to show that real Change-groups exist whose intent no current Category
expresses (and that the gap isn't actually a Concern, the classic mistake: `test-only` and
`config-only` looked like Categories and were not). Register in `labeling-schema.md` and
describe in `CONTEXT.md` in the same PR. (While the playbook layer is parked, no checklist
ships with it.)

### Deprecate a token

The library stays sharp by shedding, too. A token that never fires across 10+ PRs, or always
co-fires with another (redundant), should be dropped. Bring the evidence; remove it from the
index and the deep file together.

## Keeping docs and code in lockstep

The markdown is the source of truth; the code mirrors it. A PR that changes *tokens* (adds,
renames, or removes one) must update the mirrors in the same PR:

- `packages/brief-core/src/types.ts`: the closed Concern, Role and Risk Surface maps the
  output schema validates against.
- `packages/types/src/reviews.ts`: the closed Category map. A database CHECK in
  `packages/persistence` reads it, so a Category change also needs a migration.
- `packages/brief-core/src/generation/prompt.ts`: the description maps interpolated into the prompt.
- `packages/i18n/src/locales/en.json`: the `brief.category.*` and `brief.risk.*` labels the web
  app shows. Its label maps are keyed by the code maps, so a missing label fails typecheck.
- `packages/repo-config/src/constants.ts`: `FLOOR_ATTRIBUTES` and `PARKED_ATTRIBUTE_CANDIDATES`,
  when the token is a floor attribute or a parked candidate.

Token changes touch the generation surface, so [the eval harness](#the-eval-harness)
applies. Verify the change with
[the gates a pull request must pass](#gates-a-pull-request-must-pass).

Docs-only PRs need no build step. Yes, the mirror step is manual for now; generating the
code from the markdown is a welcome future contribution.

## Ground rules

- **No verdicts, anywhere.** No severity grades, no "critical", no scores, no "this is
  probably a bug". Attributes are facts. This is the product's critical rule and it
  applies to contributed content too.
- **Register first.** The index in `labeling-schema.md` gates validity. Deep content for an
  unregistered token will be bounced back.
- **`uncertain` is a valid output.** Don't design tokens that force a judgment the
  evidence can't support.
- **Terminology matters.** `CONTEXT.md` records the words this project uses and the ones it
  deliberately avoids. Match it; propose changes to it explicitly rather than drifting.

## Governance

One maintainer, stated plainly: **final call on every contribution (vocabulary, code,
docs) rests with the maintainer.** What you can rely on in exchange:

- **Reasons, always.** Every accept, reject, or park gets a short written reason in the
  PR thread, tied to the published bars above (evidence rule, deprecation rule, the
  Concern-vs-Category check). No silent closes.
- **"Parked" is a real outcome.** Good ideas that need something the project doesn't
  have yet (usually repo context the engine can't see) are parked with the reason
  recorded, not rejected; see the worked examples in `risk-surface.md`.
- **Token changes wait on a maintainer-run check.** Vocabulary PRs touch the generation
  surface, so they're applied only after the maintainer runs the eval harness (it needs API
  spend and keys that fork PRs can't have). That step is on the maintainer, not you.

There are no auto-accept windows, votes, or response-time promises. Disputes are argued
in the PR or issue: convincing the maintainer is the process. This model has recorded
loosening triggers and will be revisited when the project earns a second maintainer.

## How a pull request lands

Day-to-day development happens in a private repository. This public repository
receives one snapshot commit per release, exported from it, so a pull request here
is never merged as-is. It goes like this:

1. **Review happens here, in public.** Discussion, change requests and the accept or
   reject reason all stay on your pull request.
2. **An accepted change is applied upstream.** The maintainer applies it to the private
   repository with a `Co-authored-by:` trailer naming you. The release commit here
   carries every such trailer since the previous release, so GitHub credits you on it.
3. **The pull request is closed with a link to the release that ships it.** Your change
   reaches this repository inside that release's snapshot, not as a merge of your
   branch. A closed pull request with a release link means it shipped.

The close waits for the next release, so expect a gap after acceptance.

## Translations

The UI ships English-only today; every other locale is community-contributed. A locale
PR touches two files, `packages/i18n/src/locales/<id>.json` plus one registry row, and the
package's test suite is the review bar (mechanical checks hard-fail; completeness only
reports, so partial locales ship and fall back to English). The full walkthrough lives in
[`packages/i18n/README.md`](./packages/i18n/README.md). Machine translation is fine as a
declared, human-reviewed starting point. Right-to-left locales are not yet supported, so
open an issue before starting one.

## Code contributions

Bug fixes and features are welcome as pull requests. Run
[the gates](#gates-a-pull-request-must-pass) before opening one. For anything architectural, open an issue to discuss first; several tempting features
(severity scores, AI-authored review comments, general-purpose bug hunting) are non-goals
listed in [`docs/vision.md`](docs/vision.md), and a PR won't change that.

A vulnerability never goes in a public issue or pull request. Report it privately as
[`SECURITY.md`](./SECURITY.md) describes.

## Development setup

### Tools

- **Node**, at the version `.nvmrc` names. CI reads the same file, and
  `engines` in the root `package.json` states the range the tooling accepts.
- **pnpm**, at the version the root `package.json` pins in `packageManager`.
  This is a pnpm workspace: `apps/*`, `packages/*` and `tools/*`, each with
  its own scripts. Run a member's script with `pnpm -C <member> <script>`,
  for example `pnpm -C apps/api test`.
- **Docker**, for the local Postgres and for the end-to-end suite.

### Install and run

```bash
pnpm install
cp .env.example .env
```

Fill in `.env` as the README's
[Quickstart](./README.md#quickstart-local-dev-loop) describes: a dev GitHub
App's credentials, `SESSION_KEY_V1`, a provider key, and a host
`DATABASE_URL` for the compose Postgres. Then:

- `pnpm app:host` starts the compose Postgres and runs the api, the worker
  and the web app on your machine with `.env` loaded. This is the full
  loop: briefs generate.
- `pnpm dev` runs only the api and the web app. Nothing generates under it.
- [`docs/dev/webhook-loop.md`](./docs/dev/webhook-loop.md) adds a tunnel so
  real GitHub webhooks reach your machine.

### Gates a pull request must pass

Judge each by its exit code, not its output.

- **`pnpm lint`** runs, in one chain that stops at the first failure:
  oxlint (type-aware), dependency-cruiser, knip, `prettier --check`, the web
  stylesheet lint, and five repository checks: `check:catalog` (the CLI's
  operation map against the API's operation table), `check:config`,
  `check:migrations`, `check:releases` and `check:baselines`. `pnpm format`
  fixes formatting.
- **`check:baselines`** compares your working tree with its merge base
  against `main`. In a clone with no local `main`, set
  `MERGEBRIEF_BASELINE_BASE=origin/main`; a base it cannot resolve fails
  the gate.
- **`pnpm -C <member> typecheck`** and **`pnpm -C <member> test`** for each
  app, package or tool you touched. Root `pnpm test` runs only
  `tools/categorizer`; `pnpm -r typecheck` and `pnpm -r test` run every
  member.
- **Coverage floors** ride inside each member's `test`: its vitest config
  commits a lines threshold, and a drop below it fails. The standard is 75%;
  `apps/api` holds 85%. Never lower a floor to absorb a drop.
- **`pnpm -C apps/web test:e2e`** when you touch the web app or anything it
  calls. Playwright's global setup starts its own Postgres container, so
  Docker must be running; install the browser once with
  `pnpm -C apps/web exec playwright install chromium`.
- **`pnpm -C apps/web build`** when you touch web code that runs on both
  server and client. Only the build catches a client import of server-only
  code.
- **`pnpm -C apps/cli build`** and **`pnpm -C apps/cli docs:check`** when
  you touch the CLI. `pnpm -C apps/cli docs:appendix` rewrites the appendix
  `docs:check` compares.
- **Generated files** are committed, and CI fails on any drift. A change
  under `apps/web/src/routes/` regenerates `routeTree.gen.ts` through
  `pnpm -C apps/web build`; a change under `packages/persistence/src/schema/`
  needs `pnpm -C packages/persistence generate`. Commit what they write.
- **`pnpm audit --prod --audit-level=high`** when you add or bump a
  dependency.

The real-Postgres suites in `apps/api`, `apps/worker` and
`packages/persistence` skip locally unless `MERGEBRIEF_TEST_POSTGRES_URL`
points at a throwaway database; CI runs them.

### The eval harness

A change to the generation surface, such as the prompt, the output schema,
its validators, or the vocabulary maps above, is checked against the eval
harness before it lands. Do not run it yourself: it spends API credit on
keys a fork does not have. Say in your pull request which eval cases your
change could move and why, and the maintainer runs them.

## License and the DCO

Contributions land under the repository license, `FSL-1.1-ALv2` (see `LICENSE`).
By opening a pull request you certify the Developer Certificate of Origin for its
commits: that you may contribute the change under that license. No contributor
license agreement, no sign-off trailer.
