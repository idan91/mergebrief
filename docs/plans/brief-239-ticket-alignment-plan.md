# BRIEF-239: Build ticket alignment (primary ticket reach + alignment read)

Ticket: https://app.notion.com/p/3c95e9400eeb8140a7b6d5c04278d3ee
Spec: `docs/plans/brief-239-ticket-alignment-spec.md` (assembled from the wayfinder map, https://app.notion.com/p/3cf5e9400eeb81f9bed9e1474c2cb4d4)
Vocabulary: `CONTEXT.md` entries Intent check, Ticket alignment, Ticket reference, Primary ticket, Ticket key, Linked context (text agreed in the spec, applied by PR6).

The spec decides every contract. This plan decides the cut into PRs, the order of work, and who runs each part. Where this plan and the spec disagree, the spec wins and this plan gets fixed.

## What ships

- A `ContextSource` boundary in `packages/brief-core/src/context/` with three providers: URL (today's chaser, moved), GitHub Issues, Notion.
- A ticket-reference parser that picks one primary ticket from description, title and branch name, driven by a `tracker:` block in `.mergebrief/settings.yaml`.
- The primary ticket rendered to the model in its own `<primary_ticket>` fence; the model answers with `alignment { read, goal, response }`, validated cite-or-drop.
- A "Ticket alignment" card in the Intent bar; the same fields in the CLI JSON; an unread primary surfaced as a factual row and a CLI error line. No gate anywhere.
- Doctrine: dated update blocks on ADR 0002, 0014 and 0033; six glossary entries; a `docs/self-host/trackers.md` page.

Non-goals stay non-goals: no settings UI, no per-tenant credentials, no MCP client, no structured acceptance-criteria parsing, no Jira/Linear, no snippet-id citations, no rename of `<linked_context>`.

## Git requirements (git-eng, mandatory)

Invoke the `git-eng` skill for every git operation during implementation. Confirmed with Idan on 2026-09-02:

- The spec and this plan stay **uncommitted on `main`** for now; committing them is Idan's call. Nothing in the build depends on them being in git.
- Build branches stack off each other, never wait on a merge: `feature/BRIEF-239/context-boundary` off `main`, then `feature/BRIEF-239/ticket-references`, `feature/BRIEF-239/primary-ticket`, `feature/BRIEF-239/github-issues`, `feature/BRIEF-239/notion`, `feature/BRIEF-239/alignment-read`, `feature/BRIEF-239/alignment-card`, each off the previous.
- The agent commits in logical chunks within each branch. No `Co-Authored-By` trailers, no AI attribution anywhere.
- Before every build commit, run `security-reviewer` and `performance-reviewer` in parallel on the staged diff. Neither agent has Bash: write `git diff --cached` to a scratchpad file and hand each the path. Findings at confidence 80 or above get fixed and re-reviewed before the commit lands. The security pass matters most on PR4 and PR5 (child-process args to `gh`, HTTP to Notion, fence attribute escaping, env-var-name handling).
- Push each branch and open a ready-for-review PR with `gh`, base `main` for PR1, the previous branch for the rest. Retarget children to `main` as parents merge (watch-pr-stack). Verify with `git merge-base --is-ancestor` before realigning; GitHub rewrites the child itself on squash-merge here.
- Titles follow git-eng: `[BRIEF-239] <prefix>: <Title Case>`. Bodies follow the git-eng template (Overview, Changelog, Images & Videos for PR7) and get an `unslop` pass before publishing or editing. Keep bodies short: what changed, what surprised us, one verification line. PR3 and PR6 bodies carry the scoped eval report Idan produced.
- After the stack is up, the PR-stack lifecycle applies: one review subagent per PR, at most two rounds, medium-and-above findings only, fixes upstream first. Merging is Idan's; branch deletion is Idan's.

## Specialist skills (mandatory, confirmed 2026-09-02)

- `typescript-eng`: strict TS, repo conventions from `CLAUDE.md` and each package's `AGENTS.md`.
- `tdd`: test-first for the reference parser (PR2), the providers and fan-out (PR1, PR4, PR5), the fence and corpus invariants (PR3) and the validator rules (PR6). Write the invariant table before the code.
- `web-accessibility`: the card is a new region inside an existing disclosure; audit landmark, heading level, link names, the amber notice's role, and reduced-motion before PR7 review.
- `impeccable`: design audit on the rendered card (PR7) before it is marked ready.
- `verify`: drive worker + web end-to-end locally with a real Notion token and a real GitHub issue before PR5 and PR7 are marked ready.
- `unslop`: every PR body.

Also binding from repo rules: render and measure CSS before shipping (PR7); the eval harness covers PR3 and PR6 and **Idan runs it once at the end of the stack** (see "Evals"), the agent prepares the case list and never blocks on it; every log line earns its level; `.env` files are never grepped.

## Facts the cut rests on

From the code survey (2026-09-02):

- `linked-context.ts` is 189 LOC and is the whole URL provider. Four call sites pass `(meta.body, log)`; two tests mock it on the `../github` module.
- `categorize.ts` (672 LOC) holds `LINKED_CONTEXT_FENCE`, `renderLinked`, and the corpus / `injectedUrls` build. The fence body and the corpus must stay byte-identical; `categorize.test.ts:362-403` pins why.
- Four separate fence strips exist today (`linked_context`, the two repo-config tags, `review_comment`, the anchor fence). `attributeSafe` is private to `repo-context.ts`.
- `validate.ts` (1066 LOC): `resolveTicketPairs`, `keepSource` and `contentByUrl` are string-set membership on injected URLs. A primary whose canonical URL is injected passes all three unchanged.
- `IntentCheckSchema` / `IntentCheckGenerationSchema` in `types.ts`; `fanOutIntentCheck` is shared by `types.ts`, `categorize.ts`, `validate.ts`. `generationWarnings` is assembled in `categorize.ts` (three sites).
- `prompt.ts` (536 LOC) names the `linked_context` tag three times; `prompt.test.ts` and 12 snapshot occurrences pin it. New prompt text changes snapshots.
- No branch name anywhere: `PrMetadata`, the `gh pr view` field list and `PullRequestInfo` all lack a head ref.
- `settingsV1Schema` is one knob, `.strict()`. The CLIs do not read `.mergebrief/` at all today.
- Instance config root keys are gated in `packages/generators/src/config/loader.ts` (`generator`, `drafts`, `spend`, `x-*`); `generator.apiKeyEnv` is the env-var-by-name precedent; `GeneratorConfigSchema` is a discriminated union derived from an as-const registry.
- `IntentBar.tsx` is 372 LOC; the linked-tickets list is one block in the panel. Prototype variant D is 279 LOC of tsx and 288 of scss across four variants; lifting D alone is roughly a third of each.
- Eval fixtures inject `links[{url, content}]` (`loadCase.ts` `FixtureSchema`); six `intent-*` cases exist; `intent-precise-ticket` carries DS-42 at `https://tasks.example/DS-42`.
- The web wire mirror is hand-rolled (`apps/web/src/features/brief/types.ts`, `utils/validation.ts`); CI does not select `apps/web` for a brief-core change, so run its tests locally on PR3, PR6 and PR7.
- Coverage floor is 75% lines in every package touched.

## PR breakdown

Net change is about +3,600 LOC across seven PRs, each under the 1,000 changed-line ceiling, cut so that PR1 is a pure refactor, PR2 adds parsing with no fetch, PR3 makes the model see a primary ticket from a file, PR4 and PR5 add the live trackers, PR6 asks the alignment question, PR7 shows it. The stack lands as one unit before release; each prefix is safe to merge alone (a partial merge changes nothing a user sees until PR6).

### PR1: the context boundary (refactor, no behaviour change)

Branch `feature/BRIEF-239/context-boundary`. About 650 changed lines: 350 source (mostly moved), 300 tests.

1. Create `packages/brief-core/src/context/` with `index.ts`, `types.ts` (`ContextQuery`, `ContextSnippet`, `ContextProvider`, `ContextProviderTypes`, `ContextReadFailure`), `registry.ts` (as-const registry copied from the generator registry shape; URL provider only for now), `providers/url.ts` (the body of `linked-context.ts`, unchanged caps and SSRF gate), `fanOut.ts` (runs providers in parallel with per-provider timeout, fail-open, returns snippets).
2. Migrate the four call sites (`github/fetch.ts`, `cli/categorize.ts`, `cli/delta.ts`, `worker/src/task/generate.ts`) to one fan-out call. `LinkedContext` becomes `ContextSnippet` (`url` → `source`, `content` → `text`); `FetchedPr.links`, `DeltaInput.links`, `RevisionNarrativeInput.links` follow. Update the two test mocks. Delete `linked-context.ts`.
3. Centralize the fence strip: one `stripKnownFences` over the union of all fence tags, applied to both the rendered fence body and the corpus. Fold the four existing strips into it. Export `attributeSafe` and use it in `renderLinked`.
4. Reword the `PrSource` comment in `source.ts` and the `fetchLinkedContext` line in `packages/brief-core/AGENTS.md`; add a `context/` line to the map section.
5. Tests: move `github.test.ts` SSRF cases to the URL provider; add fan-out tests (timeout, one provider failing, order preserved); extend the corpus byte-identity test to cover a snippet containing another provider's fence tag.

Done when `pnpm lint` and `pnpm test` pass by exit code and the prompt snapshots are byte-identical to before.

Model: Fable 5.1, high effort, main thread. Mechanical but invariant-laden; the corpus rule is the trap.

### PR2: ticket references and the primary

Branch `feature/BRIEF-239/ticket-references`. About 600 changed lines: 300 source, 300 tests.

1. `packages/repo-config/src/schemas.ts`: `tracker:` block as a discriminated union on `kind` inside `settingsV1Schema` (notion: `keyPrefix`, `databaseId`; github: optional `issuesRepo`). Schema comment states that keys match only the configured prefix. Tests: each shape, an unknown key, a bad database id, reject-whole.
2. `packages/brief-core/src/context/references.ts`: `collectTicketReferences({ title, body, branch, tracker })` and `resolvePrimaryTicket(refs)`. Pure, table-driven tests from the spec's shape table: prefix match, word boundary, `#N` not after a word char or slash, heading exclusion, branch `N-` segment, GitHub and Notion URL shapes, closing-keyword precedence, reading-order fallback, description > title > branch.
3. Head ref plumbing: `PrMetadata.headRef`, `headRefName` in the `gh pr view` schema, `PullRequestInfo.headRef` in `packages/github`, and the worker passing it into the query. Check whether the generation task already holds the PR row's head ref; if not, read it from the same octokit call that fetches the PR.
4. CLIs read `.mergebrief/settings.yaml` from the working tree through `validateRepoConfig`, settings only (the plan-level choice recommended in the spec; revisit in review if Idan prefers a flag). Update the "designed, not yet built" paragraph in `docs/self-host/repo-config.md` and document the `tracker:` block there.
5. Wire the parser into the fan-out query (`ContextQuery.primaryReference`) with no provider consuming it yet; the URL provider drops the primary's URL from its list.

Done when the parser passes its table and nothing is fetched differently.

Model: Fable 5.1, medium effort, main thread, `tdd`. The table is the spec; the work is thoroughness, not design.

### PR3: inject a primary ticket (from a file or fixture)

Branch `feature/BRIEF-239/primary-ticket`. About 700 changed lines: 350 source, 250 tests, 100 snapshots.

1. `types.ts`: `PrimaryTicketStatuses`, `TicketUnreadReasons`, `TicketTrackers`, `ReferenceLocations`, `PrimaryTicketSchema`; `IntentCheckSchema.primaryTicket` optional. Never on the generation schema.
2. Fan-out returns `{ links, primaryTicket: PrimaryTicketOutcome }`. With no provider for the reference's tracker the outcome is `unread` / `unsupported`.
3. `--context <file>` on `categorize` and `delta`: JSON `{ url, key?, tracker?, title?, header?, content }`; replaces the fetch for the primary. Eval fixture gains optional `primaryTicket` in `FixtureSchema`; the harness injects it as `read`.
4. `categorize.ts`: `renderPrimaryTicket` emits `## Primary ticket` above `## Linked context` with `<primary_ticket url key tracker>` (attributes through `attributeSafe`), header block then body; the primary's URL joins `injectedUrls` and the corpus; the stamp writes `intentCheck.primaryTicket` after generation on the brief path (deltas and narrative receive the snippet as context only).
5. `prompt.ts`: the untrusted-data paragraph for the new fence, mirroring the `<linked_context>` one. Update `prompt.test.ts` and the snapshots.
6. Surfacing: worker `warn` with `{ tracker, reason, key }` on `unread`; CLI stderr line `error: <key> could not be read (<code>) — <sentence>`, exit 0. Sentences come from the i18n catalog keys added here (`brief.intent.reason.*`, `brief.intent.ticketUnread`, `brief.intent.noAlignmentRead`), read through the catalog on the server side the way other CLI copy is.
7. Web mirror: `PrimaryTicket` type and a lenient parse (malformed → absent) in `apps/web`; no rendering yet. Run `apps/web` tests locally.

Eval (deferred to the end of the stack, see "Evals"): `intent-precise-ticket` with DS-42 as `primaryTicket` in the fixture, asserting `ticketUrls` still exactly the primary and buckets unchanged; `intent-adversarial-ticket` the same way. The report lands in this PR's body once run.

Model: Fable 5.1, high effort, main thread. Generation surface; the fence and corpus rules need the whole picture.

### PR4: GitHub Issues provider

Branch `feature/BRIEF-239/github-issues`. About 550 changed lines: 300 source, 250 tests.

1. `packages/github/src/operations/issue.ts`: `fetchIssue(octokit, { owner, repo, number })` returning title, state, stateReason, labels, milestone, body, `pull_request` presence. Beside `fetchPullRequest`.
2. `packages/brief-core/src/context/providers/github-issues.ts`: takes an injected `IssueReader` port; resolves `#N` against `tracker.issuesRepo` or the PR repo, `owner/repo#N`, and issue URLs; skips PR hits; renders `title / state / labels / milestone / body` under the 20,000-char cap; maps 404 → `not-found`, 401/403 → `no-credential`, 429 → `rate-limited`, abort → `timeout`.
3. CLI `IssueReader`: `gh issue view N --repo owner/repo --json title,body,state,stateReason,labels,milestone,url,pull_request` in the existing `execFile("gh")` pattern; exit 4 → `no-credential`.
4. Worker `IssueReader`: the installation octokit from `appGitHubPort`. Register the provider in the registry as built-in (no config entry).
5. One live call during the build to settle installation-token reads of public repos outside the installation; write the answer into `docs/self-host/trackers.md` (new page, GitHub half) and the one clause on the Pull requests row of `docs/self-host/github-app.md`.
6. Tests: provider with a fake reader (each outcome, the PR skip, the cap); `gh` reader with a stubbed `execFile`; octokit op with the existing nock/msw pattern in `packages/github`.

Model: Fable 5.1, medium effort, subagent in a worktree, in parallel with PR5 (both branch from PR3; PR5 is rebased onto PR4 when both are done). `tdd`.

### PR5: Notion provider and the `contextSources:` block

Branch `feature/BRIEF-239/notion`. About 800 changed lines: 400 source, 300 tests, 100 docs.

1. `packages/brief-core/src/context/providers/notion.ts`: direct HTTP with the bearer from the named env var. Key path (`GET /v1/databases/{id}` → data source id → `POST /v1/data_sources/{ds}/query` with `unique_id.equals`, prefix checked client-side), URL path (32-hex page id → `GET /v1/pages/{id}`; all the URL shapes in the spec), body walk (`blocks/{id}/children`, page size 100, recurse on `has_children`, stop at the char cap), header line (title, Status, Type, Priority, assignees, key). Outcome map: 404 → `not-found`, 401 → `no-credential`, 429 → `rate-limited`, abort → `timeout`. One 10 s budget for the whole read.
2. Instance config: `contextSources:` root key in `loader.ts`'s gate, a `ContextSourcesConfigSchema` derived from the registry (only `notion` has options today: `tokenEnv`, default `NOTION_TOKEN`); construction returns `Result` and refuses boot when the named env var is unset. Worker `main.ts` and both CLIs construct providers beside the generator. `mergebrief.config.example.yaml` gains the block.
3. `docs/self-host/trackers.md` Notion half: creating the internal integration, sharing the board, `NOTION_TOKEN`, `contextSources:`, the five unread codes; `docs/self-host/generators.md` and `docs/self-host/cli.md` pointers. `packages/worker/AGENTS.md` names the composition-root rule for providers.
4. Tests: provider against a recorded fixture set (key hit, key prefix miss, URL shapes, nested blocks, 404, 429, timeout); loader tests for the new root key, a bad entry, an unset env var.
5. `verify`: one real generation against a Notion board page and one against a GitHub issue before marking ready.

Model: Fable 5.1, high effort, subagent in a worktree, in parallel with PR4. Edge cases in the API and the boot-refusal path deserve the effort. `tdd`.

### PR6: the alignment read

Branch `feature/BRIEF-239/alignment-read`. About 700 changed lines: 250 source, 250 tests, 100 snapshots, 100 docs.

1. `types.ts`: `AlignmentReads`, `TicketAlignmentSchema`; stored `IntentCheckSchema.alignment` optional; generation `alignment` required with the `""` sentinel; `fanOutIntentCheck` maps the sentinel to absence.
2. `prompt.ts`: `### Ticket alignment` block at the end of `## Intent check` with the agreed wording from the spec verbatim; the `[alignment]` anchor line in the regeneration block. Snapshots and `prompt.test.ts`.
3. `validate.ts`: the drop rules (goal non-empty, ≥ 5 words, whitespace-normalized substring of the primary's corpus entry, primary `read`), one `generationWarnings` line, `broad` / `none` force absence. Tests per rule and for the sentinel path.
4. Web mirror: `AlignmentRead` pinned like `Specificity`; lenient parse to absent.
5. Doctrine: ADR 0002 and 0014 update blocks and the ADR 0033 amendment (spec text; the 0033 wording is drafted, not yet agreed — confirm with Idan in review); the six `CONTEXT.md` glossary entries verbatim.
6. New eval case `intent-primary-plus-refs` forked from `intent-precise-ticket` (same primary, a parent epic key and a `#N` as plain text in the body) with its `expected.ts` properties from the spec table.

Eval (deferred to the end of the stack, see "Evals"): the six scoped cases in the spec table. The report lands in this PR's body once run. Snapshot changes are expected; explain them in the body.

Model: Fable 5.1, high effort, main thread. Prompt wording, validator and doctrine belong together.

### PR7: the Ticket alignment card

Branch `feature/BRIEF-239/alignment-card`. About 650 changed lines: 300 tsx/scss, 250 tests, 100 i18n and screenshots.

1. Lift variant D from `prototype/brief-239-alignment-row` (`TicketAlignmentVariants.tsx`, its scss) into `IntentBar/TicketAlignment.tsx` + module scss. Drop the switcher, fixtures and search-param plumbing. Tokens and spacing per `apps/web/AGENTS.md`; no styling comments.
2. `IntentBar.tsx`: replace the linked-tickets list with the subsection above the split; the four states from the spec table (read, broad, none, unread). Collapsed header untouched.
3. i18n keys under `brief.intent.*` (`alignmentTitle`, `ticketAsks`, `thisPr`, `read.*`, `noRead`, `foundIn.*`, `alignmentCaution`, `tracker.*`; the unread and reason keys already landed in PR3). Regenerate the catalog. Remove `linkedTickets_*` once unreferenced.
4. Tests: one per state, the link name when `key` is `""`, the amber notice's accessible name, no colour on the read word.
5. `web-accessibility` audit, then render, screenshot and measure at desktop and narrow widths, then `impeccable` audit. Screenshots follow the current precedent (the `docs/screenshots/` decision is still open on BRIEF-249).
6. Delete the prototype worktree and branch after this PR is up (confirm with Idan; the branch is uncommitted).

Model: Fable 5.1, high effort, subagent in a worktree, started once PR6's wire shape is committed (PR7 can begin from PR3's `primaryTicket` and add `alignment` when PR6 lands). `web-accessibility`, `impeccable`, `verify` on the real page.

## Order and invocation

| Step | PR | Runs | Depends on |
| --- | --- | --- | --- |
| 1 | PR1 context boundary | main thread, Fable 5.1 high | main |
| 2 | PR2 ticket references | main thread, Fable 5.1 medium | PR1 |
| 3 | PR3 primary ticket | main thread, Fable 5.1 high | PR2 |
| 4a | PR4 GitHub Issues | subagent, worktree, Fable 5.1 medium | PR3 |
| 4b | PR5 Notion + config | subagent, worktree, Fable 5.1 high | PR3 (rebased onto PR4 when both done) |
| 5 | PR6 alignment read | main thread, Fable 5.1 high | PR5 |
| 6 | PR7 card | subagent, worktree, Fable 5.1 high | PR6 wire shape |
| 7 | Evals | Idan, on the stack tip, after PR7 is up | all |

Every PR runs on Fable 5.1 (Idan, 2026-09-02); if Fable quota runs out, fall back to Opus 5 high and say so in the PR body. Within a run Idan starts, keep going PR after PR until a real blocker: a decision only Idan can make (the 0033 wording, the CLI settings-read choice, prototype deletion), quota, or a broken base. Evals do not block the build; they run once at the end. Do not cross from this plan into PR1 without his go.

## Evals

Idan runs the harness once, after all seven PRs are up, on the stack tip (PR7's branch): the two PR3 cases and the six PR6 cases from the spec table, one `--case` each. The agent prepares the exact command list and pauses for his confirmation before anything is pasted into the PR3 and PR6 bodies.

Running on the Claude Code subscription is supported: `pnpm -C tools/categorizer eval --config <file> --case <id>` with a config whose `generator:` block is `provider: claude-code` and `model: opus` (or a full id), using the local `claude /login`; the harness reports it as "billed to subscription", no API key needed. Two caveats from `tools/categorizer/eval/README.md`: `baseline.json` is keyed `provider:model` and cross-key comparison is refused, so a `claude-code:*` run reports the property pass/fail list but no REGRESSION verdict against the `anthropic:*` baseline (the property assertions are what the spec table cares about, so that is enough for this stack); and `claude-code` has no effort knob, so the served model is whatever the CLI serves. A run on the Anthropic default key is only needed if Idan wants the baseline updated too.

## Gates per PR

`pnpm lint` and `pnpm test` by exit code from the repo root; the touched packages' tests locally when CI would not select them (`apps/web` on PR3, PR6, PR7). Coverage floors hold at 75%. Prompt snapshot diffs are reviewed line by line, never regenerated blind. Eval reports are pasted, not paraphrased.

## Open items to settle during the build

1. CLI read of `tracker:` from the working tree (PR2) vs a flag. Recommended: working-tree read.
2. `primaryTicket.header` on the wire (PR3). Recommended: keep.
3. ADR 0033 amendment wording (PR6): drafted in the spec, not yet agreed.
4. Whether the worker generation task already holds the head ref (PR2).
5. Installation-token read of public repos outside the installation (PR4, one live call).
6. Prototype and research branch deletion: research branches after PR1 starts; prototype after PR7 is up. Both Idan's call.
