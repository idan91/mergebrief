# Product Operation catalog and policy (enforced, don't weaken)

## The table

A declaration names its id, its policy and its router-relative path; its classification and method come from the operation table in `packages/contract` (`ProductOperations`), never from the route. Composing the app IS registering: the root commit stamps each declaration's full `METHOD /api/...` endpoint, asserts it equals the table row's method and path (a mismatch throws at composition), and registers it.

Adding or renaming an operation means editing its table row: the table is the only list. Drift fails at composition (`commit()`) and in `test/product-operation-catalog.test.ts`.

The operation table is also one half of a both-directions gate: EVERY operation in it needs exactly one entry in `apps/cli/product-operations.map.json`: a `mergebrief` command, a documented expiring gap, or a reasoned `webOnly` note. Every entry there must in turn name an operation the table carries.

## Policy fields and refusal order

Every declaration states `browserSessionOnly`, `requiresOperator`, `requiresPushAccess`, `requiresInstallation` and `requiresStoredPullRequest` (each field's doc in `product-operations/types.ts` says why it exists).

The first failure answers, in this order: 401 no session, 403 cross-origin, 404 repo gate (malformed repo id or PR number, no access), 403 `scope-exceeded`, 403 `human-only` (a Bearer token on `browserSessionOnly`), 403 `operator-only` (a principal the config's `operators` list does not name, read from the `operatorIds` the app root sets on every request), 404 no push access, 404 a repo in no Installation, 404 no stored pull request, 400 parse, the operation.

The ladder `read < private-write < external-write` is cumulative (queries need no scope check); no principal where one is needed fails closed with 401. Cookie principals are unlimited by construction; a Bearer principal carries `api_token.scope`, chosen at mint and immutable.

The row loads through the per-PR step's `loadOperationRow` after the other checks; a `requiresStoredPullRequest` operation mounted without one throws.

One refusal depends on row state the seam cannot see: `regenerate-brief` answers a Bearer token 403 `human-only` only on an `awaiting-trigger` head, because a Trigger approval is a person's click and the store reads the head's status under its lock.
