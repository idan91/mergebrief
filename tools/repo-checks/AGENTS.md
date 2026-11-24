# tools/repo-checks: agent notes

Tree-wide text checks that run inside `pnpm lint`: `pnpm check:provenance` and `pnpm check:env`. `src/main.ts` is the composition root: argv picks the check, the repo root comes from the file's location.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **No env file is ever opened.** `check:provenance` lists tracked files with `git ls-files` and skips `.env` and `.env.*` in any case (the committed `.env.example` aside) before reading, and never follows a link; `check:env` reads `.env.example` and the parser files in `ENV_PARSER_PATHS` by explicit path, never a glob.
- **Provenance:** `BRIEF-<n>` ticket ids, the maintainer handle outside the repo slug and its URLs, and references to this repository's own pull requests or issues fail. Bare `#12` and `PR 7` stay legal: pull requests are this product's domain, so its tests, docs and CLI output use them as data. Captured eval data, the demo build's captured pull request, the lockfile and this tool's own patterns and tests are exempt.
- **Env:** every key a server config parser reads is named somewhere in `.env.example`. A key is read through an index read (`env["KEY"]`), a key passed beside the env map (`readVar(env, "KEY")`), a schema key, a `*_KEY`/`*_VAR`/`*_ENV`/`*_REF` name constant, or a name a ternary picks. A parser that reads a name another way is invisible here: add the form, never an exemption. `ENV_KEY_EXEMPTIONS` lists keys read on purpose without an example line, each with its reason, and an exemption no parser reads fails the check.
- **A failure to list or read is an error, never an empty result.**

## Verification

```sh
pnpm -C tools/repo-checks test   # temporary git repos; the env case reads the real tree
pnpm check:provenance
pnpm check:env
```
