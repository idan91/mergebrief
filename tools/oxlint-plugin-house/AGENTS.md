# tools/oxlint-plugin-house: agent notes

The house oxlint plugin. Every repo convention oxlint has no native rule for lives here as a selector rule; `.oxlintrc.json` loads it through `jsPlugins` and turns each rule on by id (`house/<rule>`).

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

- `src/index.mjs` is the plugin (`meta.name: "house"`); `src/rules/` holds one file per rule, peers with no barrel.
- `test/fixtures/<rule>/` holds one `bad` and one `good` file per rule, plus an `ignored` file where the rule has ignore options, and the fixture config; a rule whose verdict depends on the filename adds a folder per shape (`no-re-export/bad-barrel/index.ts`). `test/rules.test.ts` spawns the pinned oxlint over them and asserts rule id and line, one rule per fixture.

## Invariants

- Rules are plain `.mjs` with JSDoc types, checked by `tsc --checkJs`. oxlint loads plugins through Node with no TypeScript loader, so this tool is the one stated exception to TypeScript source; the fixture tests are its type safety.
- A rule ships with its fixtures first: the `bad` file lists every shape the rule must report, the `good` and `ignored` files every shape it must pass. `no-re-export`'s and `no-shout-case-copy`'s bad fixtures end each reporting line with `// reports`, and the tests read the expected lines from those markers.
- A `good` fixture shows the idiom the repo actually wants, not merely a shape the rule tolerates. A string outside the rule's reach (an ignored callee, attribute or key) goes in an `ignored` fixture beside the pair, never in `good`: it proves the rule leaves the string alone, and the code around it is not an idiom. The fixture tree is lint-ignored, so nothing enforces the repo's conventions inside it and review is the only check.
- Fixture configs carry their own rule options, chosen to exercise the rule rather than to mirror the repo's setting: `comment-run` runs at four content lines here and eight at the root.
- A rule reads syntax only. Anything needing type information stays prose in the root rules.
- The oxlint version pinned here matches the root; the plugin API is alpha and a bump reruns the fixtures. `dependency-cruiser` is pinned the same way: the config contracts must run the binary `pnpm lint` runs.
- `test/root-config.test.ts` and `test/package-layers.test.ts` run the real root configuration over throwaway trees, and `pnpm test:config` is the gate's entry point. A negative assertion pairs with a positive in the same run, so an empty diagnostic list can never mean the run never happened, and every reported rule carries its severity, so a rule demoted to `warn` fails the contract instead of passing it.
