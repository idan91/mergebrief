# The wire contract

Reference for [SKILL.md](SKILL.md). Facts here are the CLI's output contract;
none of them appear in `--help`.

## Invariants

- Exit 0 means stdout is documented JSON, the raw unified diff for `diff`,
  or empty for a write whose success carries no body
  (`draft update|reanchor|delete`, `reclassify`, `chunk-read`, `ready`,
  `auth use|owners`). Any other exit means stdout is empty and stderr
  carries one line. One exception: a local stdout write failure (EIO,
  ENOSPC) exits 1 and may leave a partial write.
- `auth profiles` prints
  `{"profiles":[{name, baseUrl, owners, isDefault, tokenConfigured}]}`, read
  from the local config with no request.
- New fields may appear in any release. Ignore fields you do not recognize.
- `diff` rejects `--json` (exit 2). On exit 0 it also names its read on
  stderr. `diff mode: revision-span` is the PR's own change between two
  heads, with base moves and rebase noise left out: a `--base`/`--head` pair
  MergeBrief stored revision marks for gets it. `diff mode: compare` is
  GitHub's `base...head` compare: every other pair gets it, and so does a
  pair that reads the whole PR, which is any pair on the PR's current base
  or a brief's own base and head. A server that names neither prints no
  line. Read `diff` through a pipe when you parse it: a terminal or a set
  `$PAGER` gets a copy with control and invisible characters escaped.
- `session` reports `reviewOutcome` even before any write. With
  `materialized:false` that value is the column's default, not a choice anyone
  made.

## Exit table

| Code | Meaning                                                            | Next move                                                                         |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 0    | Success, including modeled unavailability                          | Parse stdout if any, continue                                                     |
| 1    | Network, 5xx, version skew                                         | Retry later or surface; check `auth status`                                       |
| 2    | Usage error, client-side                                           | Fix the invocation; never resend as-is. On `auth status`, report and stop         |
| 3    | Auth (401)                                                         | Token is dead; the user creates a new one at `<baseUrl>/settings`                 |
| 4    | Not found                                                          | Re-derive ids from `repos`/`pr`/`groups`                                          |
| 5    | Server rejected the payload, or the CLI refused a no-flag `submit` | Fix and retry only what you can change; 403s and policy refusals are permanent    |
| 6    | Required operation cannot run on this server+CLI pair              | Report the mismatch and stop                                                      |
| 7    | Rate limited (429)                                                 | Wait the `retry after <n>s` stderr names (a few minutes if none), then retry once |

## The span rule

Pass `--base <baseSha> --head <headSha>`, the pair `pr <n>` reports, on every
session command (`session`, `context`, `draft *`, `chunk-read`, `risk *`,
`reclassify`, `outcome`, `submit`). You write against the brief you read, not
the newest one, and the pair holds every command on that brief with nothing
remembered between runs. A lone `--base` or `--head` is exit 2.

Without the pair the CLI chooses the brief, which suits a person at a
terminal: a write can then land on a newer revision than the one you read.
`--revision <headIndex>` names a brief by number instead. `submit` exits 5
unless you are on the latest revision and it covers the head. It cannot see a
push from the last few minutes that no webhook has reported; the review pins
the revision you are on, not GitHub's head.

A push mid-review does not freeze your session: it stays writable until the
first write to the newer brief's session, from any client, carries your work
over, and from then the old one answers 409. `marks` and `narrative` take
comparison spans from `pr <n>`'s revisions instead; their `--help` names the
flags.

## Submit

`mergebrief submit` publishes the drafts the server holds for the span you
name; the outcome and body ride the payload its `--help` documents. Exit 0
returns `{reviewId, commentsDegraded, commentsFolded, commentsTotal}`.
`commentsFolded` of `commentsTotal` had their inline anchors rejected upstream
and were folded into the review body; `commentsDegraded` is true when any were.
The review posted; never re-submit for it. GitHub rejects APPROVE and
REQUEST_CHANGES on your own PR (COMMENT passes); that arrives as a
server-relayed error, not a retry case.

## Human-only operations

Clearing an attention item is the signed-in reviewer's judgment:
`risk dismiss|address|reopen`, `draft reanchor`, and `draft delete` refuse a
token, relaying the server's 403 as exit 5 by design. Surface the item to
the user instead of retrying. `capabilities --require` cannot see this
gate, or the token's scope: it checks that an operation exists on both
sides, not what the credential may do. `submit`, `reply`,
`thread resolve|unresolve`, `ready` and `draft attach` write to GitHub and
need a token created with external-write scope.

## The intent check

`groups --json` carries `intentCheck`: the change read against its stated
intent, which is the PR title and description plus the tickets they link.
A brief generated before the check existed has no `intentCheck`.

- `specificity` is `precise`, `broad` or `none`. Only `precise` fills the
  buckets; under `broad` or `none` every bucket is empty, and empty there
  means no usable intent, never a clean result.
- `scopeNote` is one sentence when the ticket deliberately spans more than
  this PR, such as a stacked series, and empty otherwise.
- Five buckets, each an array of
  `{intent, quote, sourceUrl, groupIds, acknowledged}`. `groupIds` name
  `changeGroups` entries. `sourceUrl` is empty when the quote comes from
  the PR title or description. The
  generator drops a `deviations` or `maskedFixes` item whose `quote` it
  cannot find verbatim in its source; on `accomplished` and
  `statedButMissing` it keeps an empty or unverified `quote`, so check that
  one against the source yourself.
  - `accomplished`: asks the diff does.
  - `statedButMissing`: asks the diff does not do. `groupIds` is empty.
  - `doneButUnstated`: diff work no source asked for. `quote` and
    `sourceUrl` are empty.
  - `deviations`: asks the diff moves against. `acknowledged: true` means
    the PR description owns the reversal.
  - `maskedFixes`: claimed fixes where the diff touches only the problem's
    signal, such as a demoted log, a skipped test or a raised threshold.
- The generator sets `acknowledged`, and it carries meaning only on
  `deviations`. No command writes it.
- `primaryTicket` names the one ticket the PR is about, found in its title,
  description or branch name, and is absent when none of them names one.
- `alignment` is `{read, goal, response}`, read against the primary
  ticket's goal. `read` is `aligned` (the diff delivers the goal),
  `partial` (one slice of it, an ordinary outcome) or `misaligned` (it
  does not serve the goal). `alignment` is absent when there is no primary
  ticket, the ticket could not be read or states no goal to quote, the
  intent is `broad` or `none`, or the goal quote did not verify.

## The Product diff

`groups --json` carries `productDiff`: how the product behaves before the PR
and after it, written by a model call of its own after the brief. A brief
generated before the section existed has no `productDiff`, and neither does
one whose Product diff call failed or wrote no change that could be kept.
`mergebrief product-diff <n> --json` prints the same value alone, as
`{"productDiff":{…}}`, and `{}` for a brief with none.

- `availability` is `available` or `unavailable`. `unavailable` means the
  brief was written in several calls, as a diff too large to read in one
  is, so no call read the whole diff and nothing was written: `changes` is
  empty, and empty there means not read, never no product change. Under
  `available`, an empty `changes` means the call found none.
- `changes` holds at most 8 entries, most significant first, each
  `{when, before, after, affects, beforeSource, groupIds}`. `when` is the
  action or condition; `before` and `after` are the outcome on each side of
  the PR. `groupIds` name `changeGroups` entries, at least one.
- `hasMore: true` means the PR has more product changes than the ones
  listed.
- `beforeSource` says where `before` came from:
  - `diff`: the diff's removed or unchanged lines show it.
  - `did-not-exist`: the behaviour is new. `before` may be absent, since
    the source already says what it was.
  - `pr-text`: the PR title or description states it. The generator is told
    the diff must not contradict it, and nothing checks that.
  - `not-shown`: nothing shows it. `before` is absent, never guessed.
- `affects` is one of `user-flow`, `api-contract`, `business-rule`, `data`,
  `integration`, `operations`, `background-process`.
- The generator is told to state `after` only from the diff's added lines.
  No check verifies a `before` or an `after` against the code, and no
  command writes the section.

## The delta union

`mergebrief delta <n> --json` resolves your last-review checkpoint and emits
one of:

    {"available":true,"baselineSha":"<sha>","headSha":"<sha>","artifact":{...}}
    {"available":false,"reason":"no-checkpoint"|"pending"|"baseline-unavailable"|"span-too-large"|"delta-not-generated"|"unchanged"}

Both arms are exit 0; unavailability is data. Next moves by `reason`:
`no-checkpoint` review the full brief; `pending` poll with backoff;
`baseline-unavailable` review the full brief; `span-too-large` review the
full brief, since GitHub will not render the span; `delta-not-generated` diff
the span yourself with `diff <n> --base <baselineSha> --head <headSha>`;
`unchanged` review nothing new, since the pushes after your checkpoint only
rebased, merged the base branch in, or rewrote history.

`pr <n>` reports the same states per revision: `comparisons.lastReview`
carries `deltaUnchanged: true` for that last case, and
`comparisons.previousBrief` carries `unchanged: true`, or `unavailable` with
the reasons above when the span to the previous brief has no marks. For an
unchanged span, `narrative` returns a record with
`"artifactKind":"revisionNarrativeUnchanged"` and no `overview` or `chunks`.

## Repo addressing

Commands infer the repo from the `origin` remote; an override flag exists
(`--help`). The `repos` listing is cached with no TTL, so a renamed repo
shows there only after a refresh, while PR-addressed commands self-heal on
the first slug miss. Exit 4 naming a profile means the repo is outside this
token's installation: the user switches profiles or creates a new token.
