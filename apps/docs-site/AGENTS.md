# apps/docs-site: agent notes

The public docs site: VitePress builds the pages under `docs/` as they are, with no edits to them. Static output only: `wrangler.jsonc` serves `.vitepress/dist` as a static-asset Worker, deployed from a release tag by `.github/workflows/deploy-sites.yml`.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

**Composition root: `.vitepress/config.ts`**, the only reader of `process.env`:

- `MERGEBRIEF_DOCS_VERSION`: release version; off-site links point at the `v<version>` tag. Unset: `main`.
- `MERGEBRIEF_DOCS_BASE`: the site's `base`, default `/`.
- `MERGEBRIEF_DOCS_SITE_URL`: set, it turns on the sitemap with that host. No host is built in.

What the layout can't show:

- `src/pages/consts.ts` `SITE_PAGE_GLOBS` is the one place a page joins the site. Every other markdown file under `docs/` lands in `srcExclude`, so a new folder stays off the site until it is added there. `docs/README.md` builds as the home page and sits in no sidebar group. A page's title is its H1; a release note has none and takes its version from the filename.
- `src/pages/sidebar.ts` builds the sidebar from `GROUP_RULES`: each rule claims pages by path and sorts them by its order array in `src/pages/consts.ts`; releases sort newest first. `SELF_HOST_SECTIONS` is Self-hosting's order and also its collapsible phase sub-groups, labelled from `docsSite.sidebar.*`. A page left off its order array sorts last by path (in Self-hosting, after the sub-groups), so a new page is placed in its array deliberately.
- `src/links/` is a markdown-it core rule that rewrites every relative link written for GitHub. A link to a site page becomes its root-absolute site path, and VitePress applies `base` and its dead-page check. A link to any other file or folder in the repo becomes a GitHub URL at the version ref; a missing file, a missing `#anchor` in such a markdown file, or a target outside the repo fails the build.
- `src/anchors/` slugs headings with GitHub's slugger, so an `#anchor` written for the repo resolves on the site. VitePress drops the fragment before its dead-link check; `buildEnd` runs `findDeadAnchors` over the built HTML and fails the build on a missing page or anchor.
- `.vitepress/theme/tokens.css` restates the product palette from `apps/web/src/styles/tokens.scss` onto VitePress's `--vp-*` variables; a palette change there is copied here by hand. `apps/web/src/styles/docs-site-tokens.test.ts` holds the dark theme to the web tokens, and CI does not run it for a change here alone: a change to `tokens.css` runs `pnpm -C apps/web test` locally before pushing. Dark is the product's; light is derived at the same hue and grey chroma. Default appearance is dark. `src/syntax.ts` picks GitHub's code themes and lifts the one light token under 4.5:1.
- `public/favicon*`, `public/apple-touch-icon.png` and `.vitepress/theme/mergebrief-wordmark.svg` are byte-identical copies of apps/web's committed brand assets: a change lands in both. The nav lockup is `favicon.svg` as the theme `logo` plus the wordmark painted as a mask over the site title, which stays the link's accessible name; `theme/chrome.css` sizes it to DESIGN.md's Header lockup.
- A page reads the same on GitHub and on the site, so it uses only what GitHub renders: a callout is a GitHub alert (`> [!WARNING]`), never a VitePress `:::` container. VitePress 1.6 never hands its container labels to its alert plugin; `src/alerts.ts` gives an untitled alert its `docsSite.alerts.*` title.
- `src/search.ts` is the local search's `_render` hook: it writes each page's sidebar trail (`readPageTrail`) before its H1 in the search index only, and gives a release note an H1 there, so a result names the group it sits in. The page itself renders unchanged.
- `src/vue-resolve.ts`: `docs/` sits outside the member, so the SSR build cannot resolve a page's `vue` import under pnpm's isolated layout. The plugin resolves it from VitePress's own package, so the site uses the one `vue` VitePress depends on and the member declares none.

## Invariants

- **Run under tsx.** `dev`, `build` and `preview` start VitePress through `node --import tsx`: VitePress bundles the config with workspace packages left external, and Node cannot load the `i18n` source without the loader. Plain `vitepress build` fails.
- **Copy:** every site string that is not a proper noun reads a `docsSite.*` catalog key through `t()` (`src/labels.ts`): description, sidebar groups, and every theme label VitePress takes as an option. `MergeBrief` and `GitHub` stay literal. Labels VitePress does not expose as options keep its defaults.
- **Build failures throw.** The link rule and the anchor check throw to fail the build, each naming the page and every bad link; the resolvers under them return `Result`.
- **All dependencies are devDependencies:** nothing here ships at runtime.
- **CI selection:** the `checks` job builds the site when a diff matches `docs_changed` in `.github/workflows/ci.yml`. A page that links a new file outside `docs/` widens that pattern in the same change, or CI misses the target's removal.

## Verification

`pnpm -C apps/docs-site typecheck` / `test` / `build`; repo-root `pnpm lint`.
