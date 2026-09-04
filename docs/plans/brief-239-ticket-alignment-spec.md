# Ticket alignment: does the PR do what its ticket asked? (BRIEF-239 spec)

Assembled 2026-09-02 from the closed tickets of the BRIEF-239 wayfinder map.
Every decision below is already made on the map; this document only lays them
end to end so `/init-plan` can cut PRs. Where a plan-level detail had to be
chosen here it is marked **(plan-level)** and listed again under "Open at
plan level".

Map: https://app.notion.com/p/3cf5e9400eeb81f9bed9e1474c2cb4d4 (board row
https://app.notion.com/p/3c95e9400eeb8140a7b6d5c04278d3ee).

## Goal

A reviewer opening a brief sees, inside the Intent check, the one ticket this
PR is about and a three-word answer to "does this diff do what that ticket
asked": `aligned`, `partial` or `misaligned`, with the ticket's goal quoted
verbatim and one factual sentence about the diff. An agent reading the CLI
JSON gets the same answer at `intentCheck.alignment.read`.

To get there the Intent check gains reach: it resolves a **primary ticket**
from the PR description, title and branch name, fetches it from GitHub Issues
or Notion with a deployment-owned credential, and shows it to the model in its
own fence. Both fetchers are the first `ContextSource` providers under ADR
0033, which this work unparks; today's URL chaser migrates onto the same
contract.

Doctrine holds throughout: the read is a fallible read, never approval, never
a gate, never a receipt item. `partial` is an ordinary outcome. A false
`misaligned` costs more than a miss.

## Locked at charting (do not relitigate)

The nine locks in the map's Notes block, one line each:

1. Extend the Intent check; no new brief section.
2. Alignment is a model judgement, not a bucket count.
3. Trackers in v1: GitHub Issues and Notion, as `ContextSource` providers.
4. Tokens are deployment config (env at the composition root), not a database row. No settings UI.
5. Non-secret tracker config lives in the repo: `.mergebrief/settings.yaml` `tracker:` block.
6. One ticket, the primary, chosen by precedence description > title > branch. Only the primary is fetched. (Rewritten from union-of-refs on the reference ticket.)
7. Acceptance criteria are read as text; no structured parsing.
8. Fetch failure is surfaced, never silent. Still no gate.
9. Local generation: providers read from env, plus a `--context <file>` flag. No MCP client in brief-core.

## 1. Ticket references and the primary

Source: [What counts as a ticket reference, and which one is primary](https://app.notion.com/p/3cf5e9400eeb819aaed5c13d1ba48016).

### What counts as a reference

| Shape | When it matches | Resolves against |
| --- | --- | --- |
| `PREFIX-N` key | only when `PREFIX` equals `tracker.keyPrefix` (case-insensitive, word-bounded). No `tracker:` block means keys never match. | the configured tracker (Notion database) |
| `#N` | always on, no config. `#` must not be preceded by a word character or `/`; `# ` (heading) never matches. | `tracker.issuesRepo` when set, else the PR's own repo |
| `owner/repo#N` | always on | that repo; outside the installation it fails open as unread |
| branch path segment starting `N-` | always on (GitHub "create branch from issue" naming) | as `#N` |
| GitHub issue URL | always on | the URL |
| Notion page URL | whenever a Notion token is configured; no database id needed | the URL |

A GitHub hit whose payload carries `pull_request` is a PR, not a ticket, and
is skipped. `tracker.kind: notion` never switches GitHub references off.

### Which one is primary

Exactly one. Precedence: description, then title, then branch name. Inside
the description a reference introduced by a closing keyword (GitHub's list:
close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved) wins; with no
keyword, the first reference in reading order wins.

- No fallback: an unreadable primary stays primary and is reported as unread.
- No reference anywhere: no primary, alignment absent, today's composite Intent check runs unchanged.
- Other references are not fetched and not injected; the model sees them only as ordinary PR text.
- Identity is the resolved canonical URL, so a key and its page URL are one ticket. The primary's URL is removed from the generic URL chaser's list so nothing is fetched twice; the chaser is otherwise unchanged (cap 5).
- The first-hit location is kept as `foundIn` and shown in the card foot ("referenced in the PR description / title / branch name") per the prototype ticket, which supersedes the reference ticket's "analytics only, never shown" line.

### Where it lives **(plan-level)**

A pure parser `packages/brief-core/src/context/references.ts`:
`collectTicketReferences({ title, body, branch, tracker }) → TicketReference[]`
and `resolvePrimaryTicket(refs) → TicketReference | undefined`. Deterministic,
no I/O, fully unit-tested on the table above.

The branch name is fetched nowhere today. Add `headRef` to `PrMetadata`
(`packages/brief-core/src/github/types.ts`), to the `gh pr view` field list
(`headRefName` in `fetch.ts`), and to `PullRequestInfo`
(`packages/github/src/operations/pull-request.ts`); the worker passes it into
the query. Whether the worker's generation task already holds the head ref or
must fetch it is for the plan to check.

## 2. The ContextSource boundary

Sources: [What the ContextSource contract demands of a provider](https://app.notion.com/p/3cf5e9400eeb813191c2c43b84d4b62e),
[How a GitHub issue is read](https://app.notion.com/p/3cf5e9400eeb810ea6a3d77bc4c97f17),
[How a Notion ticket is found and read](https://app.notion.com/p/3cf5e9400eeb8177bfa6ced7ce966c59).

Nothing named `ContextSource` exists in code; the contract lives only in ADR
0033. The build creates it.

### Package and shapes **(plan-level)**

`packages/brief-core/src/context/` (boundary location was an ADR 0033
residual):

- `types.ts`: `ContextQuery` (title, body, headRef, primary reference, tracker config; metadata tier only in v1), `ContextSnippet` (`id` `ctx-N`, `providerId`, `source` canonical URL, `text`, plus `key`, `tracker`, `title`, `header`, `foundIn` for the primary), `ContextProviderTypes` as const, `ContextProvider` interface: one fetch `(query, deps) → Promise<Result<ContextSnippet[], ContextReadFailure>>`, per-call timeout, never throws for expected failures.
- `registry.ts`: static as-const registry copied from the generator registry shape (`packages/generators/src/config/registry.ts`): token, Zod options schema, egress tier (`metadata`), factory returning `Result`. Construction refuses boot on bad config.
- `providers/url.ts`: today's `fetchLinkedContext` moved behind the interface, unchanged behaviour (20,000 chars, 5 links, 10 s, no redirects, SSRF gate, fail-open per URL).
- `providers/github-issues.ts`: reads one issue through an injected `IssueReader` port (worker: installation octokit next to `fetchPullRequest`; CLIs: `gh issue view N --repo owner/repo --json title,body,state,stateReason,labels,milestone,url,pull_request` in the existing `execFile("gh")` pattern). Injects title, state, labels, milestone, body under the 20,000-char cap; comments are skipped. `gh` exit 4 = `no-credential`.
- `providers/notion.ts`: direct HTTP with the bearer from the named env var. By key: `GET /v1/databases/{id}` for the data source id, then `POST /v1/data_sources/{ds}/query` with `unique_id.equals: <number>`; prefix checked client-side against the schema, mismatch skips. By URL: last 32-hex run in the path is the page id, `GET /v1/pages/{id}`; handle `notion.so`, `www.notion.so`, `app.notion.com/p/`, `*.notion.site`, slugs, `?p=` (peeked row wins), drop `?v=` and `#block`. Body: `GET /v1/blocks/{id}/children`, `page_size` 100, recurse on `has_children`, join `plain_text`, stop at the char cap. Header: title, Status, Type, Priority, assignees, key. `404 object_not_found` is `not-found` (Notion cannot tell missing from no access; the copy says so). `429` is `rate-limited`; no retry inside the 10 s budget.
- `fanOut.ts`: runs the URL provider on the chaser list and the primary's provider on the primary, in parallel, each with its own timeout; fail-open per provider; fresh per generation, no cache. Returns `{ links: ContextSnippet[], primaryTicket: PrimaryTicketOutcome }`.

Fan-out feeds the brief call; the same snippets ride into the delta and
narrative prompts exactly as `links` do today (ADR 0033's "brief call only"
line is amended, not enforced, so the migration is a refactor with no prompt
behaviour change).

### Migration of `fetchLinkedContext`

Four call sites, all `(meta.body, log)`: `github/fetch.ts`,
`cli/categorize.ts`, `cli/delta.ts`, `packages/worker/src/task/generate.ts`.
Each becomes one fan-out call. `LinkedContext { url, content }` becomes
`ContextSnippet`; `FetchedPr.links`, `DeltaInput.links`,
`RevisionNarrativeInput.links` follow. Two test mocks
(`test/cli/generate-source.test.ts`, `test/generation/revision-narrative.test.ts`)
mock the fan-out instead. The `PrSource` comment in `github/source.ts` and
`packages/brief-core/AGENTS.md` line about `fetchLinkedContext` are reworded.

`renderLinked` interpolates the URL raw into the fence attribute; that is safe
today only because the URL regex excludes quotes and angle brackets. Provider-
built sources must pass through `attributeSafe` (currently private to
`repo-context.ts`; export it).

### Composition roots

- Worker: `packages/worker/src/main.ts` constructs providers beside `createGenerator`, from the `contextSources:` block and the installation client already minted there.
- CLIs: `cli/categorize.ts` and `cli/delta.ts` construct them after `loadEnv()` with `process.env`, the same spot the generator is built.
- No other file reads `process.env`.

## 3. Configuration

### Repo side: `.mergebrief/settings.yaml` `tracker:` block **(plan-level shape)**

```yaml
version: 1
entryCommentOnDrafts: false
tracker:
  kind: notion            # notion | github
  keyPrefix: BRIEF        # notion: required. Keys never match without it.
  databaseId: 3935e9400eeb80b0ad46000b1ce17b37   # notion: required, 32 hex
  # github:
  #   issuesRepo: owner/name   # optional: where a bare #N resolves
```

Zod: a discriminated union on `kind` inside the existing `.strict()`
`settingsV1Schema` (`packages/repo-config/src/schemas.ts`). Invalid block =
whole settings file invalid (reject-whole, existing invariant). The schema
comment and the self-host page both state plainly that keys match only the
configured prefix. Absent block: GitHub references still resolve; keys and
Notion-by-key never do.

Local CLIs do not read `.mergebrief/` today ("designed, not yet built" in
`docs/self-host/repo-config.md`). **(plan-level)** Recommended: the CLIs read
`settings.yaml` from the working tree through `validateRepoConfig` for this
block only, as the first slice of local-only mode. Alternative: a
`--tracker <kind>:<prefix>:<databaseId>` flag. Decide at plan time.

### Instance side: `mergebrief.config.yaml` `contextSources:` block

```yaml
contextSources:
  - type: notion
    tokenEnv: NOTION_TOKEN     # NAME of the env var; default NOTION_TOKEN
```

- New root key beside `generator:` / `drafts:` / `spend:` in the loader's root-key gate (`packages/generators/src/config/loader.ts`) and in `mergebrief.config.example.yaml`. Unknown keys refuse boot, as today.
- The URL provider and the GitHub Issues provider are built in and need no entry. Absent block = those two, not an empty list (ADR 0033 amendment).
- Credential rule as for `generator.apiKeyEnv`: the file names the env var, never a value. A configured Notion entry whose env var is unset refuses boot with the same `ConfigError` shape as a missing generator key.

### Env vars

| Var | Where | Purpose |
| --- | --- | --- |
| `NOTION_TOKEN` (default; renamed via `tokenEnv`) | worker, CLIs | Notion internal-integration bearer with Read content (+ user info for assignee names). The board must be shared with the integration. |
| `GH_TOKEN` / `GITHUB_TOKEN` | CLIs only, already | `gh` reads issues with it; unauthenticated `gh` exits 4 |
| (none) | worker | GitHub Issues uses the installation token already injected |

### GitHub App permissions

No change. `Get an issue` is authorized by `Issues: read` **or**
`Pull requests: read`, and the App holds `Pull requests: write`. Add one
clause to the Pull requests row of `docs/self-host/github-app.md`. Sibling
repos in the installation work; private repos outside it are `not-found`;
public repos outside it are undocumented for installation tokens (one live
call at build time to confirm, then document).

### CLI flags

- `--context <file>`: supplies the primary ticket's text without a provider, for any tracker an MCP or script can read. **(plan-level shape)** JSON `{ "url": "…", "key": "…", "tracker": "…", "title": "…", "header": "…", "content": "…" }`; only `url` and `content` required. When given, it replaces the fetch: the primary becomes this snippet with `foundIn` from the parser when a reference matched, else `description`. Mutually exclusive with a live fetch of the primary.
- `--config` already selects `mergebrief.config.yaml` for the CLIs; `contextSources:` rides in it.

## 4. Fetch to prompt

Source: [How the prompt asks for the alignment read](https://app.notion.com/p/3cf5e9400eeb81cead06e712c3c7260e).

- A new `## Primary ticket` section renders above `## Linked context`, holding one fence `<primary_ticket url="…" key="…" tracker="…">` with the tracker header block first (Status, Type, Priority, or state / labels / milestone for GitHub), then the body. A different tag, not an attribute on `<linked_context>`, so the model cannot confuse it with a design doc or a second ticket.
- The primary's URL counts as an injected URL: it joins `injectedUrls` and the quote-verification corpus, so `ticketUrls` membership and `checkQuote` work unchanged. The corpus entry and the rendered fence body stay byte-identical (existing invariant at `categorize.ts`).
- The breakout strip is centralized over the union of all known fence tags (`linked_context`, `primary_ticket`, the two repo-config tags, `review_comment`, the anchor fence), applied to both the fence body and the corpus. Today's four separate strips fold into it.
- The primary stays one of the composite intent sources: buckets keep quoting it, `ticketUrls` stays model-resolved, `primaryTicket` is harness-written and never reaches the model.
- Untrusted-data rules are restated for the new fence, mirroring the `<linked_context>` paragraph.
- Delta briefs carry no intent check; nothing changes there.

## 5. Schema

All in `packages/brief-core/src/types.ts` unless noted.

```ts
export const AlignmentReads = {
  ALIGNED: "aligned",
  PARTIAL: "partial",
  MISALIGNED: "misaligned",
} as const;
export type AlignmentRead = ValueOf<typeof AlignmentReads>;

export const TicketAlignmentSchema = z.object({
  read: z.enum([AlignmentReads.ALIGNED, AlignmentReads.PARTIAL, AlignmentReads.MISALIGNED]),
  goal: z.string(),      // verbatim span of the primary ticket
  response: z.string(),  // one factual sentence about the diff
});

export const PrimaryTicketStatuses = { READ: "read", UNREAD: "unread" } as const;
export const TicketUnreadReasons = {
  NOT_FOUND: "not-found",
  NO_CREDENTIAL: "no-credential",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate-limited",
  UNSUPPORTED: "unsupported",
} as const;
export const TicketTrackers = { GITHUB: "github", NOTION: "notion" } as const;
export const ReferenceLocations = { DESCRIPTION: "description", TITLE: "title", BRANCH: "branch" } as const;

export const PrimaryTicketSchema = z.object({
  key: z.string(),        // "" for a URL-only reference
  url: z.string(),
  tracker: z.enum([...]),
  foundIn: z.enum([...]),
  title: z.string(),      // "" when unread or none
  header: z.string(),     // tracker header line, "" when none  (plan-level addition)
  status: z.enum([...]),
  reason: z.enum([...five, ""]),   // "" when read
});
```

- Stored: `IntentCheckSchema.alignment: TicketAlignmentSchema.optional()` and `IntentCheckSchema.primaryTicket: PrimaryTicketSchema.optional()`. Both absent when there is no read / no reference.
- Generation: `IntentCheckGenerationSchema.alignment` is required (strict structured output has no optional fields) with `read: z.enum([...three, ""])`, `goal` and `response` `""` when no read. `fanOutIntentCheck` turns the `""` sentinel into absence before validation. `primaryTicket` is never on the generation schema.
- `header` is the one field not on the prototype ticket's wire list; the card renders the tracker header line and needs it. Drop it if Idan prefers the card to show title only.
- Web mirror (`apps/web/src/features/brief/types.ts`, `utils/validation.ts`): pin `AlignmentRead`, `PrimaryTicket` the way `Specificity` is pinned. A malformed or unknown-valued `alignment` or `primaryTicket` parses to absent, never fails the brief. Remember the CI hole: the mirror is hand-rolled, so run `apps/web` tests locally.
- Eval fixture (`tools/categorizer/eval/loadCase.ts` `FixtureSchema`): optional `primaryTicket: { url, key, tracker, title, header, content }`; when present the harness injects it as the primary and stamps `status: read`.

## 6. Prompt wording

Placement: a `### Ticket alignment` block at the end of `## Intent check` in
`packages/brief-core/src/generation/prompt.ts`. Agreed text, to be carried
verbatim where quoted:

- Goal quote: "Quote the shortest verbatim span from the primary ticket that states what the ticket wants achieved — the goal, not an acceptance list or an implementation step; a full clause, never a fragment; ~200 chars ceiling, never a target." The ticket title may serve as the goal when the body states none.
- The three values:
  - `aligned`: the diff delivers the goal as the ticket states it.
  - `partial`: the diff serves the goal and delivers one slice of it. This is a normal outcome, not a defect — a stacked PR, a first step, or a deliberately narrowed change is `partial`, and nothing about `partial` asks anyone to act.
  - `misaligned`: the diff does not serve the goal, or serves it in a way the ticket explicitly rules out (a placement, approach, or constraint the ticket names as not acceptable). Reaching the outcome by a forbidden approach is `misaligned`.
  - When you cannot tell `partial` from `misaligned`, say `partial` — a false `misaligned` costs more than a miss. `misaligned` is grounded on both sides: the goal quote names the constraint or outcome, `response` names what the diff does against it.
  - The read is judged from the whole diff, never derived from counting the buckets.
- `response`: one sentence, ~250 chars ceiling, what this diff does relative to the goal in plain words — what it delivers, leaves out, or does instead. Facts about the diff; never a verdict, never a recommendation, no group ids.
- No read: "Emit a read only when the primary ticket itself states a goal you can quote; otherwise leave it empty even when the composite is precise."
- Anchored regeneration: the anchor block gains one line `- [alignment] partial — "<goal>" — <response>`. Every full brief re-judges the read against the current diff; anchors shape wording only; the transition rule applies (a follow-up that finishes the remaining slice flips `partial` to `aligned`).

Snapshot tests (`test/generation/__snapshots__/prompt-snapshots.test.ts.snap`)
and `prompt.test.ts` update in the same commit.

## 7. Validation

In `validateIntentCheck` (`packages/brief-core/src/generation/validate.ts`):

- `alignment` drops as a whole, with one `generationWarnings` line, when any of these fail: `goal` non-empty; `goal` ≥ 5 words (reuse the alarm floor); `goal` a whitespace-normalized substring of the primary ticket's injected text (the corpus the quote check already uses); `primaryTicket.status === "read"`. Drop, never warn-and-keep: the read is shown as a bare word, so an ungrounded word is alarm-tier risk.
- `response` has no content check beyond the schema ceiling.
- `specificity` `broad` or `none` forces absence regardless of what the model emitted.
- `primaryTicket` is harness data and is not validated against model output.

## 8. Web: the Ticket alignment card

Source: [How the alignment row looks](https://app.notion.com/p/3cf5e9400eeb81459488ceb0e50f8a79); prototype variant D on branch `prototype/brief-239-alignment-row` (`apps/web/src/features/brief/components/BriefScreen/IntentBar/prototype/TicketAlignmentVariants.tsx`, `VariantD`). Keep the branch until the web PR lands, then delete it.

In `IntentBar.tsx` the bare linked-tickets list in the panel becomes a
"Ticket alignment" subsection above the two-column split. The collapsed
header is untouched. One card holds ticket and read as one item:

1. tracker badge, key as a link (title when `key` is `""`), title, then the tracker header line;
2. row "Ticket asks" → the goal quoted verbatim;
3. row "This PR" → the read word, then the response sentence. A word, no glyph, no colour;
4. foot: caution "AI-inferred read — verify against the ticket and the diff" left, "referenced in the PR description / title / branch name" right.

States:

| State | Card | Bar header |
| --- | --- | --- |
| read, precise | full card | today's counts |
| broad | card kept (link, header line); "This PR" row says "no read — the ticket scope is too broad to check against this PR" | today's unavailable line |
| none (no reference) | subsection absent | unchanged |
| unread (reference found, fetch failed) | amber notice inside the card: "<key> could not be read. <reason sentence>. No alignment read for this PR."; no "This PR" row. Amber is allowed: a fetch failure is a deployment fact, not a model read. | unchanged |

Copy, all under `brief.intent.*` in `packages/i18n/locales/en.json`:
`alignmentTitle` "Ticket alignment"; `ticketAsks` "Ticket asks"; `thisPr`
"This PR"; `read.aligned` / `read.partial` / `read.misaligned`; `noRead`;
`ticketUnread` "{{key}} could not be read."; `noAlignmentRead` "No alignment
read for this PR."; `foundIn.description` / `foundIn.title` / `foundIn.branch`;
`alignmentCaution`; `tracker.notion` / `tracker.github`; `reason.not-found`
"{{tracker}} returned not found — the page was moved, or the integration has
no access to it"; `reason.no-credential`; `reason.timeout`;
`reason.rate-limited`; `reason.unsupported`. Reason is a closed code set with
one template each, never a raw provider message. The existing
`linkedTickets_*` keys go once nothing renders them.

Visual PRs get the render-then-measure pass and an `/impeccable` audit before
review.

## 9. CLI output and error surfacing

- The CLI passes the brief JSON through; an agent scans `.intentCheck.alignment.read` and `.intentCheck.primaryTicket.status`.
- On an unread primary the CLI prints to stderr `error: <key> could not be read (<code>) — <same sentence as the web copy>` and still exits 0: the brief was generated, the read is absent. Same line from `categorize` and `delta`.
- Worker: one `warn` log with structured fields `{ tracker, reason, key }` on an unread primary; `debug` on a successful read. No first-class `evt` name (not in the taxonomy).
- Nothing gates on `status` or `read` anywhere.

## 10. Documentation

### ADR 0002, dated update block after the existing one (agreed verbatim)

> **Update (2026-09-02): the Ticket alignment read is a read, not an approval.** The Intent check now names one primary ticket and reports how the diff relates to that ticket's goal: `aligned`, `partial`, or `misaligned`, with the goal quoted verbatim and one factual sentence about the diff. This is a fallible read shown to author and reviewer alike. It is never an approval, never a gate, and never a receipt item: nothing in the product blocks, warns, or scores on it, and `partial` is an ordinary outcome, not a defect. The reviewer's name still carries the judgment.

### ADR 0014, dated update block after Decision item 2 (agreed verbatim)

> **Update (2026-09-02): first cited enrichment ships.** The Intent check's sources now include a primary ticket fetched from GitHub Issues or Notion through the `ContextSource` boundary (ADR 0033, unparked). The alignment read it produces follows cite-or-stay-silent literally: the goal quote must verify as a verbatim span of the fetched ticket or the read is dropped, and a ticket that cannot be fetched is reported as unread, never guessed. Directives inside the ticket remain data; they cannot move the read.

### ADR 0033, unpark note **(drafted here, not yet agreed)**

Amendment block at the top, in the style of ADR 0014's:

> **Amended 2026-09-02: unparked.** The first two providers ship — GitHub Issues and Notion — to fetch the Intent check's primary ticket, and today's URL fetch migrates onto the contract as the URL provider. The contract as built differs from the text below in four places: ticket references sit inside the metadata tier, not a tier of their own; citations stay URL-keyed (the `ctx-N` id is carried, not cited), so the validator's set-membership rules hold unchanged; the untrusted tier carries two fences, `<linked_context url>` for URL snippets and `<primary_ticket url key tracker>` for the one primary, instead of a single `<external_context>`, with the breakout strip centralized over both; and an absent `contextSources:` block yields the URL and GitHub Issues providers, not an empty list. Snippets feed the brief call and ride into the delta and narrative prompts as before. Residuals resolved by the build: boundary location (`packages/brief-core/src/context/`), a one-ticket budget, cite-or-drop validation, origin display (the Ticket alignment card).

The title's "All Providers Parked to v2" stays; the block explains. No new
ADR: neither decision is hard to reverse on its own.

### `CONTEXT.md` glossary (agreed verbatim; replaces the Intent check entry, adds five)

> **Intent check**: A secondary section of the **Brief** comparing the change's *stated intent* — the PR title, the PR description, and the **Primary ticket** when one is read — against what the diff actually does. When the sources are *precise*, it reports five factual buckets: **accomplished**, **stated-but-missing**, **done-but-unstated**, **deviations**, **claimed-but-unachieved**; the last two carry an alarm register and drop unless grounded on both sides. When the sources are *broad* (an epic/parent) or *absent*, it reports that the check is unavailable rather than guessing. It also carries the **Ticket alignment** read. Deliberately de-emphasized — the **Change-groups** carry the story; the intent check is the AI's fallible read, shown to both author and reviewer, never a verdict or focal point.
> _Avoid_: requirements check, spec compliance, intent verdict

> **Ticket alignment**: The **Intent check**'s read of how the diff relates to the **Primary ticket**'s goal: `aligned` (delivers the goal), `partial` (serves it, one slice — an ordinary outcome), or `misaligned` (does not serve it, or reaches it by a way the ticket rules out). Carries the ticket's goal quoted verbatim and one factual sentence about the diff. Absent when there is no primary ticket, the ticket could not be read, or the sources are broad or absent. Never a gate.
> _Avoid_: alignment score, ticket verdict, compliance

> **Ticket reference**: A mention of a ticket found in the PR description, PR title, or branch name: a **Ticket key**, a GitHub issue number, or a tracker URL. References are collected; only the **Primary ticket** is fetched.
> _Avoid_: linked ticket (ambiguous with the generic linked context), issue link

> **Primary ticket**: The one **Ticket reference** the brief treats as the ticket this PR is about, chosen by precedence: description, then title, then branch name; inside the description a closing-keyword reference wins. Only the primary is fetched and shown to the model. An unreadable primary stays primary and is reported as unread.
> _Avoid_: main ticket, parent ticket, epic

> **Ticket key**: A tracker's short identifier for a ticket, `PREFIX-N`, recognized only when the prefix matches the repo's configured tracker.
> _Avoid_: ticket id, issue key

> **Linked context**: Text the harness fetched from URLs in the PR description and fenced as untrusted reference data for the model. The **Primary ticket** is fenced separately from it.
> _Avoid_: external context (that is the wider ADR concept), attachments

### Self-host docs

- New page `docs/self-host/trackers.md`: what the read is and is not; the `tracker:` block; creating a Notion internal integration, sharing the board, `NOTION_TOKEN` and `contextSources:`; the GitHub Issues note (no permission change, installation reach); local CLI setup (`gh auth`, env, `--context`); the five unread codes and what each means for the operator.
- `docs/self-host/repo-config.md` `settings.yaml` section: the `tracker:` block.
- `docs/self-host/generators.md` and `mergebrief.config.example.yaml`: the `contextSources:` root block.
- `docs/self-host/github-app.md`: one clause on the Pull requests row.
- `docs/self-host/cli.md`: `--context` and the tracker env.
- `packages/brief-core/AGENTS.md`, `packages/worker/AGENTS.md`: the context boundary and its composition-root rule; `packages/repo-config/AGENTS.md` unchanged unless the schema comment needs a pointer.

## 11. Eval (Idan runs the harness)

Generation-surface change: prompt, output schema, validators, injected
context. Scoped runs, one `--case` each, report in the PR body:

| Case | Asserts |
| --- | --- |
| `intent-precise-ticket`, DS-42 marked primary | `read === "partial"` (three of four asks delivered); `goal` a verbatim span of the fixture; `response` non-empty; buckets unchanged |
| `intent-legit-demotion` | `read === "aligned"`, no alarm |
| `intent-masked-fix` | `read === "misaligned"`; goal verifies |
| `intent-broad-epic` | `alignment` absent |
| `intent-adversarial-ticket` | `alignment` present, `read` unmoved by the ticket's directives, `goal` verbatim and not the directive text |
| new `intent-primary-plus-refs`, forked from `intent-precise-ticket` | same primary plus two unfetched references as plain text in the body (a parent epic key and a `#N`); `ticketUrls` is exactly the primary; `read` still `partial`; `goal` quoted from the primary, not the epic wording |

`intent-none-no-ticket` needs no run: no reference, alignment absent by
construction (a unit test covers it).

## Surprises worth knowing before planning

- Today's URL chaser never sees a Notion or GitHub issue body: an anonymous Notion GET returns a JS shell, and a GitHub issue's HTML page fills the 20,000-char cap before the body. The providers are the first time the model reads either.
- `foundIn` display: the reference ticket said "analytics only, never shown"; the later prototype ticket puts it in the card foot. The prototype wins; the spec follows it.
- ADR 0033 said the absent `contextSources:` block is byte-identical to today. With GitHub references always on (reference ticket), it is not; the unpark note says so.
- ADR 0014 #5 claims `github.ts` anticipates the boundary; the code excludes `fetchLinkedContext` from the `PrSource` port on purpose. The migration rewords both comments.

## Open at plan level

1. How the CLIs learn the `tracker:` block (working-tree read of `settings.yaml`, recommended, vs a flag).
2. `primaryTicket.header` on the wire (recommended: keep; the card needs it).
3. `--context <file>` JSON shape (proposed above).
4. Whether the worker's generation task already holds the PR head ref.
5. Confirming installation-token reads of public repos outside the installation (one live call).
6. `docs/adr/README.md` index: does not exist; the ADR status audit stays with BRIEF-217.

## Loose ends from the map

- Research branches `research/brief-239-{notion-lookup,github-issue-read,contextsource-contract}` (worktrees `.claude/worktrees/agent-*`): committed, unpushed, throwaway. Their content is folded into the tickets and this spec; delete after the plan is written.
- Prototype worktree `.claude/worktrees/prototype-brief-239` (branch `prototype/brief-239-alignment-row`): uncommitted, throwaway. Keep until the web PR has lifted variant D, then delete. Committing it is Idan's call.
