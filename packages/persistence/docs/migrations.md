# Migrations: expand and contract recipes

The rule itself (Release N-1 keeps working beside release N) lives in `../AGENTS.md`. This file holds the recipes and the gate's exact scope.

## Recipes

- An Expand step adds, copies or widens; a Contract step drops, rewrites or tightens.
- Default shape: never rename; add the new column, read new-with-fallback-to-old for one release, drop the old one next release.
- A true rename that needs live writes copied gets a sync trigger in the Expand step, dropped in the Contract step.
- A CHECK tightening accepts both values in Expand and rewrites then tightens in Contract.
- The split is decided case by case in the PR description, never a ban.

## The gate

`pnpm check:migrations` (`scripts/check-contracts.ts`) holds the rule grep-level, statement by statement: a migration with a `DROP` of a table, column, constraint, index, sequence, type, view, trigger, schema or function, a `RENAME`, an `ALTER COLUMN ... TYPE` or a `SET NOT NULL` must open with `-- contracts <release>` naming the release whose Expand step it finishes; the gate checks the line's shape, review checks the number.

A constraint drop needs no contracts line when the file carries `-- widens <name>` and re-adds a CHECK under that name; review, not the gate, judges that the new CHECK widens.

## History

- Before the first release there was no N-1 to keep working: expand and contract collapsed into one migration that moved the data in the same step, with `-- contracts 0.1.0` as its first line so the gate stayed green.
- The one exception to append-only SQL: before the first release, on 2026-11-10, the chain was squashed once into the `0000` baseline.
