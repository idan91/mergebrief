# packages/contract — agent notes

The HTTP agreement between apps that run as separate processes: what an API response carries, what a client sends, and the closed vocabularies both sides answer to. `apps/api` produces these shapes; `apps/web` and the CLI read them.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **Wire shapes only.** No route handler, no middleware, no database access, no re-export of the API app. If a consumer needs it to talk to the API over HTTP it belongs here; if it only exists inside one app, it does not.
- **Nothing runtime crosses in.** The stored vocabularies a payload field is typed by come from `types`, the same maps `persistence` types its columns by, so the wire shape and the stored value cannot drift into two spellings. `persistence` itself is not a dependency: it would drag drizzle and pg into the browser bundle through `apps/web`'s isomorphic `data/apiFetch`.
- **One owner per vocabulary.** A consumer imports the map, it never re-declares one. Where a consumer's shape legitimately differs, such as `apps/web`'s parsed `LastReviewComparison` with its `kind` discriminant, the difference is pinned with `Equals` against the shape here rather than mirrored by hand.
- **`apps/web` extends, it does not fork.** Its `ApiErrorCodes` spreads this package's map and adds the ONE web-local member, `malformed`, which never appears on the wire.

## Reader tolerance

An unknown value in a closed vocabulary never fails more than the smallest unit holding it. A browser tab opened before a server upgrade keeps working when the server starts sending a member the tab's code predates:

- an optional field with an unknown value is dropped and reads as absent;
- a required field with an unknown value reads as the web-only sentinel `unknown`, and the UI renders it neutrally: no badge, a generic line, never a crash and never a wrong specific label;
- one list item never fails its list because of a vocabulary value.

The CLI relays raw values and is outside this rule. A field added in release N stays optional to readers for one release.

## Operation table

- `src/operations/index.ts` holds the operation table (its vocabularies in `types.ts` beside it): one row per Product Operation keyed by its id, carrying kind, classification (its rung on `AccessLevels`), method and full path. It is the one place a full path is written; clients build requests from the row through `buildOperationPath` (`src/operation-path.ts`), which encodes each param and refuses a dot segment.
- A new operation adds its id to `ProductQueryIds` or `ProductActionIds` and its row here first; a missing row or a row of the wrong kind is a compile error.
- `apps/api` mounts each route under its row's method, composes its path mechanically and asserts every composed `METHOD /full/path` against the row at commit, so the table and the served surface cannot drift. A method change edits only the row; a path change edits the row and the route's relative path.
- Policy beyond the classification (`browserSessionOnly`, `requiresPushAccess`, `requiresInstallation`, `requiresStoredPullRequest`) stays on the api declaration, keyed by the id.

## Adding a wire error code

The recipe lives in `apps/api/AGENTS.md`; step 1 happens here, in `src/errors.ts`, and `test/wire-pin.test.ts` is what fails if the catalog does not follow.

`parseApiErrorBody` is the one reader of the wire error body: every client resolves a `{ error, code }` through it, never by probing the fields itself.

## Verification

```sh
pnpm -C packages/contract test        # the catalog pin
pnpm -C packages/contract typecheck
```
