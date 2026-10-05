# packages/contract — agent notes

The HTTP agreement between apps that run as separate processes: what an API response carries, what a client sends, and the closed vocabularies both sides answer to. `apps/api` produces these shapes; `apps/web` and the CLI read them.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **Wire shapes only.** No route handler, no middleware, no database access, no re-export of the API app. If a consumer needs it to talk to the API over HTTP it belongs here; if it only exists inside one app, it does not.
- **Nothing runtime crosses in.** The stored vocabularies a payload field is typed by come from `types`, the same maps `persistence` types its columns by, so the wire shape and the stored value cannot drift into two spellings. `persistence` itself is not a dependency: it would drag drizzle and pg into the browser bundle through `apps/web`'s isomorphic `data/apiFetch`.
- **One owner per vocabulary.** A consumer imports the map, it never re-declares one. Where a consumer's shape legitimately differs, such as `apps/web`'s parsed `LastReviewComparison` with its `kind` discriminant, the difference is pinned with `Equals` against the shape here rather than mirrored by hand.
- **`apps/web` extends, it does not fork.** Its `ApiErrorCodes` spreads this package's map and adds the ONE web-local member, `malformed`, which never appears on the wire.

## Adding a wire error code

The recipe lives in `apps/api/AGENTS.md`; step 1 happens here, in `src/errors.ts`, and `test/wire-pin.test.ts` is what fails if the catalog does not follow.

## Verification

```sh
pnpm -C packages/contract test        # the catalog pin
pnpm -C packages/contract typecheck
```
