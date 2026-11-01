# tools/ingest-briefs: agent notes

The cutover tool: a directory of CLI brief artifacts becomes database rows under one explicit scope. The e2e seeder (`apps/web/e2e/harness/seed.ts`) loads its fixtures through the same core.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

`src/index.ts` is the ingest core (importable by tests and the e2e seeder); `src/main.ts` is the runnable CLI and the composition root, the one reader of `process.env` (`DATABASE_URL`). Which file becomes which row is `ingest/consts.ts`, one named regex per family. `.diffs`, `.comments` and the manifest have no database home: the repo route reads diffs and conversations live from GitHub. `src/testing/index.ts` (the `ingest-briefs/testing` subpath) stages the committed e2e fixtures for ingest: they are named `-brief.json` so gitleaks reads them (any `.br` in a name is opened as brotli), and the CLI itself skips that suffix.

## Invariants (enforced, don't weaken)

- **Bodies pass through VERBATIM.** The files were written by the same generation pipeline the web parses; re-shaping here could only lose data.
- **The target scope is EXPLICIT** (`--target user:<id>` or `installation:<id>`), never inferred from the artifacts.
- **Idempotent**: every write is the stores' content-addressed upsert, so a re-run rewrites the same rows rather than duplicating them.
- **A brief that cannot be placed is LOUD, never silent.** Unplaceable briefs are listed as `UNMAPPED` and the process exits 2. A cutover that reports success while dropping a brief is the failure this tool exists to prevent. A pre-index brief is placed when the resolution supplies its base SHA (`--resolve-repos`); without one it is unmapped, and its PR is left entirely alone rather than half-written.
- **An ambiguous sidecar is skipped, never guessed.** Flattening the slug makes `a-b/c` #1 and `a/b-c` #1 one stem; a stem two rows share attaches to neither. Narratives additionally match on the index in their file name, since a base retarget puts two briefs at one head.
- **Nothing here stores a credential.** `gh` runs as the operator's own auth and only ever reads.
- **Importing a module must not run an ingest.** `main.ts` calls `main()` at load, which is why the argv parser lives in its own file.

## Verification

`pnpm -C tools/ingest-briefs typecheck` / `test` (PGlite + the committed e2e fixtures). A real run needs a database and the `gh` CLI: `DATABASE_URL=... pnpm -C tools/ingest-briefs ingest -- --dir <dir> --target user:<github-user-id> --resolve-repos`. Exit codes: 0 clean, 2 one or more briefs unmapped (inspect before cutover), 1 the run failed.
