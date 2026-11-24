# apps/web: agent notes

The TanStack Start front end: the DB-backed read + submit surface, fed by `apps/api` for both App-installation and URL-box briefs.

## Topic docs

- **Data**: adding or changing an API read or write, a query builder, or a zod parser: read `apps/web/docs/data.md`.
- **Mutations**: writing to GitHub or any external system, or mirroring an API rejection client-side: read `apps/web/docs/mutations.md`.
- **Components**: building a component or hook, placing state, adding a `data-*` attribute, or touching the version notice: read `apps/web/docs/components.md`.
- **Placement**: adding, moving or importing a file, or writing a test helper: read `apps/web/docs/placement.md`.
- **Styling**: writing `.module.scss`, a token, or a brand asset: read `apps/web/docs/styling.md`.

## Composition root

- `src/server/env.ts` is the one `process.env` reader, and `src/server/logger.ts` and `src/server/api/transport.ts` are the sanctioned process singletons built from it.
- `src/serve.ts` is the production process (`docker-entrypoint.sh web`): srvx over `dist/`, with the host check and the shutdown drain in `src/server/serve/`. `src/instrument.ts` is its telemetry preload (`--import` ahead of `serve.ts`), which starts `logging/tracing` from the `OTEL_*` config; `vite dev` runs without it. `vite preview` is never the production server.
- This tier holds NO credentials and no database: `/api/*` is proxied to the API process, and SSR reaches it through the same transport so a render meets the same authorization the browser would.
- The framework reads three `src/` entries by name (TanStack Start defaults): `router.tsx`, `server.ts` and `start.ts`. `start.ts` registers the error serialization adapters (an `ApiError` crosses SSR as its code and status, any other error without its message) and keeps Start's CSRF guard. The router's `defaultErrorComponent` and the root's `errorComponent` are `components/PageError`; the root's document is its `shellComponent`, so that screen renders inside it.
- **Security headers ride two seams.** `src/server.ts` stamps `contract`'s `SECURITY_RESPONSE_HEADERS` on all it answers, proxied `/api` included, and `server/serve` stamps what never reaches it (client files, host and method refusals). A header already on the response wins. The demo build has no listener: its static host owns its headers.

## Edge contracts

- **apps/web runs no server functions for data.** A read or write the app needs is an `apps/api` route reached through a named function in `data/request`; a dev-only surface is a dev-only API route. Never reach persistence from a server function: that would be a second enforcement path. `src/server/` is app-wide infrastructure only (env, logger, API transport, health, the refused paths). Lint bans `createServerFn` in `apps/web/src`.
- **JSON from the API or storage parses through a zod schema** in the owning feature's `schemas.ts`.
- **Error components render a curated mapper** (`briefErrorDetail` / `prBriefErrorDetail`), NEVER `error.message`: even an `ApiError`'s embeds the request path. Messages reflecting caller input (a pasted URL) are curated too: they land in a `role="alert"`.
- Copy: every `.ts` and `.tsx` literal that is sentence-shaped or Capitalised lives in the catalog; the copy lint holds it in `all` mode, and `house/no-shout-case-copy` holds the SHOUT_CASE consts i18next skips. A component reads `useTranslation()`; a pure helper takes a `TFunction` first parameter; a data structure stores a `TranslationKey` and resolves at render. The wire carries a code, never a sentence.
- `.oxlintrc.json` exempts the copy that stays English by shape: the receipt (`features/review/utils/receipt.ts`, frozen English shown in the submit flow and never posted to GitHub; its counts ride on the signature line), the review body `features/review/utils/submit.ts` posts to GitHub (the signature line and the fold preamble), head meta (`routes/__root.tsx`), and the dev fixtures (`features/brief/test-utils/fixtures.ts`, `features/inbox/test-utils.ts`, `**/characterization/**`). Repo-authored strings passed through verbatim (`criteria`/`implication`) stay English too.

## Logging

- Isomorphic and shared client/server modules INJECT their log sink (a narrow `{ warn }`/`{ error }` interface `packages/logging`'s `Logger` satisfies); they never import `server/logger` (`server-only`). No sink = silent, which is correct client-side only (a browser has no operator). EVERY server-side caller passes one; `data/ssrWarnSink`'s `getSsrWarnSink()` is the resolver for call sites that run on both sides. Forgetting it is silent by construction: a review checkpoint, not a lint error.
- **Hoist singleton accessors** (`getServerLogger()` and kin): assign once at module scope, or once per composition function, and use the const at every call site. Deferring construction is only justified when the accessor cannot do its own env lookup internally (the `ssrWarnSink` isomorphic path stays lazy by design).
- **Client code may `console.error` on unexpected failure**; the user sees the failure via UI state, never a raw message.

## Every change

- **Never gate behaviour on how a visually identical mode was entered.** If two states look the same, a behavioural difference between them is indistinguishable from a bug. Key behaviour on the visible state, or make the modes visibly distinct. When the same defect is reported a third time after two verified fixes, question the design rather than the code.
- **Every interactive change declares its accessibility contract** before review, not during: where focus lands, how async outcomes are announced, targets ≥ 24px.

## Verification

```sh
pnpm -C apps/web typecheck
pnpm -C apps/web test      # characterization harness included
pnpm -C apps/web lint      # stylelint (prettier rides repo-root pnpm lint)
pnpm -C apps/web build     # REQUIRED for isomorphic/server-only changes
pnpm -C apps/web test:e2e  # playwright against a fresh production build;
                           # global setup runs its own postgres container
pnpm -C apps/web perf:fixture && pnpm -C apps/web perf:measure
                           # perf suite; the fixture is generated, never committed
```

`build` is required because TanStack Start's `import-protection` plugin statically denies any CLIENT-graph edge reaching `@tanstack/react-start/server-only`, dynamic `import()` and unreachable `typeof window` branches included, and ONLY `build` fails such a graph (typecheck, test, and lint all pass it). Reach server-only code from an isomorphic module via `createIsomorphicFn().server(...)` with the import inside the branch (`data/apiFetch.ts`, `data/ssrWarnSink.ts` are the templates); a read that must stay synchronous may import statically when only that branch uses the import (`diff-view-storage.ts`).

No vitest globals in this repo: `@testing-library/react` does NOT auto-cleanup: add `afterEach(cleanup)` or the previous test's DOM leaks into the next test's `screen` queries. Component/hook tests need the `// @vitest-environment jsdom` pragma.
