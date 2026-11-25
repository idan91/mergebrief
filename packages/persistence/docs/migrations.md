# Migrations: expand and contract recipes

## Recipes

- An Expand step adds, copies or widens; a Contract step drops, rewrites or tightens.
- Default shape: never rename; add the new column, read new-with-fallback-to-old for one release, drop the old one next release.
- A true rename that needs live writes copied gets a sync trigger in the Expand step, dropped in the Contract step.
- A CHECK tightening accepts both values in Expand and rewrites then tightens in Contract.
- Which recipe fits is decided case by case in the PR description; a rename is never banned.

## The gate

`pnpm check:migrations` (`scripts/check-contracts.ts`) holds the rule grep-level, statement by statement: a migration with a `DROP` of a table, column, constraint, index, sequence, type, view, trigger, schema or function, a `RENAME`, an `ALTER COLUMN ... TYPE`, a `SET NOT NULL`, an `ADD COLUMN ... NOT NULL` with no `DEFAULT`, or a `DELETE FROM` must open with `-- contracts <release>` naming the release whose Expand step it finishes; the gate checks the line's shape, review checks the number.

A constraint drop needs no contracts line when the file carries `-- widens <name>` and re-adds a CHECK under that name; review, not the gate, judges that the new CHECK widens.
