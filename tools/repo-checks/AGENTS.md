# tools/repo-checks: agent notes

A tree-wide text check that runs inside `pnpm lint`: `pnpm check:env`. `src/main.ts` is the composition root: argv picks the check, the repo root comes from the file's location.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **No env file is ever opened.** `check:env` reads `.env.example` and the parser files in `ENV_PARSER_PATHS` by explicit path, and finds env readers with `git grep` over `.ts`/`.tsx` source pathspecs only, which no env file can match.
- **Env:** every key a server config parser reads is named somewhere in `.env.example`. A key is read through an index read (`env["KEY"]`), a key passed beside the env map (`readVar(env, "KEY")`), a schema key, a `*_KEY`/`*_VAR`/`*_ENV`/`*_REF` name constant, a name a ternary picks, or a harness's `passVars` list. Every tracked server source that mentions the environment (`git grep` over `apps/*/src` and `packages/*/src` source, tests excluded) is either a listed parser or in `ENV_READER_SKIPS` with its reason, so a new env read cannot land outside the check; a skip whose file no longer reads env fails. A parser that reads a name another way is invisible here: add the form, never an exemption. `ENV_KEY_EXEMPTIONS` lists keys read on purpose without an example line, each with its reason, and an exemption no parser reads fails the check.
- **A failure to list or read is an error, never an empty result.**
- **The local hooks are tested here.** `.githooks/` has no member of its own and `hooks/lint-edited-file.mjs` (the agent edit hook) is a plain Node script, so `test/pre-push.test.ts` and `test/local-hooks.test.ts` run them in temporary repos against an oxlint stub. The edit hook always exits 0 and passes oxlint exactly one repo file.

## Verification

```sh
pnpm -C tools/repo-checks test   # temporary git repos; the env case reads the real tree
pnpm check:env
```
