# Domain layout (enforced, don't weaken)

## Operation modules

The unit is the operation module: it takes the database handle or a narrow deps slice, the resolved access value and the parsed input, returns a `Result`, and sits behind a thin HTTP adapter. A domain converts with its own change, and its pass-through controller goes then. `repos/pr/archive`, `delete` and `ready` set the converted shape:

- `index.ts`, the route factory: each declaration with its adapter, the only file that touches Hono. An adapter reads `pullRequestAccess` (or `repoAccess`), parses any input (`schemas.ts`), calls the operation, throws a failure through `logic/wire-failures.ts`, stamps the audit target and answers `c.json(..., NO_STORE)`, `c.body(null, HttpStatuses.NO_CONTENT, NO_STORE)` when the success tells the caller nothing new, or `c.body(null, HttpStatuses.ACCEPTED, NO_STORE)` when the success only queues work.
- `<operation>.ts`, named for the operation (`mark-ready.ts`, `delete-pull.ts`): `(handle or a narrow deps slice, access, input?) → Promise<Result<T, XxxFailure>>`. It reads `access.row` and `access.rowScope` and never re-reads the row; GitHub goes only through `access.github`; writes go through `createTenantRepository(handle, access.rowScope)`, or through `createIngestRoutines(handle, access.rowScope)` for a write that queues generation work.
- `types.ts`: the failure union. A GitHub refusal rides whole: `github-denied { phase, error: GitHubCallFailure }`.
- `logic/wire-failures.ts`: failure to `ApiError`. A mutation's fresh re-resolve (`fetchFreshRepository`, `repos/logic/fresh-repository.ts`) answers through `resolveFreshRepositoryError(error, access.footing)`; every other GitHub failure goes to the mapper with its posture.
- The binding: the repo gate binds `access.github` (`ReviewerGitHub`) over the request's one `SessionCredential` (`access/session-credential.ts`) before its own repo read, and that read, the installation walk and the route all ride it. Binding decrypts and calls nothing; a 401 renews once per request across every binding; a token the session key cannot open answers 500 and keeps the session (`token.decrypt.fail`). Behind an operator pass the per-PR step rebinds with `operatorReads`: the granted PR, its known commits loaded only when a denied read at commits asks. A session-only route (`generate`, `inbox`, the repo list) has no access value: its adapter binds `bindRequestGitHub(deps, session, log)` and hands that `RequestGitHub` to the operation and to the shared installation resolvers. Wire suites swap in the `github/testing` fake through `AuthDeps.bindReviewerGitHub` (`test/reviewer-github.ts`).
- The App's binding: an App-credential call binds `bindRepoInstallationGitHub(deps, access)` (`access/installation-binding.ts`) over the injected `AppDeps.bindInstallationGitHub`, only for a repo resolved into an Installation; minting waits for the first call. Wire suites pass the fake's (`buildFakeInstallationDeps`).

## Handler and controller pair

Until a domain converts, and wherever it still earns the pair, the handler and controller roles below hold. Every catalog domain is a folder with a closed role set at root:

- `index.ts`: the `xxxRoute` factory; composition only.
- `handler.ts` exports a named `createXxxHandlers(deps)` factory returning the domain's handlers object. Members parse and validate (Zod), call the controller, judge posture, and throw `ApiError` subclasses; success is a plain `c.json(...)`. The handler derives the tenant and passes `tenant: TenantRepository` down. A handler never calls the controller inside the response expression; the result lands in a named const first.
- `controller.ts` exports a single named `xxxController` object; op functions module-private, 1:1 with handlers. Hono-free.
- `schemas.ts` / `utils.ts` (generic only) / `consts.ts` / `types.ts` (incl. the domain's `XxxControllerDeps`: narrow slices, never `AppDeps`; `log: Logger` rides deps).
- `logic/`: domain business logic; never at root, never in `utils.ts`.

A handler or controller body is orchestration only (~40 lines); computed logic extracts to a named, unit-testable function in `logic/`. Sibling routes sharing a path segment mount under one prefix in one routes file.

No per-domain repository files: persistence's tenant-scoped stores are called directly.

## Dev-only routes

`routes/local-briefs` is dev-only: it serves `MERGEBRIEF_OUT_DIR`, which `loadConfig` drops in the shipped image (`MERGEBRIEF_RUNTIME`) or under `NODE_ENV=production`; with no dir its paths answer as unmounted, while its queries stay in the catalog.
