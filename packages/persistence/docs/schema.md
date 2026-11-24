# Schema: CHECKs, vocabularies, column types and indexes

## CHECKs and vocabularies

- Every CHECK is built by `schema/checks.ts` from the `as const` map the column is typed by, or from the shape pattern its Zod schema also parses with. `test/schema-checks.test.ts` builds a database from the schema alone and fails when its CHECKs differ from the migrated ones, so a CHECK written only in SQL, or a vocabulary value added without `pnpm generate`, is red.
- `api_token.scope` is typed by `AccessLevels` from `types/access-levels`, the same map the Product Operation table classifies every operation by; this package owns neither a copy nor a re-export. `audit_log.classification` narrows the same map (`read` is never audited) instead of forking it.
- **`GenerationFailureCodes` is the widest of those locksteps.** It is the DB-stored failure vocabulary (distinct from the store-internal `GenerationErrorCodes`), so a new code needs THREE changes together: the `as const` map in `packages/types/src/generations.ts`, a CHECK migration, and a `generationError.<code>` template in `packages/i18n`. `apps/web` imports the map from `types` and drops a code its bundle predates (`dropInvalidKeys`), rendering the generic failed line.

## Column types

A column SQL reads, filters or orders takes its native type (`text[]`, `jsonb`, an integer). A JSON document read whole is `text` through `jsonDocument` (`schema/columns.ts`) with an `IS JSON` CHECK, behind its Zod schema: artifact bodies, `repo_config`, `hunk_span.spans`. `jsonDocument` replaces NUL and lone surrogates at write, so a `::jsonb` cast reads every stored row. A new query on a value inside a document gives the value its own column, then an expression index on the cast; `jsonb` only once searching arbitrary fields is a product feature.

## Indexes

An index earns its place by serving a per-request read on a non-key column or a sweep that deletes by a timestamp range. Every foreign key column also leads an index: a parent delete scans the child for it, and the sweeps delete parents in bulk (`test/schema.test.ts` holds this). Admin and one-off reads seq-scan: at self-host scale the write cost on append-heavy tables outweighs them.
