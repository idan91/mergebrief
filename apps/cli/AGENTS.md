# apps/cli — agent notes

The `mergebrief` CLI: humans and AI agents driving the read/write API. Ships as a single-file bundle (`dist/mergebrief.js`, tsup, no workspace runtime deps).

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

**Entry point: `src/bin.ts`** (the tsup bundle entry — shebang + real-world deps wired here and ONLY here). The whole CLI stays testable behind `runCli` in `src/program.ts` (injected-deps boundary; command tests run it against the REAL API, started as its own process by `test/harness/`, over HTTP).

What the layout can't show:

- `src/client.ts` is the API-client boundary (injected fetch, `CliError` mapping, the `mergebrief/<version>` user-agent pinned by a test).
- `src/exit.ts` is the PUBLIC exit-code contract.
- `commands/diff-filter.ts`'s `--group` filter keeps output a valid diff.
- `test/` holds runCli-level contract tests (stdout/stderr + exit code). `test/harness/` starts the API from its own executable against a migrated PGlite served over a socket, with GitHub answered by a stub in the test process; a suite writes its GitHub responses as plain functions over a URL, as before. One world per TEST, not per file, because the API's own caches would otherwise carry a previous test's gate verdict into the next one.
- `scripts/` holds the README-appendix regenerator and the product-operation mapping gate.

`product-operations.map.json` (committed, package root) is the CLI half of that gate: EVERY operation in api's manifest carries exactly one entry — absence is an error. The entry is one of three shapes:

- a `command`, resolved against the REAL commander tree (a renamed command fails the gate);
- a `gap`, carrying reason, owner, ticket, and an expiry date that eventually fails on its own;
- a `webOnly`, carrying a permanent written reason and an owner, for a browser-only operation no command will ever cover.

## Invariants (enforced, don't weaken)

- **Stream/exit contract:** exit 0 ⇒ stdout is documented JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line. The exit codes are a public surface — additive-only, never renumbered.
- **Passthrough by default:** response bodies relay VERBATIM; the CLI synthesizes shapes only where documented (e.g. `delta`).
- **One client-side shape check family**: the span flags every span-addressed command requires (exit 2), plus flag XOR `-F` payload exclusivity. Everything else relays the server's locked validation (4xx → exit 5).
- **Single-file bundle:** workspace runtime deps are limited to `i18n` (the string catalog — tsup bundles it in; the bundle stays one file) plus compile-time `types`. Assets ship as constants, never file reads.
- **Secrets:** the profile token is plaintext-on-disk by design (0600, v1, disclaimed at mint) — but it never appears in stdout, stderr, or errors.

## Verification

`pnpm -C apps/cli typecheck` / `test` / `build` / `docs:check` (README flag appendix current) / `map:check` (operation map exhaustive, commands real); repo-root `pnpm lint`.
