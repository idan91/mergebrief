# tools/oxlint-plugin-house — agent notes

The house oxlint plugin. Every repo convention oxlint has no native rule for lives here as a selector rule; `.oxlintrc.json` loads it through `jsPlugins` and turns each rule on by id (`house/<rule>`).

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

- `src/index.mjs` is the plugin (`meta.name: "house"`); `src/rules/` holds one file per rule, peers with no barrel.
- `test/fixtures/<rule>/` holds one `bad` and one `good` file per rule plus the fixture config; `test/rules.test.ts` spawns the pinned oxlint over them and asserts rule id and line.

## Invariants

- Rules are plain `.mjs` with JSDoc types, checked by `tsc --checkJs`. oxlint loads plugins through Node with no TypeScript loader, so this tool is the one stated exception to TypeScript source; the fixture tests are its type safety.
- A rule ships with its fixtures first: the `bad` file lists every shape the rule must report, the `good` file every shape it must pass.
- A `good` fixture shows the idiom the repo actually wants, not merely a shape the rule tolerates. The fixture tree is lint-ignored, so nothing enforces the repo's conventions inside it and review is the only check.
- Fixture configs carry their own rule options, chosen to exercise the rule rather than to mirror the repo's setting: `comment-run` runs at four content lines here and eight at the root.
- A rule reads syntax only. Anything needing type information stays prose in the root rules.
- The oxlint version pinned here matches the root; the plugin API is alpha and a bump reruns the fixtures.
