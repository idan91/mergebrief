# apps/web file placement and imports

Refines the root file-shape and import rules for apps/web's feature tree.

## Folders

- Every folder answers at a glance: one visible MAIN entry, everything else in a visible support category. A feature root = `index.tsx` (THE entry: the component's JSX, or a curated re-export when it has co-located support files), plus `types.ts` and `components/` / `hooks/` / `utils/` / topic folders.
- Inside `components/`, every component nests under its owning component, and a consumer reaches its support one segment below the folder (`@web/components/Menu/types`). The stylesheet keeps the component name (`Menu/Menu.module.scss`).
- A loose uncategorized file is a defect unless its placement is argued and recorded (`brief/queries.ts`).

## Imports

- A feature's internal files import targets directly, never their own feature's index. A barrel never re-exports anything touching `server/` (import-protection breaks the client build).
- The global `src/components`, `src/hooks`, `src/utils`, `src/data` and `src/test` folders never import `src/features`; `src/routes` may import feature indexes. Wanting a deeper import is the promotion signal: co-locate with the single consumer, and on a second consumer promote to the nearest common ancestor (parent component, feature root, then global). Anything touching a feature's store or queries never sits above that feature.
- **The Brief feature is two layers**, `model/` and `ui/`. `features/brief/model/` and `queries.ts` beside it import no other feature and nothing of `ui/`; `features/brief/ui/` holds the components, the rendering hooks and their modules. Review imports the Brief through `brief/model`, and its tests through `brief/test-utils`; pulls composes `ui/` through the Brief entries; `ui/` never imports pulls. dependency-cruiser holds each edge: `web-brief-model-imports-no-feature`, `web-review-imports-brief-model-only`, `web-pulls-imports-brief-entries-only`, `web-brief-never-imports-pulls`.

## Test helpers

- A feature's own test helpers live in its `test-utils/` folder (or a `test-utils.ts(x)` file); only a `*.test.*` file or another test-utils module imports one (`web-test-utils-only-in-tests`). Brief model tests import `brief/test-utils/fixtures` alone, never the index that loads the render helpers.
- Fixtures no single feature owns live in `src/test`; one typed by a feature's model stays in that feature's `test-utils/`, even when other features' tests use it.
