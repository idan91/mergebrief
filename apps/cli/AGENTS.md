# apps/cli — agent notes

The `mergebrief` CLI: humans and AI agents driving the read/write API. Ships as a single-file bundle (`dist/mergebrief.js`, tsup, every workspace dep inlined).

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

**Entry point: `src/bin.ts`** (the tsup bundle entry — shebang + real-world deps wired here and ONLY here). The whole CLI stays testable behind `runCli` in `src/program.ts` (injected-deps boundary; command tests run it against the REAL API, started as its own process by `test/harness/`, over HTTP).

What the layout can't show:

- `src/client.ts` is the API-client boundary (injected fetch, `CliError` mapping, the `mergebrief/<version>` user-agent).
- **One version number, stamped at build.** `CLI_VERSION` reads the `__CLI_VERSION__` define (`src/defines.d.ts`) that tsup and vitest inject from `package.json`; `mergebrief --version` prints it. The repo keeps `0.0.0`, the dev sentinel: a `0.0.0` CLI never checks for a newer version, never compares itself with the server and never warns. A publish stamps the tag's version into `package.json` right before build, uncommitted (`pnpm -C tools/release stamp`, run by `release.yml`; `prune-manifest` drops `private` and `dependencies` after the build); `prepublishOnly` refuses to publish the sentinel until it is.
- **Skew lines** (`src/version/`): the client reads `MergeBrief-Version` off the first response of the run; a major gap either way prints one stderr warning after a successful command, and the one error line of a failed run ends with `[server x, cli y]` (`, major gap` when major) while versions differ. The update nag (`src/version/update-nag.ts`, wired in `bin.ts` only) asks `registry.npmjs.org/mergebrief/latest` beside the command, takes the answer only if it settled by exit (2s timeout, otherwise aborted), caches it under `<cacheDir>/update-check.json` and prints `A new version of mergebrief is available: x → y. To update, run: ...` on the next successful run, once per answer, and asks again a day after an answer; a failed run neither prints nor consumes it, and a re-check that settles while the previous answer is still owed prints at once. A failure is silent and the request names nothing about the instance. `MERGEBRIEF_NO_VERSION_WARNING` (any value) silences the warning and the nag, never the suffix. A dev build on either side (`dev`, `0.0.0`) prints nothing, and so does a prerelease (`1.5.0-rc.1`): `parseSemver` refuses the `-` suffix, so an RC is never a release and never compares equal to one. The server never branches on the CLI's version.
- `src/exit.ts` is the PUBLIC exit-code contract.
- `commands/read/diff-filter.ts`'s `--group` filter keeps output a valid diff.
- `test/` holds runCli-level contract tests (stdout/stderr + exit code). `test/harness/` starts the API from its own executable against a migrated PGlite served over a socket, with GitHub answered by a stub in the test process; a suite writes its GitHub responses as plain functions over a URL, as before. One world per TEST, not per file, because the API's own caches would otherwise carry a previous test's gate verdict into the next one.
- `scripts/` holds the README-appendix regenerator and the product-operation mapping gate.

`product-operations.map.json` (committed, package root) is the CLI half of that gate: EVERY operation in the contract's operation table (`ProductOperations`) carries exactly one entry — absence is an error. The entry is one of three shapes:

- a `command`, resolved against the REAL commander tree (a renamed command fails the gate);
- a `gap`, carrying reason, owner, ticket, and an expiry date that eventually fails on its own;
- a `webOnly`, carrying a permanent written reason and an owner, for a browser-only operation no command will ever cover.

## Invariants (enforced, don't weaken)

- **Stream/exit contract:** exit 0 ⇒ stdout is documented JSON, or empty for an operation whose success carries no body; exit ≠ 0 ⇒ empty stdout, ONE stderr line. The exit codes are a public surface — additive-only, never renumbered.
- **Passthrough by default:** response bodies relay VERBATIM; the CLI synthesizes shapes only where documented (e.g. `delta`).
- **One client-side shape check family**: the span flags every span-addressed command requires (exit 2), plus flag XOR `-F` payload exclusivity, plus `--file` without a span refusing `--side`/`--start-side` (exit 2; otherwise the line-arm `--side` default would swallow a no-op flag). Everything else relays the server's locked validation (4xx → exit 5; 429 → exit 7).
- **Single-file bundle:** workspace runtime deps are limited to `i18n` (the string catalog), `contract` (the wire vocabulary and its error-body reader) and `types` (the maps `contract` reads); tsup bundles all three in and the bundle stays one file. `dependencies` lists exactly what the bundle inlines (`commander`, `zod`, `i18n`, `contract`, `types`) so `pnpm audit --prod` still sees them; the release tool's `prune-manifest` strips the block after the build, so the shipped manifest carries no `dependencies` and no publisher ever rewrites the `workspace:` range. `bin` is `dist/mergebrief.js` with no `./`: npm 11 drops a `./` bin on publish (not on pack), and the package would ship without its command. `test/manifest.test.ts` holds both. Assets ship as constants, never file reads.
- **Copy:** CLI-originated copy (help text, prompts, error lines, warnings) is English by contract; a wire error code still renders through the catalog (`errors.<code>`).
- **Secrets:** the profile token is plaintext-on-disk by design (0600, v1, disclaimed at mint) — but it never appears in stdout, stderr, or errors.

## Verification

`pnpm -C apps/cli typecheck` / `test` / `build` / `docs:check` (README flag appendix current) / `map:check` (operation map exhaustive, commands real); repo-root `pnpm lint`.
