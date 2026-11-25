# Wire error codes

## Classes (enforced, don't weaken)

`src/shared-errors/` holds abstract `ApiError(code)` + exactly one class per HTTP status a wire code carries (`BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `PayloadTooLarge`, `TooManyRequests`, `InternalError`, `BadGateway`, `ServiceUnavailable`, `GatewayTimeout`). `CodeFor<status>` constrains each class to codes of its status, so class/status/code cannot disagree.

## Layering (enforced, don't weaken)

Controllers are Hono-free and return `Result<T, XxxFailure>` for anything the handler must judge. They THROW only terminal, posture-free failures, never `Forbidden`/`NotFound` for a GitHub denial (that bypasses the uniform-404 collapse). Handlers own posture and the failure→throw mapping, which lives in the domain's `logic/wire-failures.ts` (a single trivial switch may stay inline).

A GitHub failure becomes its `ApiError` through ONE mapper, `resolveGitHubDenialError(failure, posture)` (`shared-errors/github-denial`): `wire-failures.ts` answers its domain's own codes first (diff-too-large, file-absent, anchor-rejected, and kin) and hands the rest over with the call's posture.

- `collapse` is a read on the viewer's credential (403 → 404).
- `honest` is a viewer write whose 403 is an FE-actionable capability signal (403 `github-permission`).
- `app-read` and `app-write` are the same two on the installation credential, where a 401 is the instance's and answers 502.
- On the viewer's credential a 401 answers 401, refreshed or not; an outage or rate limit is 502 everywhere, never 404.

Shared failure members wrap lower-layer errors whole (`github-denied { phase, error }`, `session-rejected { error }`). No translating at the boundary. `Failure` = Result-side, `Error` = thrown (root `CONTEXT.md` glossary).

Security collapses stay at the per-domain handlers, BEFORE the wire: internal vocabularies (`GitHubApiErrorCodes` through the mapper, `RefreshErrorCodes`) map to thrown classes there. That keeps the uniform-404 posture. A wire code is already the public posture, never the internal cause.

## Adding a new error code (the recipe)

1. Add the kebab-case code to `ApiErrorCodes` in `packages/contract/src/errors.ts`, its status to `ApiErrorStatusByCode` (1:1; a code needing two statuses is two codes), and its English line to `ApiErrorEnglishByCode`. A wire error carries no params: a code that would need one is two codes, or a sentence a translator writes without data. The status places the code in its class's `CodeFor<status>` automatically. Throw it via that class.
2. Add the identical line as `errors.<code>` in `packages/i18n/src/locales/en.json`. `packages/contract/test/wire-pin.test.ts` pins completeness and wording equality against the exported maps.
3. Add the matching `pulls.briefError.<code>` copy in the catalog. `apps/web` needs no code change (see `packages/contract/AGENTS.md`). The copy lookup is total by a template-literal key type, so a missing entry breaks `apps/web`'s typecheck. The two catalog blocks are different copy: `errors.<code>` is the wire line, `pulls.briefError.<code>` is what a reader sees.
