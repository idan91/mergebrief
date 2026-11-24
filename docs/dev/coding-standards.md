# Coding standards

The judgment and style rules for the whole workspace. Root `AGENTS.md` holds the workspace layout, package edges, gates and hard constraints, and states how every rule in both files binds.

Three rules here are judgment calls instead of fixed answers: when to split support out of a file, which support filename to use or whether to colocate instead, and which verb a function name starts with. Make the call, say why in the PR description, and expect a reviewer who disagrees to argue it there.

## File shape

- Two rules in this section are judgment calls, the split signals and the support-name list: review asks what changes together and what a caller must understand, and the shapes below are the defaults that answer that most often. Everything else here binds as written, casing and Zod placement included, and the package-entry rule is gated by knip and by dependency-cruiser.
- A lean domain file stays a file. One that grows types, consts or utils becomes a folder with `index.ts` as the main file and `types.ts`, `consts.ts`, `utils.ts`, `schemas.ts` beside it.
- A grouping folder holds peers and has no `index.ts`; callers import the member. Support two peers share sits at folder level.
- Default support names: `index`, `types`, `consts`, `utils`, `schemas`, `logic/`. A domain-specific filename is better where it names the thing the file owns, and colocation is better where splitting would scatter one decision; either choice is argued in the PR, not in a comment. In source `helpers.ts` is `utils.ts` and `constants.ts` is `consts.ts`; `helpers.ts` stays legal under `test/`.
- The first outside import or the third type is the signal to open `types.ts`; the same signal opens `consts.ts` and `utils.ts`. These are the point to ask the question, not a threshold that decides it.
- `logic/` opens where the main file only orchestrates and the steps are worth naming. React trees use a facade hook or `utils.ts` instead.
- Never a grouping folder with one member; a folder whose one file is its `index.ts` or `index.tsx` entry is fine. Support two members share hoists to the nearest common owner.
- No source file carries its folder's name. A folder with an entry names it `index.ts`, so a caller imports the folder (`components/Menu`, never `components/Menu/Menu`); a grouping folder has no entry and names each member for what it owns. One exception: a concern folder's main hook may take the concern's name (`reading/useReading.ts`, `mark-ready/useMarkReady.ts`). A test mirrors the file it tests, and a component's test takes the component's name (`Button/Button.test.tsx` tests `Button/index.tsx`). A large task's tests may split per concern into a folder named after the task. `house/no-file-named-after-folder` holds it at error.
- Folder names are plural for peers, singular for one thing split into parts.
- api, worker and cli follow this shape; the axis is React versus not, never app versus package. Tests stay per member.
- Casing: kebab-case for every file and folder. The only exceptions are PascalCase component files and folders and camelCase `use*` hooks. Existing names are renamed on their own ticket.
- Zod schemas live beside their owner, the route, operation, store or script that parses with them. A `schemas.ts` serves one owner; duplicated wire bounds share one module at the closest common owner (`apps/api`'s `routes/wire-bounds.ts`). `packages/brief-core/src/types.ts` is the domain contract and keeps its schemas.
- A package entry is `src/index.ts`, a curated barrel and the `exports["."]` target. `index.tsx` feature barrels are an apps/web convention.

## Types and values

- Strict TS: no `any`, no bare `as`. Zod or type guards at boundaries; tests are exempt from the bare-`as` ban.
- No `enum`: `as const` maps plus `ValueOf<T>`. Keys SHOUT_CASE, string values kebab-case. Map names are PascalCase and plural, the `ValueOf` type singular: `const PullRequestSources = {...} as const; type PullRequestSource = ValueOf<typeof PullRequestSources>`.
- An enum-like map and its `ValueOf` type live in `types.ts`. `z.enum` reads the map, never a literal union.
- A const map's keys are SHOUT_CASE by default. A map keyed by an existing vocabulary map's values uses that map's members as computed keys (`{ [BadgeVariants.OPEN]: "brief.stateBadge.open" }`), never the values retyped. An object that follows a contract, such as an interface, an HTTP response or a stored row, keeps that contract's casing: camelCase for our own shapes, the source's casing for anything else.
- Interfaces for object shapes; `type` for unions, intersections and mapped types.
- Until release, a stored shape only moves forward: a change to what an artifact body or row holds migrates the existing data to the new shape, and no reader keeps code for an older one.
- Absence: `undefined` means absent. `null` appears only where a wire or DB shape carries it, converted at the boundary. Parse failure and refusal return `Result`. A function never returns both `null` and `undefined`. Loose `== null` is banned; `eqeqeq` holds it.
- An exported function whose return is an object shape, or a union of shapes, annotates it with a named type declared separately; `T`, `T[]`, `Promise<T>` and `T | undefined` over a primitive or an already-named `T` stay inline. Internals infer.
- `prop?: T | undefined` is deliberate under `exactOptionalPropertyTypes`. Plain `?:` by default; add `| undefined` only where a caller forwards a maybe-value.
- Expected failures return `Result`; `throw` is for programmer and infra errors. Five edge contracts throw on purpose and each is named in its member's `AGENTS.md`: api's `ApiError` classes at the HTTP layer, the generator's `generate()` after construction returned `Result`, the worker's transient job failures so graphile retries, persistence's `ScopeViolationError` for a row outside the caller's scope, and docs-site's link rule and anchor check so a bad link fails the VitePress build. Error messages never carry secrets, tokens or connection strings.
- Magic numbers become a named const or token. No one-letter locals.

## Functions and naming

- Function names start with a verb and name what comes back: `getSocketAddress`, `deriveAttentionItems`, `shapeSubmitComment`, `resolveBriefSearch`, `parseGeneratePayload`. Not `socketAddress`, not `commentOf`, not `withoutDiffRows`. Which verb is the author's call: pick the one that tells the caller what the function does, and expect review to argue about it rather than a rule to decide it. Route factories keep `xxxRoute` / `xxxRoutes`. The rule covers arrow consts and test helpers (`stub*`, `make*`).
- Function declarations over arrow consts at top level.
- Names use the domain's own nouns; no invented shorthand. Generic type parameters get descriptive names, not bare `T`, when more than one is in play.
- Before introducing a name, search CONTEXT.md and the code: a name that already means something else (`useReviewActions`, `LineTarget`, "landing page") is taken. Name a module for the mechanism it implements (`scroll-to-target`), not a metaphor for it.
- A name tells a reader who knows only CONTEXT.md and the call site what it holds and why it exists. A boolean policy flag names the requirement in domain nouns (`requiresInstallation`), never the check it runs or the status it answers. A value with a known shape gets a literal or template type, not `string`.
- Blocks nest at most three deep inside a function; extract a function or return early past that. `max-depth` holds this at error.
- Every `if`, `else`, `for` and `while` body takes braces, one-liners included. `curly` holds it at error.
- A function reads in one screen; about 60 lines is the signal to split, not a cap. A component whose logic sits above a wall of JSX splits into sub-components; a hook longer than one screen splits into sub-hooks or pure functions.
- Blank lines separate a function's logical steps (parse, guard, act, respond). A function with none is a wall; one with a blank line between every statement is noise. Group by step, not by line.
- No expression nests more than two calls; in tests, a matcher chained on `expect(...)` is not counted, so `expect(readValue()).toBe(x)` stays one line. A declarative builder counts as one call however its links and nested builders are written: a zod schema, a drizzle query, a commander registration, a Testing Library query read in place (`screen.getByRole("tab").getAttribute("aria-selected")`), a curried `it.each(rows)(title, test)`. A call that computes a value inside one still counts. A compound boolean or computed return value gets a named const first. A condition earns that const when it carries arithmetic, combines a call with another clause, or carries operands from more than one source (`const recentlyFetched = Date.now() - cached.fetchedAt < MIN_AGE_MS`). A lone predicate call (`isFileGitHubAnchor(anchor)`, `ids.has(id)`) is already a name and stays inline, and so do a single comparison and a two-clause guard on one value.
- No nested ternaries: one condition per ternary. Replacements in order: a `Record<State, Value>` lookup, if/else, an early return. `no-nested-ternary` holds it at error.
- Conditional fields are assigned, not spread. Declare the object with its unconditional fields, then assign the optional ones under an `if`; never `...(cond ? { x } : {})`. A JSX element is the same: pass the prop its maybe-value, never a conditional spread of props. `house/no-conditional-spread` holds both at error. A readonly interface built this way is declared `Mutable<T>` (`types/utils`): an annotation, not a cast.

## Copy, logging and comments

- User-facing copy lives in the `packages/i18n` catalog, never hard-coded in components or route handlers. A new wire error code follows the recipe in `apps/api/AGENTS.md`; its `errors.<code>` template rides the same change. A SHOUT_CASE const holds a technical value or a catalog key, never English a user reads; a label map maps a vocabulary to catalog keys, and the component resolves them with `t()`. The artifact noun is lowercase "brief" mid-sentence in user-facing copy; the product is "MergeBrief".
- Logging goes through the `packages/logging` boundary: no bare `console.*` in `apps/api`, `apps/worker` or server-side apps/web code. Secrets ride as structured fields, redacted by path, never interpolated into `msg`.
- Every log line earns its level: `error` is operator-actionable now; `warn` is degraded or suspicious, alertable on sustained rate; `info` is a terse operational signal; otherwise `debug` or delete the line. First-class `evt` names come only from the taxonomy table in `docs/self-host/observability.md`.
- Default to no comment. A comment earns its place only by stating a constraint the code cannot show, concisely, at the owner it constrains: a real invariant, a status contract, an ordering guarantee, a browser bug. A rationale essay, a provenance block, or a restatement of the line below it does not, and those get deleted rather than shortened, because a one-line restatement is still a line between the reader and the code. Two rules hold the volume, catching different failures: `house/comment-run` caps one block at eight content lines, and `house/comment-density` caps a file at 40% comment, which is the shape a file takes when every statement gets its own one-liner. A block that genuinely earns more takes a scoped `oxlint-disable` with its reason. Comments carry no em-dash.
- A test title names the behaviour in at most 70 characters, no em-dash, no parenthetical, `describe` included.

## Review conduct

- Review by re-deriving, not by agreeing. Form your own read of a diff before reading the author's, then name the disagreements as reasoning gaps. A finding you believe is wrong gets a reply explaining why, not a compliance fix; a question is not a change request.
- One finding means a sweep: before replying to a review comment, fix every occurrence in the stack.
