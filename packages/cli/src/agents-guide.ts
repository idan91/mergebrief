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
- **Passthrough by default:** \`pr\`, \`groups\`, \`conversation\`, \`repos\`
  and the write receipts are the server's response bytes, verbatim.
  Exactly three shapes are CLI-synthesized: the \`delta\` union,
  \`auth status\`, and \`capabilities\`.
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

## The reviewer loop

1. \`mergebrief pr --json\` — pick a PR (or you were given one).
2. \`mergebrief pr <n> --json\` — read the meta. **Record \`baseSha\` and
   \`headSha\`** — they name the brief span every write takes. If
   \`briefAvailable\` is false,
   generation is webhook-driven: poll \`pr <n>\` with backoff; never try to
   trigger it.
3. \`mergebrief groups <n> --json\` — the brief: change groups, chunks,
   risk-surface attributes. This is your reading order.
4. \`mergebrief diff <n> --group <id>\` — the whole-hunk diff of one group
   (raw diff on stdout). Review group by group.
5. \`mergebrief conversation <n> --json\` — existing threads;
   \`mergebrief reply <commentId> --pr <n> --body-file -\` to answer.
6. \`mergebrief submit <n> --base <baseSha> --head <headSha> -F -\` with a JSON
   payload: \`{"outcome":"comment"|"approve"|"request-changes","body":"..."}\`.
   The comments are the drafts the server already holds for that span, and
   the span is REQUIRED and never auto-fetched — name what you read.
   Drafting inline comments has no CLI command yet, so a CLI-only submit
   posts a body-only review today.
   Exit 5 means the server told you exactly what to fix; exit 0 returns
   \`{reviewId, commentsDegraded}\`. If \`commentsDegraded\` is true your
   inline comments were folded into the review body (anchors rejected
   upstream) — the review still posted; do not re-submit.
   NOTE: GitHub rejects APPROVE/REQUEST_CHANGES on your own PR (COMMENT
   passes) — that arrives as a server-relayed error; do not retry-loop it.

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
