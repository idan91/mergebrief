# packages/generators — agent notes

The `Generator` port and its adapter family (ADR 0013, ADR 0030, BRIEF-11):
structured generation — `(schema, system, user) → object valid against the
schema` — behind one contract. Home of the port vocabulary (`Effort`,
`Generation` provenance), the `AnthropicGenerator` adapter, the
enum-preserving structured-output schema (`outputFormat.ts`, the
server-enforcement lesson from PR #22), and enum salvage (`salvage.ts`).

## Invariants (enforced, don't weaken)

- **The structured-output floor is hard** (ADR 0013 #3): every adapter must
  return schema-valid output or throw — never a silent text-mode degrade.
  Native provider enforcement is a bonus layer, never the mechanism.
- **Abort is not a failure** (ADR 0006 #6): an abort rejection propagates to
  the caller untouched — no salvage, no feedback retry, no failure dump.
- **Provenance is honest** (ADR 0013 #5): `Generation` records what was
  requested/declared; capability gaps (no effort knob, unknown served model)
  surface rather than being papered over.
- **No secrets in errors**: error messages may name an env VAR, never echo
  its value, a key, or a connection string.

## Conventions

Repo-wide rules apply (root `CLAUDE.md`): no `enum`, strict TS, no bare
`as`, Zod at boundaries, named exports, extensionless relative imports.
`zod` is imported as `zod/v4`.

## Tests

`test/generator.test.ts` exercises the Anthropic adapter's parse-failure
path (salvage → feedback retry → dump-and-throw) against a stubbed SDK
client — a deliberate stub-level fake kept as the characterization anchor.
The generic salvage/outputFormat mechanics are covered here; their
integration with the real Brief schema stays in `tools/categorizer/test`
(the domain schema lives there — importing it here would cycle).

## Verification

```sh
pnpm -C packages/generators typecheck
pnpm -C packages/generators test
pnpm lint                        # repo-root oxlint --type-aware
```
