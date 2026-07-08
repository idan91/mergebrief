# Plan — BRIEF-17: MergeBrief CLI (humans + AI agents over the read/write API)

> Status: **READY — wayfinder map closed 2026-07-09, not started.**
> Ticket: Notion BRIEF-17; map: "Wayfinder map: Brief CLI (BRIEF-17)" (all 8
> decision tickets closed 2026-07-08/09).
> ADRs: **0028** (thin-client seam), **0029** (output contract), **0016 #4
> as amended 2026-07-09** (API tokens as second presentation channel).
> Grills ran with Fable pre-cutoff; design is locked — execution does not
> require Fable.

## What this delivers (product + technical context)

**Product:** `mergebrief` — a CLI over the finished read/write API, serving
humans (TTY rendering) and AI agents (`--json`). The sharpest story:
agent-as-reviewer drives `pr` → `groups` → `diff --group` → `submit` on any
PR the token's installation can see; the same commands double as the
author's pre-ready self-review loop ("run your reviewer before your
reviewer does"). Role-neutral by design; web app stays the interactive
surface.

**Technical:** three moves. (1) server: API tokens as a second presentation
channel over the existing session machinery (persistence row + Bearer
resolution + mint/list/revoke UI) and one new shared endpoint
`GET /api/repos`. (2) `packages/cli`: npm-shaped single-file-bundle package
(private in v1), 10 flat commands, per-profile config + repos disk cache.
(3) docs: npm README with generated flag appendix, `--agents` packaged
guide, self-host deploy doc, two changelogs.

## Locked decisions (map 2026-07-08/09 — do not re-litigate)

Full detail lives on the map's tickets; gists here, contracts inline where
implementation needs them.

1. **Seam (ADR 0028):** CLI only, strict `--json`; no MCP, no published SDK
   in v1. Thin-client hard constraint: public HTTP API only at runtime —
   no `persistence`/`github` imports, no direct Postgres; compile-time
   types from `packages/types` OK. One code path local + deployed
   (configurable base URL). Internals may be SDK-shaped (thin bin over a
   client module) — recommended, it is also the test seam.
2. **Auth (ADR 0016 #4 amended):** opaque `mergebrief_...` Bearer tokens;
   SHA-256 hash rows wrapping the envelope-encrypted GitHub token +
   refresh token (reuse `spendRefresh` machinery); installation-bound at
   mint; mint/list/revoke on a cookie-authed web settings page
   (`POST /auth/tokens`, shown once); default 90-day expiry, no-expiry
   allowed. `MERGEBRIEF_TOKEN` env overrides stored config. Bearer accepted
   on `/api/*` only; `/auth/*` stays browser-only (one IdP exemption rule).
   Client stores tokens plaintext `0600` per base URL; no OS keychain; no
   device flow in v1.
3. **Repo addressing:** new shared `GET /api/repos` →
   `{repos: [{repoId: "123", fullName: "owner/name"}]}` — the
   installation∩user-access intersection, reusing pulls.ts allowed-set
   machinery + its 60s cache path; flat array, NO pagination;
   `cache-control: no-store`; GitHub failure → 401/502, never DB-only
   fallback. CLI: origin-remote-only inference
   (`git remote get-url origin`), `-R owner/name` override, no prompts.
   Per-profile disk cache `~/.cache/mergebrief/<profile>/repos.json`, NO
   TTL; refresh on miss / slug-mismatch (retry once) / `--refresh`.
   Not-found after refresh = distinct exit code, honest error naming
   profile + installation.
4. **Surface:** 10 flat commands — `repos`, `pr [n]` (no-arg lists),
   `groups <n>`, `diff <n>` (`--base/--head`; `--group <id>` = CLI-side
   hunk-level filter, whole hunks only, brief-span only, hard error with
   custom span), `delta <n>` (checkpoint resolution via PR-meta;
   unavailability is data), `conversation <n>`, `reply <commentId>`
   (`--body`/`--body-file -`), `submit <n>` (JSON via `-F`/stdin;
   convenience flags; `commitId` REQUIRED, never auto-fetched;
   `commentsDegraded` surfaced), `auth login`, `auth status`. No TUI.
   Deferred with triggers: `narrative`/`marks`, line-trimmed group diffs,
   `--wait` polling. Composition pattern blessed: one command may make two
   API reads (`delta` = pr-meta→delta; `diff --group` = brief+diff).
5. **Output contract (ADR 0029):** passthrough-by-default; exactly two
   CLI-synthesized shapes (`delta` union, `auth status` incl. server
   version); additive-only promise even pre-1.0; expand/contract for
   breaks; exit 0 ⇒ stdout is documented JSON, else empty stdout + one-line
   stderr; 6-code exit contract (0 ok · 1 generic · 2 usage · 3 auth ·
   4 not-found · 5 server-rejected-payload); `--json` explicit flag, TTY
   rendering non-contractual, `diff` rejects `--json` (exit 2).
6. **Author arc:** role-neutral CLI, no author commands; pre-ready
   self-review is a documented workflow. `submit` on own PR: GitHub rejects
   APPROVE/REQUEST_CHANGES from the author (COMMENT passes) — passthrough
   error, documented so agents don't retry-loop.
7. **Packaging (ADR 0028 #6):** `packages/cli`, package name `mergebrief`,
   bin `mergebrief`, `private: true` in v1, publishable-shaped single-file
   bundle, `engines: node >=20`; dogfood via build + `pnpm link --global`;
   publish at OSS launch only. Identifiers: `MERGEBRIEF_TOKEN`,
   `mergebrief_...`, `~/.cache/mergebrief`. Internal names (BRIEF-
   tickets, repo) unchanged; wholesale product rename = launch prep, out of
   scope.
8. **Docs:** `packages/cli/README.md` = npm README (quickstart incl.
   minting disclaimer, narrative reference, GENERATED flag appendix from
   `--help` + CI staleness gate); new `docs/self-host/` deploy doc (webhook
   exposure, IdP `/api/*` exemption, minting walkthrough, profiles);
   `--agents` root flag prints a packaged markdown agent guide (contract
   invariants first, exit table with next-moves, reviewer loop, author
   loop, delta union spelled out); two changelogs
   (`packages/cli/CHANGELOG.md` + `docs/api-changelog.md` keyed to server
   version). Deferred w/ triggers: Claude Code skill, llms.txt.

## Tech stack + testing (plan-level decisions — the map's last fog line)

- **Language/runtime:** strict TS, ESM, node >=20. Repo conventions bind
  (`CLAUDE.md`): extensionless imports, no enum, named exports, Result for
  expected failures, no secrets in error messages.
- **Arg parsing: `commander`.** Structured `--help` output is the canonical
  flag contract AND feeds the README appendix generator — a help-first
  library beats hand-rolled `util.parseArgs` here. Runtime deps stay
  minimal: `commander` + `zod` (both bundled into the single file anyway).
  TTY color via minimal ANSI helpers, no color dep.
- **Bundler: `tsup`** (esbuild family, matches vite/tsx posture) →
  `dist/mergebrief.js` with shebang, no workspace runtime deps in the
  bundle output (compile-time `packages/types` only).
- **Config:** JSON at `~/.config/mergebrief/config.json` (`0600`,
  Zod-validated on read): profiles keyed by name — base URL, token,
  optional `owners:` mapping; resolution order = explicit flag/env →
  `owners:` match on git-remote owner → default profile. Cache under
  `~/.cache/mergebrief/<profile>/` (XDG = safe-to-delete signal).
- **Test seam: injected fetch.** The client module takes a
  `fetch`-compatible function; command tests run against the REAL api Hono
  app (`app.request` is fetch-shaped) over the PGlite harness — true
  integration, no network, no mock-drift. Pure units (hunk filter, cache
  refresh triggers, profile resolution, exit-code mapping) test-first in
  vitest. Command-level assertions: captured stdout/stderr + exit code —
  the contract IS the test surface.
- **CI:** new path-filtered job for `packages/cli` (typecheck + test),
  added in PR 5. Remember the path-filter gap: server contract changes do
  NOT run the CLI suite in CI — run it locally when touching api shapes.

## Mandates

**Git — `git-eng` skill for ALL git operations** (requirements gathered
2026-07-09): branch per PR, stacked off the previous PR's branch,
`feature/BRIEF-17/<slug>`; PR titles `[BRIEF-17] feat: <Title Case>`; Idan
merges. No `Co-Authored-By`, no AI attribution in commits or PR bodies.
Chunked commits per logical unit.
Pre-commit review gate: `security-reviewer` + `performance-reviewer` in
parallel on staged changes before every commit; findings ≥ 80 confidence →
fix and re-run. **LOC ceiling hard gate:** `git diff --stat` after every
part; ideal < 500, ceiling ~1000; exceeded → split (chores get their own
PR).

**Specialist skills — mandatory (user-confirmed 2026-07-09):**
`typescript-eng` (all parts),
`tdd` (persistence/api parts on the PGlite + `app.request()` harnesses; CLI
pure logic and command tests test-first),
`verify` before committing each nontrivial part.
(`web-accessibility` not mandated — PR 4's settings page should still
follow the existing settings-surface patterns.)

## Review loop — codex CLI (mandatory per PR, user-confirmed 2026-07-09)

Same loop as BRIEF-23/24/25: codex CLI (GPT 5.5, reasoning High) inline
review → address EVERY comment (fix + regression test, or reasoned
pushback) → re-run until a pass has ZERO new findings. Upstream-first
across the stack; rebase downstream immediately (force-with-lease with
explicit `:sha`). CI green (`gh pr checks`) before a PR waits on Idan.
Lint judged by exit code, per branch.

## Subtasks → PRs

Three subtasks, eight PRs. Dependency spine: PR 1 → 2 → {3, 4} → 5 → 6 →
7 → 8. **Invocation: sequential in the main thread** (each PR consumes the
previous contract); exception — PR 4 (web token UI) only needs PR 2 and may
run as a parallel subagent while the main thread does PR 3/5.

**Model + effort per PR** (Fable unavailable post-cutoff; design is locked):

| PR | Model / effort | Why |
|---|---|---|
| 1 token-persistence | Opus high | Credential rows + crypto reuse — auth-sensitive, but mirrors `session.ts` |
| 2 token-routes | Opus high | Bearer presentation inside the gate + mint/revoke; posture subtleties (401-no-hint, /auth vs /api split) |
| 3 repos-endpoint | Opus medium | Pattern-following: pulls.ts allowed-set + mount-order rule |
| 4 web-token-ui | Opus medium | Settings CRUD UI; shown-once flow is the only subtle beat |
| 5 cli-scaffold-auth | Opus high | Foundational contracts: client seam, config/profiles, exit mapping, cache |
| 6 cli-read-commands | Opus high | `--group` hunk join + delta envelope carry the correctness weight |
| 7 cli-write-commands | Opus medium | Thin POSTs over locked server validation; receipts + payload plumbing |
| 8 cli-docs | Opus medium | Writing + one embed script + CI gate |

### Subtask A — server: tokens + repos endpoint

#### PR 1 — `feature/BRIEF-17/token-persistence` (~350–550 LOC)

persistence only.

1. `api_tokens` schema (sibling of `reviewer-session.ts`): id, name,
   user id, installation binding, SHA-256 token hash, envelope-encrypted
   GitHub token + refresh token (same crypto seams as sessions),
   `expires_at` nullable (no-expiry allowed), `last_used_at`,
   `created_at`, revocation. Tenant scoping per ADR 0016 #6.
2. `tokenAuth` module mirroring `session.ts` (`sessionAuth`): resolve by
   hash → expiry check → row; refresh patch/rejection surfaces compatible
   with `spendRefresh`; mint/list/revoke/touch operations.
3. Tests on the PGlite harness: lifecycle, expiry, revocation, hash-only
   storage (assert no plaintext token column), `last_used_at` touch.

#### PR 2 — `feature/BRIEF-17/token-routes` (~450–650 LOC, stacked)

api only.

1. Bearer presentation in the session-resolution layer (`authz.ts`):
   `Authorization: Bearer mergebrief_...` → hash → `tokenAuth` → same
   tenant ctx + gate as cookie sessions. `/api/*` only. Miss/expired → 401,
   no hint. `last_used_at` touched (throttled, not per-request-hot).
2. `POST/GET/DELETE /auth/tokens` — cookie-authed only (browser surface):
   mint (name, installation choice validated against the viewer's live
   accessible set — never caller-asserted; expiry choice, default 90d),
   list (names + metadata, never token material), revoke. Token material
   returned exactly once at mint. Audit-logged per ADR 0016 #12.
3. Tests: Bearer happy path through the full gate to a real read,
   expired/revoked/garbage token → 401 posture, `/auth/tokens` cookie-only
   (Bearer on it → 401), mint-once semantics, installation-binding
   validation, refresh-once mid-request on the Bearer path.

#### PR 3 — `feature/BRIEF-17/repos-endpoint` (~250–400 LOC, stacked)

1. `GET /api/repos` per the locked contract (decision 3): reuse the
   pulls.ts allowed-set machinery + 60s cache path; stringified `repoId`;
   flat, unpaginated; `no-store`; GitHub failure → 401/502.
2. Mount BEFORE `readsRoute` (packages/api AGENTS.md mount-order rule —
   one gate per request).
3. Tests: shape, cache reuse with pulls, Bearer + cookie both work,
   failure posture (no DB fallback), single-gate pin.

#### PR 4 — `feature/BRIEF-17/web-token-ui` (~350–550 LOC, stacked on PR 2; parallelizable)

1. Settings page section: mint form (name, installation picker from the
   live accessible set, expiry choice incl. "no expiry"), shown-once token
   display with the treat-as-password + CLI-stores-plaintext disclaimer,
   list with `last_used_at`, revoke.
2. Mirror deterministic 400s client-side (AGENTS.md rule). Follow existing
   settings-surface component patterns; exported prop interfaces.
3. Tests: mint/list/revoke flows against the app harness; shown-once
   behavior (token never re-renderable from state after dismiss).

### Subtask B — the CLI

#### PR 5 — `feature/BRIEF-17/cli-scaffold-auth` (~600–900 LOC, stacked)

`packages/cli` born here. Gate: if scaffold + auth + repos crowds 900,
split `repos`+cache into its own PR.

1. Package scaffold: `mergebrief`, `private: true`, bin, tsup single-file
   bundle, vitest, oxlint wiring, CI path-filtered job, pnpm-link dogfood
   script.
2. Client module (the seam): injected fetch, base-URL + Bearer wiring,
   stream/exit invariant implementation, 6-code error mapping, proxy
   HTML/302 detection → actionable error pointing at deploy docs, generic
   extra-static-headers per profile (IdP escape hatch).
3. Config/profiles: Zod-validated JSON, `0600` writes, resolution order
   (flag/env → `owners:` → default), `MERGEBRIEF_TOKEN` override.
4. Commands: `auth login` (paste/stdin), `auth status` (two-level;
   synthesized shape incl. server version), `repos` (+`--refresh`) with
   the no-TTL disk cache + self-healing refresh triggers + origin
   inference + `-R`.
5. Tests: exit-code mapping table, invariant (exit≠0 ⇒ empty stdout),
   profile resolution units, cache refresh triggers, commands end-to-end
   against the real api app via injected fetch (Bearer path from PR 2).

#### PR 6 — `feature/BRIEF-17/cli-read-commands` (~500–800 LOC, stacked)

1. `pr [n]` (list/meta passthrough), `groups <n>`, `conversation <n>` —
   passthrough + minimal TTY rendering.
2. `diff <n>`: raw diff passthrough, `--base/--head`, `--json` rejection
   (exit 2), `$PAGER` on TTY. `--group <id>`: join brief chunk ranges
   (`addedRanges` new-side / `removedRanges` old-side) against hunk
   headers; WHOLE hunks only, never trimmed (valid diff out); hard error
   (exit 2) with custom span; chunk-file missing from diff → stderr
   warning, fail loud.
3. `delta <n>`: PR-meta → checkpoint resolution → delta fetch;
   `--baseline/--head` overrides; discriminated-union envelope both arms;
   modeled unavailability exit 0, unmodeled 404 exit 4.
4. Tests: hunk-filter table-driven units (boundary lines, multi-hunk,
   renames), delta arms, passthrough byte-fidelity (no re-serialization
   drift), TTY-vs-`--json` split.

#### PR 7 — `feature/BRIEF-17/cli-write-commands` (~400–600 LOC, stacked)

1. `reply <commentId>` — `--body`/`--body-file -`; receipt passthrough.
2. `submit <n>` — payload via `-F file`/stdin, convenience flags
   (`--outcome`, `--body`, `--commit`) for comment-less reviews;
   `commitId` required client-side (exit 2 if absent — the one shape check;
   server owns all other rules); `commentsDegraded` surfaced prominently in
   both output modes; own-PR APPROVE/REQUEST_CHANGES rejection relays as
   passthrough error (exit 5).
3. Tests: payload plumbing (file/stdin/flags precedence), missing-commitId
   usage error, receipt passthrough, exit-5 self-correction path against
   real server validation.

### Subtask C — docs

#### PR 8 — `feature/BRIEF-17/cli-docs` (~500–800 LOC, stacked)

1. `packages/cli/README.md`: quickstart (mint walkthrough + disclaimer,
   `auth login`, first `pr`), narrative command reference with one captured
   JSON example per command + load-bearing-fields prose (`headSha`,
   `commentsDegraded`, group ids, union tags), exit-code table, commitId
   carry-through, cache-reset line, install story (launch channels +
   pinning line).
2. Flag appendix generator: embed script running each command's `--help`
   into a marked README section; CI staleness gate, exit-code checked.
3. `--agents` packaged guide (content order per decision 8); two-line
   AGENTS.md adopter snippet documented.
4. `docs/self-host/` deploy doc (webhook exposure, IdP `/api/*` exemption
   pattern, operator minting, profiles) linked from root README; root
   README CLI section (MergeBrief name in new text only).
5. Both changelogs seeded (`packages/cli/CHANGELOG.md`,
   `docs/api-changelog.md` with its sha-convention note).

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 token-persistence | 350–550 | schema + module > 900 w/ tests → split module |
| 2 token-routes | 450–650 | Bearer layer + /auth/tokens > 900 → mint routes split off |
| 3 repos-endpoint | 250–400 | — |
| 4 web-token-ui | 350–550 | — |
| 5 cli-scaffold-auth | 600–900 | > 900 → `repos`+cache split into own PR |
| 6 cli-read-commands | 500–800 | > 900 → `diff --group` splits off (it is the bulk) |
| 7 cli-write-commands | 400–600 | — |
| 8 cli-docs | 500–800 | mostly markdown; script + gate > 300 code → split |

## Verification (every PR)

```sh
pnpm -C packages/persistence typecheck && pnpm -C packages/persistence test  # PR 1
pnpm -C packages/api typecheck && pnpm -C packages/api test                  # PR 2-3 (+ persistence suite locally — CI path filter)
pnpm -C apps/web typecheck && pnpm -C apps/web test                          # PR 4
pnpm -C packages/cli typecheck && pnpm -C packages/cli test                  # PR 5-8 (+ api suite locally when shapes touched)
pnpm lint    # exit code is the judge; per stacked branch
```

End-to-end (`verify` skill + compose smoke, after PR 7): mint a token in
the web UI → `mergebrief auth login` (paste) → `auth status` shows server
version + installation → `repos` populates the cache → on a real PR:
`pr <n>` → `groups` → `diff --group <id>` (verify whole-hunk validity:
`git apply --check` the output) → `delta` (both arms: with and without a
prior checkpoint) → `conversation` → `reply` lands on GitHub under the
token owner → `submit` with pinned `commitId` produces the review +
`commentsDegraded` receipt; rename a repo and confirm slug-mismatch
self-heal; revoke the token and confirm 401 → exit 3. Dogfood install via
`pnpm link --global`.

## Context for a fresh session (read before PR 1)

- **Session machinery to mirror:** `packages/persistence/src/session.ts`
  (`sessionAuth`, refresh patch/rejection), crypto seams in
  `packages/persistence/src/crypto.ts`; `sha256Hex` +
  session-cookie handling in `packages/api/src/routes/auth.ts`.
- **Gate + mount rules:** `packages/api/AGENTS.md` — one gate per request
  (mount before `readsRoute`), refresh-once per REQUEST (`spendRefresh`
  closure), `no-store` on gated responses, mutations re-resolve the repo
  fresh, deterministic 400s are an FE contract.
- **Allowed-set machinery for `/api/repos`:**
  `packages/api/src/routes/pulls.ts` (installation∩user-access set + 60s
  cache); `listInstallationRepositoriesForUser` in
  `packages/github/src/repo.ts` is the underlying primitive (server-side —
  the CLI never touches it).
- **Test gotchas (BRIEF-23/24/25 lessons):** octokit throttling keeps
  MODULE-GLOBAL Bottleneck groups — never freeze/rewind `Date.now` in
  `packages/api` tests; write-path throttle spaces consecutive POSTs ~3s
  (raise file `testTimeout`); CI is path-filtered per package — run
  dependent suites locally; disabled-query cache gotcha in apps/web
  (BRIEF-24 memory) if the token UI adds queries.
- **Docker/verify:** keychain fails sandboxed/backgrounded; no tail-piping
  builds (docker-builds-workflow memory); `verify` skill drives postgres +
  env wiring + session seeding.
- **Out of scope (map-ruled):** OSS-launch release mechanics (repo cutover,
  npm publish, rename rollout); author-view-vs-single-view (BRIEF-30,
  unconstrained); any MCP/SDK surface.
