// The packaged agent guide, printed by the `--agents` root flag. Shipped as a
// constant so the single-file bundle carries it with zero runtime file reads.
export const AGENTS_GUIDE = `# MergeBrief for agents

You are driving a code-review comprehension tool over its \`--json\` contract.
Read this whole guide once; the invariants make unattended loops safe.

## Contract invariants

- **exit 0 ⇒ stdout is documented JSON** (or the raw unified diff, for
  \`diff\`). **exit ≠ 0 ⇒ stdout is EMPTY** and stderr carries exactly one
  line — server error text + HTTP status when the server answered;
  client-side usage and network/proxy failures explain themselves without
  one. Never parse stderr to branch — branch on the exit code.
- **Always pass \`--json\`.** TTY output is non-contractual and may change
  any release.
- **Passthrough by default:** the reads (\`pr\`, \`groups\`, \`conversation\`,
  \`repos\`, \`session\`, \`marks\`, \`narrative\`, \`context\`,
  \`collaborators\`) and every write receipt are the server's response
  bytes, verbatim. Exactly three shapes are CLI-synthesized: the \`delta\`
  union, \`auth status\`, and \`capabilities\`.
- **Additive-only:** fields are never removed, renamed, or retyped within a
  major. Tolerant-read: ignore fields you do not recognize.
- **\`diff\` rejects \`--json\`** (exit 2). Its raw unified-diff output IS
  the machine format.

## Exit codes → your next move

| Code | Meaning | Next move |
|---|---|---|
| 0 | Success (incl. modeled unavailability) | Parse stdout and continue |
| 1 | Generic: network, 5xx, version skew | Retry later or surface; check \`auth status\` |
| 2 | Usage error (client-side) | Fix your invocation — do NOT retry as-is |
| 3 | Auth (401) | The token is dead — a human must re-mint at \`<baseUrl>/settings\` |
| 4 | Not found | Wrong repo/PR/group/span — re-derive from \`repos\`/\`pr\`/\`groups\` |
| 5 | Server rejected the payload (4xx validation) | Read stderr, fix the payload, retry — this loop is self-correcting |
| 6 | Incompatible: a required operation cannot run on this server+CLI pair | Do NOT drive the operation — surface the mismatch (upgrade the CLI or the server) |

## Preflight: discover before you drive

Before driving a workflow, check that every operation it needs is runnable
on THIS server+CLI pair — fail-closed, not mid-loop:

    mergebrief capabilities --json --require read-brief read-delta submit-review

Exit 0 means every required operation is registered on the server AND this
binary has a command for it — proceed. Exit 6 means at least one is not;
stderr names each failing id and which side is missing. Never retry exit 6
as-is: it is a deployment mismatch, not a transient.

Without \`--require\` the command is a report: each server operation joined
with this binary's map — \`cli.command\` (runnable), \`cli.gap\` (no
command yet), \`cli.webOnly\` (browser-only by design), or
\`cli.unknownToCli\` (the server is newer than this CLI). A
\`fingerprintMatch: false\` with a stderr warning means catalog skew —
additive skew is fine; exit 6 is the only hard stop.

## The span rule (read once, applies everywhere)

Every session-scoped command (\`session\`, \`context\`, \`draft *\`,
\`chunk-read\`, \`risk *\`, \`reclassify\`, \`outcome\`, \`submit\`) names its
brief span with \`--base <baseSha> --head <headSha>\` — the pair \`pr <n>\`
reports. It is REQUIRED and never auto-fetched (exit 2 without it): you
write against the brief you actually read, not "the newest one". A push
mid-review freezes the old session server-side (409) — re-read, then
re-target the new span. \`marks\` takes \`--baseline/--head\` and
\`narrative\` takes \`--prev-head/--head\` instead (comparison spans, from
\`pr <n>\`'s revisions).

## The reviewer loop

1. \`mergebrief pr --json\` — pick a PR (or you were given one).
2. \`mergebrief pr <n> --json\` — read the meta. **Record \`baseSha\` and
   \`headSha\`**. If \`briefAvailable\` is false, generation is
   webhook-driven: poll \`pr <n>\` with backoff (or \`generate <url>\` if
   your operator wants an on-demand run).
3. \`mergebrief groups <n> --json\` — the brief: change groups, chunks,
   risk-surface attributes. This is your reading order.
   \`mergebrief context <n> --base … --head … --json\` adds the repo-config
   snapshot (per-file outcomes, de-emphasis weights) when you need it.
4. \`mergebrief session <n> --base … --head … --json\` — YOUR session on
   that brief: held drafts, read marks, dispositions, carried-over work.
   Re-read it after writes; its ids are what the write commands take.
5. \`mergebrief diff <n> --group <id>\` — the whole-hunk diff of one group
   (raw diff on stdout). Review group by group;
   \`mergebrief chunk-read <n> <chunkId> --base … --head …\` records
   progress as you finish each chunk.
6. Draft as you go:
   \`mergebrief draft create <n> --file <path> --start <line> --end <line>
   --body <text> --base … --head …\` (\`--side\` defaults to \`new\`; pass
   \`--side old\` only for a comment on deleted lines). Or send the whole
   payload with \`-F -\`. \`draft update <n> <draftId> --body …\` edits a
   held draft. Drafts are private until \`submit\` posts them.
7. \`mergebrief reclassify <n> <groupId> --category <category>\` and
   \`mergebrief outcome <n> <comment|approve|request-changes>\` record your
   session judgments. \`outcome\` is the session's INTENT;
   \`submit --outcome\` is the publishing act — both exist, different acts.
8. \`mergebrief conversation <n> --json\` — existing threads;
   \`mergebrief reply <commentId> --pr <n> --body-file -\` to answer;
   \`mergebrief thread resolve <n> <commentId>\` when a thread is settled
   (\`thread unresolve\` reopens it).
9. \`mergebrief submit <n> --base <baseSha> --head <headSha> -F -\` with a
   JSON payload:
   \`{"outcome":"comment"|"approve"|"request-changes","body":"..."}\`.
   The comments are the drafts the server holds for that span.
   Exit 5 means the server told you exactly what to fix; exit 0 returns
   \`{reviewId, commentsDegraded}\`. If \`commentsDegraded\` is true your
   inline comments were folded into the review body (anchors rejected
   upstream) — the review still posted; do not re-submit.
   NOTE: GitHub rejects APPROVE/REQUEST_CHANGES on your own PR (COMMENT
   passes) — that arrives as a server-relayed error; do not retry-loop it.

## Risk flags (mostly read-only for you)

The brief's risk flags carry dispositions in \`session --json\`. The
clearing operations — \`risk dismiss|address|reopen\`, \`draft reanchor\`,
\`draft delete\` — are **signed-in-reviewer only**: a token call always
relays the server's 403 as exit 5, by design (clearing attention is a human
judgment the receipt attributes by name). Do not retry; surface the flag to
your operator instead. When a human runs them: \`-F\` is REQUIRED and the
payload's \`flags\` array names each flag by ANCHOR — copy \`filePath\`,
\`attribute\`, \`regionStart\`, \`regionEnd\` VERBATIM from \`session
--json\` (flag ids dangle across regenerations; anchors do not).
\`dismiss\` adds \`--reason <text>\` (or a \`reason\` in the payload — never
both). \`capabilities --require\` cannot see this gate: it checks that the
operation exists on both sides, not the credential channel.

## Repo + PR utilities

\`mergebrief collaborators --json\` — the target repo's roster (needs push
access; 404 otherwise). \`mergebrief ready <n>\` — mark a draft PR ready
for review (GitHub enforces who may). \`mergebrief generate <url>\` — brief
a PR by URL on demand, no confirm; receipt \`{briefId}\`.

## The author loop (pre-ready self-review)

Same commands, your own PR: \`pr <n>\` → \`groups\` → \`diff --group\` per
group → fix locally → push → wait for regeneration → \`delta <n>\` to see
what your fixes changed → \`submit\` with outcome \`comment\` as your
self-review record. Run your reviewer before your reviewer does.

## The delta union (both arms, spelled out)

\`mergebrief delta <n> --json\` resolves YOUR last-review checkpoint via
PR-meta and emits ONE of:

    {"available":true,"baselineSha":"<sha>","headSha":"<sha>","artifact":{...verbatim delta artifact...}}
    {"available":false,"reason":"no-checkpoint"|"pending"|"baseline-unavailable"|"delta-not-generated"}

Both arms are exit 0 — modeled unavailability is data, not failure.
\`reason\` next-moves: \`no-checkpoint\` → you never submitted here, review
the full brief; \`pending\` → poll with backoff; \`baseline-unavailable\` →
the baseline is gone (rewritten history), review the full brief;
\`delta-not-generated\` → marks exist but no rich delta (huge span), diff
the span yourself with \`diff <n> --base <baselineSha> --head <headSha>\`.
An explicit \`--baseline/--head\` pair skips resolution; a missing artifact
for an explicit span is exit 4 (unmodeled).

## Repo addressing

Commands infer the repo from the \`origin\` remote; \`-R owner/name\`
overrides. \`repos --json\` lists everything your token can see (cached on
disk, no TTL; \`--refresh\` re-fetches). Renames self-heal when you address
a PR by \`-R\`/origin (one automatic refresh on a slug miss); the cached
\`repos\` listing itself shows a rename only after \`--refresh\`.
Exit 4 naming the profile means the repo is outside this token's
installation — switch profiles (\`--profile\`) or re-mint.
`;
