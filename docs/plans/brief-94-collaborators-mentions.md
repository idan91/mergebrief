# Plan — BRIEF-94: Collaborators endpoint for @mention autocomplete

> Status: **LOCKED — grill closed 2026-08-01; implementation not started.**
> Ticket: Notion BRIEF-94 "Collaborators endpoint for @mention autocomplete".
> Grounding: BRIEF-56 mention autocomplete (candidate seam at
> `useMentionAutocomplete` built to widen without rework), BRIEF-25 posting
> posture, conversation route template (`packages/api/src/routes/
> conversation.ts`), github op conventions (`packages/github/src/operations/`).
> Spawned from: BRIEF-56 grill decision 7 (participants-seeded v1;
> collaborators split out to keep BRIEF-56 pure apps/web).

## Goal

Can you @mention someone who hasn't spoken in the thread yet? Today the
autocomplete pool is thread participants only — anyone else on the repo must
be typed from memory, and the draft-path composers have no autocomplete at
all. BRIEF-94 adds a collaborators endpoint and widens the pool everywhere a
comment can be written, with GitHub-style rich rendering (avatar + name).

## Locked decisions (grill 2026-08-01)

1. **Collaborators cover the PR author.** BRIEF-56 decision 7's "+ PR
   author" gap closes implicitly: the author appears in the collaborators
   list whenever they have repo access. Fork PR from an outside contributor
   is out of scope — the pool self-heals the moment they comment (they
   become a participant). No author-login wire field; the `pr-view.ts`
   "author login is NEVER serialized" stance stands untouched.
2. **Rich candidates: `{login, name?, avatarUrl?}`.** The hook contract
   widens from `readonly string[]`; the popup renders avatar + display name.
   Fields optional so thread participants (`{login, isBot}` today) can ride
   in the same pool un-enriched where no collaborator entry matches.
3. **GraphQL, forced by `name`.** REST `GET /repos/{o}/{r}/collaborators`
   has no display name; per repo convention (REST for lists, GraphQL only
   where REST lacks the shape) this is a legitimate GraphQL case:
   `repository.collaborators` selecting `login name avatarUrl`, cursor loop
   with a hard page cap + `hasMore` flag (conversation.ts pattern). Cap
   ~3 pages × 100 — a mention pool past 300 is noise.
4. **Gate on `viewerCanPush` (security decision).** GitHub requires push
   access to list collaborators; serving via installation token would
   otherwise leak the roster (logins + names) to any read-access viewer —
   on a public repo, anyone. Route 404s for non-push viewers (authz's
   deny=404 stance); FE treats 404 as empty pool and falls back to
   participants-only. Reviewers on this product overwhelmingly have push.
5. **Mentions wherever commenting exists.** ThreadDetail's ReplyComposer
   (existing pool widens) AND the draft-path composers
   (CommentComposer/CommentThread), which today have no autocomplete —
   they get the collaborators pool (no thread participants to merge there).
6. **Ordering is ranking** (hook prefix-filters in array order, caps at 5):
   thread participants first (existing first-seen order), then collaborators
   alphabetical by login; dedup by login keeps the participant's position
   but enriches the entry with the collaborator's name/avatar.
7. **Convention-driven, not re-decided:** server TTL cache keyed
   `installation:repo` (60s positive, negatives never cached), all responses
   `cache-control: no-store`, bots filtered server-side (matching
   `mentionCandidatesFromThread`), route module mounted before
   `readsRoute` to avoid stacked authz gates, FE `queryOptions` descriptor
   with long staleTime (repo roster churns slowly).

## Out of scope

- Fork-PR author who isn't a collaborator (decision 1 — self-heals).
- Draft-composer mention *rendering* beyond what MarkdownTextarea already
  does; this ticket only supplies candidates.
- Org-members-beyond-collaborators, teams, or `#`-reference autocomplete.

## Git requirements (git-eng — mandatory for ALL git operations)

- Start from up-to-date `main`.
- Stacked branches, one per PR: `feature/BRIEF-94/<slug>`, each based on
  the previous until merge; squash-merge stacks need `rebase --onto` per
  merge (memory `git-push-workflow`; never plain-pull a rebased branch).
- **Chunked commits** after each logical unit.
- **Pre-commit gate on every commit:** `performance-reviewer` on staged
  changes; findings ≥80 confidence → fix, re-stage, re-run until clean.
- **No `Co-Authored-By` trailers; no AI-attribution in PR descriptions.**
- Push + ready PRs, titles `[BRIEF-94] feat: …` per git-eng format.
- Lint per branch by exit code (never grep-for-error).

## Mandatory skills

- `git-eng` — every git/gh operation.
- `typescript-eng` — all TS work (strict, no enum, named exports, Result
  at boundaries).
- `tdd` — test-first for the github op, the api route (gate behavior
  especially), and the hook-contract change.
- `verify` — runtime end-to-end pass (postgres + web) once the wiring PR
  is up: push-viewer sees collaborators, non-push falls back, avatars
  render.

## PR breakdown

Four stacked PRs, sequential in the main thread (each consumes the
previous layer's exports). Review loop: `fable-reviewer` agent, one
pre-merge round per PR on the branch diff; medium+ findings iterate,
low/nitpick-only = clean with a note in the PR body. Idan merges.

### PR 1 — github op: list repo collaborators (~300–450 LOC)

`[BRIEF-94] feat: GraphQL Repo Collaborators Operation`

1. `packages/github/src/operations/collaborators.ts`:
   `listRepoCollaborators(octokit, {owner, repo})` → GraphQL
   `repository.collaborators(first: 100)` selecting `login name avatarUrl`
   (+ `__typename`/bot detection for the server-side bot filter), manual
   cursor loop, `MAX_COLLABORATOR_PAGES = 3`, `hasMore` flag on cap,
   Zod-parsed nodes, `unexpectedResponseError` on parse failure,
   `mapRequestError` in the catch, returns
   `Result<{collaborators, hasMore}, GitHubApiError>`.
2. Export via `packages/github/src/index.ts` operations section; add the
   file to `packages/github/AGENTS.md` Map.
3. Tests per existing operation-test conventions (happy path, pagination
   cap, ghost/bot filtering, parse failure, request-error mapping).

Invocation: **main thread, Opus 5, medium effort** — patterned directly
off `conversation.ts` cursor loop + `repo.ts` structure; execution work.

### PR 2 — api route: GET /api/repos/:repoId/collaborators (~350–500 LOC)

`[BRIEF-94] feat: Collaborators Route Behind viewerCanPush`

1. Extend the injected github port (sibling method beside the conversation
   port's, or a sibling port — follow `appConversationPort` shape: mint
   failure → sanitized `Result`, never a route-level 500).
2. New route module `packages/api/src/routes/collaborators.ts` copied from
   the conversation route shape: own `createAuthzMiddleware` scoped by
   explicit `app.use`, `viewerCanPush` guard → 404 before any GitHub call,
   `splitRepoSlug(c.get("repoFullName"))`, installation-token fetch through
   the port, `createTtlCache` keyed `installation:repo`, `NOT_FOUND` → 404
   / else 502, `cache-control: no-store`. Body:
   `{collaborators: [{login, name?, avatarUrl?}], hasMore}`.
3. Mount in `app.ts` **before** `readsRoute` (double-gate trap documented
   in `packages/api/AGENTS.md`).
4. Tests: non-push viewer 404s **without** a GitHub call (assert port not
   invoked), push viewer 200s, cache hit skips the port, port failure →
   502, bot filtering if not already applied in PR 1.

Invocation: **main thread, sequential after PR 1, Opus 5, medium effort**
— template-following; the security-relevant gate is decided, tests prove
it.

### PR 3 — web: rich mention candidates + popup rendering (~400–550 LOC)

`[BRIEF-94] feat: Rich Mention Candidates — Avatar And Name`

1. `MentionCandidate = {login, name?, avatarUrl?}` type owned by
   `components/MarkdownTextarea`; `MentionAutocompleteArgs.candidates` and
   `mentionCandidates` props widen to `readonly MentionCandidate[]`.
   Filtering still prefix-on-login; insertion unchanged (`@login`).
2. Popup option renders avatar (with empty-slot fallback) + login + muted
   display name; combobox a11y semantics from BRIEF-56 preserved
   (option id/`aria-activedescendant` unchanged in shape).
3. `mentionCandidatesFromThread` returns `MentionCandidate[]` (login-only
   entries); ThreadDetail call site compiles unchanged in behavior.
4. Tests: hook filtering over rich items, renderer with/without
   name/avatar, existing characterization stays green.

Invocation: **main thread, sequential after PR 2 (stack linearity; only
type-level dependence), Opus 5, medium effort** — contract widening with
decisions already made; a11y surface exists from BRIEF-56.

### PR 4 — web: data wiring, merge, draft-path enablement (~350–500 LOC)

`[BRIEF-94] feat: Collaborators Pool Wired To Every Composer`

1. `features/conversation/queries.ts`: `collaboratorsQueryKey(repoId)` +
   `collaboratorsQueryOptions(repoId)` — 404 → empty-pool result kind
   (expected for non-push viewers, never a throw), long staleTime
   (≥5 min), `retry: false` per convention; transport through `apiFetch`.
2. Merge helper (unit-tested, pure): participants first enriched by
   login-match, collaborators alphabetical after, dedup by login
   (decision 6).
3. Thread path: pool assembled in the ConversationPlan wiring
   (`usePrBriefPlans` → `wiring.ts` → ThreadRowView → ThreadDetail),
   merged with `mentionCandidatesFromThread`.
4. Draft path: CommentComposer + CommentThread receive
   `mentionCandidates` = collaborators pool (decision 5).
5. `/verify` runtime pass: push viewer sees roster with avatars; non-push
   falls back to participants; draft composers autocomplete.

Invocation: **main thread, sequential after PR 3, Opus 5, medium effort**
— wiring along established seams; the merge helper is the only novel
logic and it's specified.

## Revisit triggers

- Mention pool feels stale in real use → shorten FE staleTime or server
  TTL before reaching for invalidation machinery.
- Repos with >300 collaborators actually appear → raise the page cap or
  add server-side search; `hasMore` in the body is the tripwire signal.
- Read-only reviewers turn out to be common → revisit the
  `viewerCanPush` gate (decision 4) with a private-repo carve-out.
- Draft-path mentions need participants too → thread the conversation
  pool into the review feature; deliberately not done now.
