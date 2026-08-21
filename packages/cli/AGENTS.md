# packages/cli — agent notes

The `mergebrief` CLI:
humans and AI agents driving the read/write API. Ships as a single-file
bundle (`dist/mergebrief.js`, tsup, no workspace runtime deps).

## Map

**Entry point: `src/bin.ts`** (the tsup bundle entry — shebang + real-world
deps wired here and ONLY here). The whole CLI stays testable behind
`runCli` in `src/program.ts` (injected-deps boundary; command tests run it
against the REAL api Hono app via its fetch-shaped `app.request`).

```
src/
  bin.ts            ENTRY — bundle entry; the one place real deps are wired
  program.ts        runCli — the whole command surface (commander wiring)
  client.ts         the API-client boundary (injected fetch; CliError mapping;
                    the `mergebrief/<version>` user-agent, pinned by a test)
  exit.ts           the exit-code contract — PUBLIC, additive-only,
                    never renumbered
  agents-guide.ts   the packaged --agents guide (constant; zero file reads)
  commands/         command implementations
    read.ts           pr / groups / conversation / diff / delta
    capabilities.ts   the capabilities join + fail-closed --require preflight
    capabilities-map.ts  the map-entry vocabulary + join arm + boundary parse
    write.ts          reply / submit (thin POSTs over server validation)
    session-read.ts   session / marks / narrative / context (passthrough GETs)
    session-write/    draft create|update|reanchor|delete / chunk-read
                      (index.ts runner, utils.ts builders, types.ts shapes)
    diff-filter.ts    the --group whole-hunk filter (output stays a valid diff)
  profile/          which server/token/repos the CLI points at
    config.ts         per-profile config.json (XDG, 0600, plaintext token v1)
    repos.ts          per-profile repo cache + self-healing slug resolution
test/               runCli-level contract tests (stdout/stderr + exit code)
scripts/          embed-help.ts        regenerates the README flag appendix
                  check-operations-map.ts + operations-map-lib.ts +
                  command-paths.ts     the product operation mapping gate
```

`product-operations.map.json` (committed, package root) is the CLI half of
that gate: EVERY operation in api's manifest carries exactly one entry —
absence is an error — and the entry is one of three shapes: a `command`,
which must resolve against the REAL commander tree, so a renamed command
fails the gate; a `gap` carrying reason, owner, ticket, and an expiry date
that eventually fails on its own; or a `webOnly` carrying a permanent written
reason and an owner, for a browser-only operation no command will ever cover.

## Invariants (enforced, don't weaken)

- **Stream/exit contract:** exit 0 ⇒ stdout is documented
  JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line. The exit codes are a
  public surface — additive-only, never renumbered.
- **Passthrough by default:** response bodies relay VERBATIM; the CLI
  synthesizes shapes only where documented (e.g. `delta`).
- **One client-side shape check** on writes (the brief span → exit 2);
  everything else relays the server's locked validation (4xx → exit 5).
- **Single-file bundle:** workspace runtime deps are limited to `i18n`
  (the string catalog — tsup bundles it in; the bundle stays one file)
  plus compile-time `types`; assets ship as constants, never file reads.
- **Secrets:** the profile token is plaintext-on-disk by design (0600, v1,
  disclaimed at mint) — but it never appears in stdout, stderr, or errors.

## Conventions

Repo-wide rules apply (root `CLAUDE.md`): no `enum`, strict TS, no bare
`as`, Zod at boundaries, named exports, extensionless relative imports.

## Verification

```sh
pnpm -C packages/cli typecheck
pnpm -C packages/cli test
pnpm -C packages/cli build        # tsup single-file bundle
pnpm -C packages/cli docs:check   # README flag appendix current
pnpm -C packages/cli map:check    # operation map exhaustive, commands real
pnpm lint                         # repo-root oxlint --type-aware
```
