# apps/web data layer

A write a user action fires also follows `apps/web/docs/mutations.md`.

## Requests

- One named function per operation over `data/request`'s `request` / `requestText`, which read method and path from the contract's operation table. Components and query builders call the named function, never `request`.
- `data/apiFetch` is the transport underneath (isomorphic: SSR forwards the viewer's cookie to the API over HTTP, through the SAME authz gate). Only a route outside the table, or a caller that reads the raw response (the upload's `Retry-After`), calls it directly.
- A `build*QueryOptions` builder infers its return, as a facade does: the inferred type carries the query-key tag `setQueryData` and `useQuery` read back.
- A read returns `request(id, { params }, schema)` and throws `ApiError`. A write calls `request` in a `try` and maps the caught error through `readFailureKind` and a partial kind table with a `fallback`: a 401 comes back as the shared `WriteFailureKinds.UNAUTHORIZED` unless the table names it, and a network throw or 504 as `INDETERMINATE`.

## Parsing

- A one-off guard private to a single operation stays beside the operation, not in `schemas.ts`. URL search params and text grammars (diffs, markdown, headers) stay hand-written.
- A read over `request` hands it the schema directly. A `parse*` wrapper exists only for a caller that parses outside `request`, and calls `parseWithSchema` (`utils/parse-with-schema`).
- The exported type stays a hand-written interface, and the test pins `Equals<z.output<typeof schema>, Interface>`. A transform returns its literal `satisfies Interface`, never an annotated return, or the pin compares the interface with itself. Optional fields are `.exactOptional()` and `.readonly()` matches the interface.
- A wire `null` the interface keeps absent goes through `dropNullKeys`, and an optional field whose bad value must drop rather than fail its object goes through `dropInvalidKeys` (`utils/drop-keys`). Each wraps a plain object schema or the other helper's result, so `.readonly()` and a union wrap the helper, never the reverse.
- A REQUIRED closed-vocabulary field, or an optional one whose absence carries a default meaning, reads through `buildOpenEnumSchema(Map)` (`utils/open-enum`), so a member this bundle predates reads as `UnknownValues.UNKNOWN` and the interface widens the field with `UnknownValue`. Every renderer of such a field gives `unknown` a neutral rendering (`packages/contract/AGENTS.md`, Reader tolerance).
- Route tests that seed the query cache BYPASS the wire parsers. Pair them with queryFn-level tests against realistic wire bodies; a wrong parser can otherwise ship green.
