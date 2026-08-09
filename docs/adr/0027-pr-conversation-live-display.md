# PR Conversation Display in the Product Runtime — Live Fetch over GraphQL

The DB-backed Brief gains a **conversation surface**: other reviewers' and
bots' review threads (with replies), review verdicts, and PR-level comments,
rendered inside the Brief — organized as a **digest by the Brief's own
structure** (threads grouped by chunk in reading order, verdict strip on
top), with reply-from-the-Brief under the reviewer's own identity
(BRIEF-25).

Conversation data is **fetched live from GitHub on demand and never
persisted** — the same posture as diffs-on-demand (ADR 0006). Placement is a
pure function of (thread anchor revision, viewed revision): fresh threads
render inline at their chunk; outdated threads render only in the digest,
labeled with their anchor revision. There is no generation-time comment
snapshot: resolution flips and replies happen outside our generation cycle,
so a snapshot would lie within minutes.

The fetch is **one GraphQL query** (`reviewThreads` + `reviews` + PR-level
`comments`) behind a single deep primitive in `packages/github`
(`fetchPullRequestConversation`), using the **installation token** for reads
(the authz gate already proves the viewer's repo access; a shared token
gives one rate budget and one cache entry per PR). Writes — follow-up
replies — use the **viewer's token** (ADR 0016 #4: authorship stays the
reviewer's). Replies post immediately and only as replies: GitHub's
create-review API cannot batch replies into a formal review, and new threads
stay in the mind-map → submit flow (one authoring model).

## Relationship to ADR 0012 and ADR 0011

ADR 0012 designed comments-on-the-Brief for the **local CLI path**:
generation-time fetch into `.comments.json` sidecars, display-only, with
outdated derived from a nulled `line`. That design stands for the CLI
artifacts. **For the product runtime this ADR supersedes ADR 0012's
comments-display half:** no sidecar, no generation-time fetch; outdated and
resolved are read first-class from GraphQL (`isOutdated`, `isResolved` —
REST exposes no thread-resolution state at all, which is what forces
GraphQL). ADR 0011's split is preserved: the Brief **displays** the
conversation; comment-resolution **analysis** stays the Delta's job.

## Considered Options

- **Generation-time snapshot attached to the Brief revision (ADR 0012
  extended to the DB path).** Rejected: conversation state mutates outside
  the generation cycle; a snapshot misstates resolution and misses replies;
  it would also require persisting comment bodies the runtime deliberately
  does not store.
- **REST-only fetch (three list endpoints + hand-rolled threading).**
  Rejected: REST has no thread-resolution surface, and the digest's
  unresolved-first ordering is critical; dropping resolution is product
  damage, not a simplification.
- **REST backbone + minimal GraphQL side-query for resolution.** Rejected:
  pays GraphQL's full entry cost (client, error taxonomy, fixtures) while
  keeping REST's worst parts (threading join, three paginated lists). The
  interface that preserves optionality is the domain-shaped primitive boundary,
  not live REST plumbing.
- **One GraphQL query behind a deep primitive.** Chosen: pre-threaded,
  resolution and outdated first-class, one call per cache fill; transport
  is invisible outside `packages/github`.
- **Viewer token for reads.** Rejected: fragments the cache per viewer and
  drains per-viewer rate budgets on the team-on-same-PR case the feature
  serves. The trust boundary is unchanged — the gate still authorizes every
  read; the installation token only changes whose quota pays.
- **Batching replies into the next formal review.** Rejected on a GitHub
  API fact: create-review `comments[]` carries no `in_reply_to`; delayed
  immediate-posts would add staleness without atomicity.

## Vocabulary

GitHub facts wear GitHub words: thread chips are **open / resolved /
outdated**. Mind-map dispositions keep the product's words (**addressed**).
The `linked-comment` evidence kind is the explicit bridge between the two
ontologies. Resolution is GitHub's fact; disposition is the reviewer's
local concept; aliasing them would misattribute whose state it is.

## Consequences

- First GraphQL surface in `packages/github`: a query client entry plus an
  error-taxonomy sibling to `mapRequestError` with the same sanitization
  discipline. Domain ids are REST `databaseId` numbers; GraphQL `node_id`
  never leaves the primitive.
- Conversation reads join the 60s-positive-TTL cache family; every
  conversation write (reply; review submit) evicts the PR's cache key.
- The reviewer's own submitted comments become server-backed once fetched
  (joined by review id), closing BRIEF-23's accepted sessionStorage
  residual: the local "submitted" flip stops being critical after the
  first refetch.
- Outdated-thread "view on its revision" navigation is deferred to the
  timeline (ADR 0019 / BRIEF-24); until then the digest offers the GitHub
  permalink.

Implementation plan: `docs/plans/brief-25-conversation-display.md`.
