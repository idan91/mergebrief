# The wire contract

Reference for [SKILL.md](SKILL.md). Facts here are the CLI's output contract;
none of them appear in `--help`.

## Invariants

- exit 0 means stdout is documented JSON (or the raw unified diff, for
  `diff`). Any other exit means stdout is empty and stderr carries one line.
  Branch on the exit code, never on stderr text.
- Reads and write receipts are the server's response bytes, verbatim.
  Exactly three shapes are CLI-synthesized: the `delta` union, `auth status`,
  and `capabilities`.
- Additive-only within a major: fields are never removed, renamed, or
  retyped. Ignore fields you do not recognize.
- `diff` rejects `--json` (exit 2); its raw unified diff is the machine
  format.

## Exit table

| Code | Meaning                                               | Next move                                                                      |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0    | Success, including modeled unavailability             | Parse stdout, continue                                                         |
| 1    | Network, 5xx, version skew                            | Retry later or surface; check `auth status`                                    |
| 2    | Usage error, client-side                              | Fix the invocation; never resend as-is                                         |
| 3    | Auth (401)                                            | Token is dead; the user re-mints at `<baseUrl>/settings`                       |
| 4    | Not found                                             | Re-derive ids from `repos`/`pr`/`groups`                                       |
| 5    | Server rejected the payload                           | Fix and retry only what you can change; 403s and policy refusals are permanent |
| 6    | Required operation cannot run on this server+CLI pair | Report the mismatch and stop                                                   |
| 7    | Rate limited (429)                                    | Wait the `retry after <n>s` stderr names (a few minutes if none), then retry   |

## The span rule

Every session command (`session`, `context`, `draft *`, `chunk-read`,
`risk *`, `reclassify`, `outcome`, `submit`) requires
`--base <baseSha> --head <headSha>`, the pair `pr <n>` reports; exit 2
without it. You write against the brief you read, not the newest one. A push
mid-review freezes the old session server-side (409): re-read `pr <n>`,
then the new session, and re-target. `marks` and `narrative` take
comparison spans from `pr <n>`'s revisions instead; their `--help` names
the flags.

## Submit

The comments `mergebrief submit` publishes are the drafts the server holds
for the span you name; the outcome and body ride the payload its `--help`
documents. Exit 0
returns `{reviewId, commentsDegraded}`; `commentsDegraded: true` means the
inline anchors were rejected upstream and the comments were folded into the
review body. The review posted; never re-submit for it. GitHub rejects
APPROVE and REQUEST_CHANGES on your own PR (COMMENT passes); that arrives as
a server-relayed error, not a retry case.

## Human-only operations

Clearing an attention item is the signed-in reviewer's judgment: `risk
dismiss|address|reopen`, `draft reanchor`, and `draft delete` refuse a
token, relaying the server's 403 as exit 5 by design. Surface the item to
the user instead of retrying. `capabilities --require` cannot see this
gate, or the token's scope: it checks that an operation exists on both
sides, not what the credential may do. Publishing with `submit` needs a
token minted with external-write scope.

`risk dismiss|address|reopen` take `-F` with a `flags` array naming each
flag by anchor: copy `filePath`, `attribute`, `regionStart`, `regionEnd`
verbatim from `session --json`. Flag ids dangle across brief regenerations;
anchors do not.

## The delta union

`mergebrief delta <n> --json` resolves your last-review checkpoint and emits
one of:

    {"available":true,"baselineSha":"<sha>","headSha":"<sha>","artifact":{...}}
    {"available":false,"reason":"no-checkpoint"|"pending"|"baseline-unavailable"|"delta-not-generated"}

Both arms are exit 0; unavailability is data. Next moves by `reason`:
`no-checkpoint` review the full brief; `pending` poll with backoff;
`baseline-unavailable` review the full brief; `delta-not-generated` diff the
span yourself with `diff <n> --base <baselineSha> --head <headSha>`.

## Repo addressing

Commands infer the repo from the `origin` remote; an override flag exists
(`--help`). The `repos` listing is cached with no TTL, so a renamed repo
shows there only after a refresh, while PR-addressed commands self-heal on
the first slug miss. Exit 4 naming a profile means the repo is outside this
token's installation: switch profiles or re-mint.
