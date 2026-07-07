# Plan — BRIEF-25: PR conversation in the Brief — others' review comments + follow-up replies (post-M1 · close the loop)

> Status: **READY — grilled 2026-07-07, not started.** Ticket: Notion BRIEF-25.
> ADR: **0027** (live conversation display; supersedes ADR 0012's
> comments-display half for the product runtime).
> Grilled with Fable pre-cutoff; design is locked — execution does not require
> Fable. Design-consult snapshot (impeccable/a11y/TS lenses):
> `.impeccable/critique/2026-07-07T16-58-04Z__brief-25-conversation-digest-design.md`.

## What this delivers (product + technical context)

**Product:** the Brief stops rendering the change in isolation. Review
comments by OTHER people (humans and bots) appear inside the Brief, anchored
to the code they discuss — collapsed by default, organized as a digest by the
Brief's own structure (not GitHub's chronological feed) — and the reviewer
can reply to an existing thread from within the Brief under their own GitHub
identity. Decided at the BRIEF-23 grill: essential platform surface, not an
affordance.

**Technical:** three moves. (1) github: `fetchPullRequestConversation` — the
package's first GraphQL primitive (REST cannot express thread resolution) —
plus a GraphQL error-taxonomy sibling. (2) api: a gated conversation GET
(installation token, 60s cache) and a gated reply POST (viewer token,
cache-evicting). (3) web: GitHub→chunk anchor mapping (inverse of BRIEF-23's
submit mapping), the conversation section (verdict strip + digest + inline
threads), reply composer, own-comment reconciliation.

## Locked decisions (grill 2026-07-07 — do not re-litigate)

1. **Fetch = one GraphQL query, installation token.**
   `pullRequest { reviewThreads, reviews, comments }` — pre-threaded,
   `isResolved`/`isOutdated` first-class. REST has NO thread-resolution
   surface (verified live 2026-07-07: 26 fields on a review comment, nothing
   resolution-shaped; GraphQL `reviewThreads` returns it). Installation token
   for reads: the gate already proves the viewer's repo access; a shared
   token means one shared rate budget and one shared cache entry per PR —
   viewer tokens would fragment both. Writes (replies) use the viewer token.
   No REST fallback tier in v1: fetch failure = section error state.
2. **Live data, timeline-derived placement.** Conversation is always fetched
   live (resolution flips and replies happen outside our generation cycle;
   nothing-persisted posture holds — no snapshot exists to serve). Placement
   is a pure function of (thread anchor revision, viewed revision): fresh
   threads render inline at their chunk; outdated threads are digest-only,
   grouped under "outdated" labeled with their anchor revision (jump target
   once BRIEF-24 ships; GitHub permalink until then).
3. **Anchor mapping = pure FE module** (`conversation/anchor.ts`, the mirror
   image of `submit.ts`): GitHub `(path, line, side, startLine?)` → chunk
   coordinates via the same `DiffLine {oldLine?, newLine?}` rows
   `createCommentAnchor` reads. Closed union:
   `ThreadPlacement = { kind: "chunk"; chunkId; rowId } | { kind: "unanchored"; reason: "outdated" | "file-not-in-brief" | "line-outside-chunks" }`.
   Outdated threads get no row-match attempt (their coordinates describe the
   anchor-time diff). Multi-line comments place by END line. PR-level issue
   comments → digest general group; review bodies → verdict strip.
   Unanchored/outdated render ONLY in the digest — nothing floats mid-code.
4. **Vocabulary split (amends the ticket's "vocabulary alignment" bullet):**
   GitHub facts wear GitHub words — thread state chips are
   open / resolved / outdated. Mind-map dispositions keep our words
   (addressed). The `linked-comment` evidence kind is the explicit bridge
   between the two ontologies. Resolution is GitHub's fact; disposition is
   the reviewer's local concept; aliasing them muddies whose state it is.
5. **Home = in-flow section at the Brief's end + GroupTocBar markers.** Not
   a drawer — the drawer is the Receipt's. Two modes: show-all (digest
   expands inline; threads grouped by chunk in reading order, unresolved
   first) and jump-to (`jumpToChunk` with a focus contract: move focus,
   transient highlight on the target thread, digest preserves scroll +
   expansion for return). Expansion state is visible state, never
   entry-path memory.
6. **Bot walls = collapse hierarchy, never hiding.** Humans: one digest line
   per thread. Bots: one line per (bot author, chunk-group) —
   `coderabbitai · 23 threads · 4 open` — expand for per-thread lines;
   inline at chunks, one aggregated disclosure per bot. Resolved/outdated
   bot threads never render inline (digest-only). Sort: unresolved first,
   then reading order; never by bot self-assigned severity (that prose stays
   inside comment bodies). ~50 rows per digest group, then "show more". No
   virtualization, no bot-filter toggle in v1.
7. **Replies: immediate, reply-only, viewer token.** GitHub API fact:
   create-review `comments[]` has no `in_reply_to` — replies cannot batch
   into a formal review, so "batch into next submit" is not a real option.
   `POST /api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies`
   behind the full gate, viewer token via the pulls.ts lazy-decrypt +
   refresh-once pattern, Zod body with length caps. NEW threads are out of
   scope for the section: they stay in the mind-map comment → submit flow
   (one authoring model). Reply drafts persist per thread id in the session
   store. Thread resolve/unresolve from the Brief: out of scope v1.
8. **Own comments: server-backed wins, exact join on review id.** BRIEF-23's
   submit response returns the created review id; fetched threads carrying a
   matching `pullRequestReview` id are the reviewer's own. The local session
   record renders only until the first post-submit refetch, then demotes to
   a pointer (keeps disposition/evidence links). Drafts never appear in the
   section. This closes BRIEF-23's accepted M1 residual: the durable
   sessionStorage "submitted" flip stops being load-bearing after first
   fetch. Per-comment linkage joins on (path, line, side), body tiebreak;
   collision worst case is display-level only.
9. **Cache discipline:** conversation GET sits in the same 60s-positive-TTL
   family as the other reads, response `no-store`. Every conversation write
   (reply POST; also the BRIEF-23 submit success path) evicts the PR's
   conversation cache key; FE refetches after post. Refresh policy: refetch
   on navigation and window-focus plus a manual refresh control — NO
   background poll. Expansion state (keyed by thread id) survives refetch.

## Design constraints (from the design consult — bind at implementation)

- **One-liner derivation spec:** strip markdown to plain text → first
  non-empty line → cap ~80ch → fallback "suggested change" for code-only
  bodies. Without it bot digest lines render "## Walkthrough" garbage.
- **Chips text-carrying, never color-only** (WCAG 1.4.1). `resolved` never
  styles as success-green — approval-like badges are a named
  anti-reference. Unresolved-first sort routes attention; chips stay
  factual.
- **Disclosures** are `<button aria-expanded>` with visible counts, targets
  ≥24px (aim 44). Digest rows: pick ONE keyboard pattern (plain list of
  buttons vs composite row with arrow-nav) and hold it. Verdict-strip
  avatars carry names (visible or sr-only). Keyboard path
  digest → thread → chunk → back must be complete; add a conversation entry
  to the existing shortcut system. Empty state teaches ("comments land here
  as teammates review"), error state is specific.
- **TS boundary:** `databaseId` (number) is the domain id everywhere —
  GraphQL `node_id` never leaves the primitive. Zod-validate the GraphQL
  response (no bare `as` off the wire). `ThreadState` as-const map
  (SHOUT_CASE keys, kebab-case values), exhaustive `never` check in digest
  grouping. `PrConversation` shape: readonly interfaces, named exports.

## Context for a fresh session (read before PR 1)

- **GraphQL is new to `packages/github`** — every existing primitive is
  Octokit REST + `mapRequestError` (see `review.ts` for the idiom to
  mirror). `octokit.graphql` errors (`GraphqlResponseError`) need a
  taxonomy sibling in `errors.ts` with the same sanitization discipline
  (no upstream text in messages).
- **Anchor model:** `apps/web/src/features/review/comments.ts`
  (`CommentAnchor`, `createCommentAnchor` — the row/side/line logic to
  invert); `apps/web/src/features/review/submit.ts` (outbound old→LEFT /
  new→RIGHT map the inbound mapper mirrors).
- **Reusable FE surfaces:** `CommentThread` / `CommentComposer` /
  `AddressedComments` (`features/review/components/`),
  `Drawer`, `GroupTocBar` (portal + reduced-motion pattern),
  `jumpToChunk` (`BriefPage.tsx:692`), the page live region from BRIEF-23
  (announcements), SCSS modules + `styles/tokens.scss`.
- **Route patterns to copy:** gated reads + 60s cache in
  `packages/api/src/routes/reads.ts`; viewer-token write
  (lazy-decrypt → `createUserOctokit` → refresh-once) in
  `packages/api/src/routes/pulls.ts:64-104` and `review-submit.ts`.
- **Session store:** `features/review/state.ts` (dispositions,
  `RiskEvidenceKind` incl. `linked-comment`), `session/snapshot.ts`
  (sessionStorage persistence per briefId).
- **GitHub facts baked into the design (verify in smoke):** REST review
  comments have no resolution field; GraphQL `reviewThreads` carries
  `isResolved`/`isOutdated` and per-comment `databaseId`; create-review
  `comments[]` cannot express `in_reply_to`; reply endpoint posts
  immediately outside any pending review.
- **Test gotchas (from BRIEF-23):** octokit throttling keeps MODULE-GLOBAL
  Bottleneck groups — never freeze/rewind `Date.now` in `packages/api`
  tests; the reply POST is on the `triggersNotification` throttle list →
  consecutive POSTs in one test file space ~3s (raise the file's
  `testTimeout`). CI is path-filtered per package — a `packages/github`
  contract change does NOT run api/web suites in CI; run dependents
  locally.

## Mandates

**Git — `git-eng` skill for ALL git operations** (requirements gathered via
the skill, 2026-07-07): branch per PR off the previous PR's branch
(stacked), `feature/BRIEF-25/<slug>`; PR titles per git-eng format
(`[BRIEF-25] feat: <Title Case>`); Idan merges. No `Co-Authored-By`, no AI
attribution in commits or PR bodies. Chunked commits per logical unit
(confirmed 2026-07-07).
Pre-commit review gate: `security-reviewer` + `performance-reviewer` in
parallel on staged changes before every commit; findings ≥ 80 confidence →
fix and re-run. **LOC ceiling hard gate:** `git diff --stat` after every
part; ideal < 500, ceiling ~1000; exceeded → split.

**Specialist skills — mandatory (user-confirmed 2026-07-07):**
`typescript-eng` (all parts),
`tdd` (github/api parts against existing harnesses — PGlite +
`app.request()`; FE mapping/digest logic test-first in vitest),
`verify` before committing each nontrivial part,
`web-accessibility` (PR 4's surface: disclosures, focus contract, live
regions, keyboard path).

## Review loop — codex CLI (mandatory per PR)

Same loop as BRIEF-23: codex CLI (GPT 5.5, reasoning High) inline review →
address EVERY comment (fix + regression test, or reasoned pushback) →
re-run until a pass has ZERO new findings. Upstream-first across the stack;
rebase downstream immediately (force-with-lease with explicit `:sha`). CI
green (`gh pr checks`) before a PR waits on Idan. Lint judged by exit code,
per branch.

## Subtasks → PRs

Dependency order PR 1 → 2 → 3 → 4 (stacked). **Invocation: sequential, main
thread** — each PR consumes the previous PR's contract; no parallelism
worth the handoff cost.

**Model + effort per PR:**

| PR | Model / effort | Why |
|---|---|---|
| 1 conversation-primitive | Fable high if started before the 2026-07-08 cutoff, else Opus high | Riskiest part: first GraphQL protocol in the package, error taxonomy, Zod boundary |
| 2 conversation-api | Opus high | Token handling + gate posture are subtle but pattern-following (pulls.ts / review-submit.ts precedents) |
| 3 fe-conversation-data | Opus high | Anchor inversion + own-comment reconciliation (residual closure) carry the correctness weight |
| 4 fe-conversation-section | Opus medium | UI assembly over existing components; a11y discipline via `web-accessibility` |

### PR 1 — `feature/BRIEF-25/conversation-primitive` (~400–600 LOC)

github package only.

1. GraphQL client entry (reuse the installed octokit's `graphql` with the
   installation token) + `GraphqlApiError` taxonomy sibling in `errors.ts`
   (sanitized, no upstream text).
2. `fetchPullRequestConversation` in `conversation.ts`: one query —
   `reviewThreads(first:100)` w/ nested `comments(first:50)` (cursor-page
   threads; per-thread overflow noted, not paged in v1), `reviews`,
   `comments` (PR-level). Zod-validate the response; map to domain
   `PrConversation` (readonly; `databaseId` ids; `ThreadState` as-const).
3. Fixtures: human thread, reply chain, resolved, outdated, bot author,
   PR-level comment, >100-thread pagination page.

### PR 2 — `feature/BRIEF-25/conversation-api` (~450–650 LOC, stacked)

1. `GET /api/repos/:repoId/pulls/:prNumber/conversation` — full per-repo
   gate, installation token, 60s positive cache keyed per PR, `no-store`,
   404-collapse posture identical to the other reads.
2. `POST .../comments/:commentId/replies` — viewer token
   (lazy-decrypt + refresh-once), Zod body (length cap), sanitized errors,
   audit posture consistent with submit; evicts the PR's conversation cache
   key on success. Submit route success also evicts (one-line growth on
   review-submit.ts).
3. Tests: tenancy/gate posture, cache hit/evict-on-write, refresh-once
   mid-reply, bot/human fixture passthrough, GraphQL-failure → sanitized
   error (no fallback tier).

### PR 3 — `feature/BRIEF-25/fe-conversation-data` (~400–600 LOC, stacked)

Logic layer, no section UI yet.

1. `conversation/anchor.ts`: GitHub→chunk mapper + `ThreadPlacement` union
   (exhaustive tests: side/line inversion, multi-line END-line, outdated
   short-circuit, rename→file-not-in-brief, context-line miss).
2. One-liner derivation (`digestLine.ts`): markdown-strip spec + fixtures
   (CodeRabbit walkthrough header, code-only body, plain human sentence).
3. Query wiring over `apiFetch` (refetch on navigation/window-focus, manual
   refresh, no poll); own-comment reconciliation (review-id join, pointer
   demotion — closes the BRIEF-23 residual; regression test: navigate-away
   during submit window no longer resurrects drafts after refetch).

### PR 4 — `feature/BRIEF-25/fe-conversation-section` (~500–800 LOC, stacked)

1. In-flow section: verdict strip (GitHub-word chips, names carried),
   digest grouped by chunk in reading order (humans per-thread, bots per
   (bot, chunk-group), unresolved first, ~50-row cap + show-more),
   outdated/general groups.
2. Inline chunk disclosures (aggregated per bot), reply composer
   (immediate post, pending state, draft-per-thread persistence, live-region
   announcements — reuse the BRIEF-23 page live region).
3. Jump-to focus contract + GroupTocBar conversation markers + shortcut
   entry; empty/error states; expansion state survives refetch.
4. `web-accessibility` pass baked in (disclosure semantics, targets,
   keyboard path, reduced-motion on highlight).

## PR budget sanity

| PR | Est. LOC | Gate |
|---|---|---|
| 1 conversation-primitive | 400–600 | query + taxonomy > 900 w/ tests → split errors.ts sibling out |
| 2 conversation-api | 450–650 | routes > 900 → reply POST splits off |
| 3 fe-conversation-data | 400–600 | reconciliation > 900 → own-comment join splits off |
| 4 fe-conversation-section | 500–800 | section > 900 → verdict strip + digest first, inline+composer second |

## Verification (every PR)

```sh
pnpm -C packages/github typecheck && pnpm -C packages/github test   # PR 1
pnpm -C packages/api typecheck && pnpm -C packages/api test         # PR 2 (+ github suite locally — CI path filter)
pnpm -C apps/web typecheck && pnpm -C apps/web test                 # PR 3–4 (characterization included)
pnpm lint    # exit code is the judge; per stacked branch
```

End-to-end (`verify` skill + compose smoke): open a DB-backed Brief on a PR
with real conversation (humans + a bot + at least one resolved and one
outdated thread) → threads render at their chunks; digest groups + chips
correct; reply from the Brief appears on GitHub under the reviewer's
account and in-section after refetch; own submitted review appears
server-backed after submit (residual closure); outdated threads sit
digest-only with revision labels. Verify GraphQL facts once against the
live API (resolution, `databaseId`, reply-immediacy).
