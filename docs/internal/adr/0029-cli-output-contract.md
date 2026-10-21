# 0029: CLI Output Contract — Passthrough, Additive-Only, Exit-Code Invariant

Status: amended (see Amendments)

The `mergebrief` CLI's machine output is a public contract consumed by
user-owned agent scripts — nothing of ours can migrate them. This ADR fixes
what is promised, and how the contract evolves without breaking consumers
(client boundary per ADR 0028).

## Decision

1. **Passthrough-by-default.** `--json` output IS the server response or
   artifact body, verbatim — never re-parsed or reshaped. One canonical
   shape across web, API, and CLI; no second schema to maintain. `pr` with
   no argument = the `GET /api/inbox` page (`Page<InboxItem>`,
   `packages/contract/src/inbox.ts`) verbatim; `groups` = the brief artifact
   body; `conversation` = `PrConversation`; write receipts verbatim
   (`SubmitReviewResponse` in `packages/contract/src/review.ts`:
   `{reviewId, commentsDegraded, commentsFolded, commentsTotal}`, and
   `{commentId}`); `repos` = the `GET /api/repos` response.
2. **Exactly two CLI-synthesized shapes; all else passthrough.**
   (amended, see Amendments: a third, `capabilities`, joined on 2026-08-21.)
   (a) `delta` — a discriminated union on both arms:
   `{available: true, baselineSha, headSha, artifact: <verbatim body>}` /
   `{available: false, reason}`; `baselineSha` records the checkpoint
   resolution the CLI itself performed. (b) `auth status` — CLI-owned by
   necessity (no single server response backs it); MUST include the server
   version. Any other command inventing its own shape is a boundary
   violation.
3. **Stability promise: additive-only from day one** — fields are never
   removed, renamed, or retyped within a major; new fields may appear any
   release; consumers tolerant-read. Holds explicitly even pre-1.0
   (amended, see Amendments). The accepted consequence: API response
   shapes become a public contract — a discipline that is de facto required
   once any external client exists.
4. **Breaking changes = expand/contract, never "migrations".** Ship new
   alongside old (additive) → deprecate in the changelog → remove only at a
   major bump. The deprecation window keeps old CLI versions working
   against newer servers.
5. **Stream/exit invariant — the contract in one sentence:** exit 0 ⇒
   stdout is the documented JSON; exit ≠ 0 ⇒ stdout is empty and stderr
   carries one line (relaying server error text + HTTP status). Modeled
   unavailability is data, not failure (`delta`'s `{available:false}` arm,
   exit 0).
6. **Exit codes (contract surface — additive-only, never renumbered):**
   0 success (incl. modeled unavailability) · 1 generic/unexpected
   (network, 5xx) · 2 usage error caught client-side (bad
   flags, `--group` with a custom span, malformed submit JSON shape) ·
   3 auth (401 — re-mint) · 4 not found (404, incl. unmodeled delta 404) ·
   5 server rejected payload (every other 4xx, a 400 included — makes an
   agent's submit loop self-correcting without stderr parsing;
   `apps/cli/src/exit.ts`) ·
   6 incompatible (`capabilities --require` found a required operation the
   server does not register or this binary maps to no command — stop before
   driving it) ·
   7 rate limited (429; the one stderr line names the `Retry-After` wait in
   whole seconds when the server sent one; wait, then retry).
7. **`--json` is an explicit flag** (gh posture). TTY default is human
   rendering, explicitly NON-contractual — it may change any release and
   must never be parsed. No pipe auto-detection: output shape follows the
   flag alone, never invocation context; TTY checks tune cosmetics only
   (`$PAGER`, color). `diff` REJECTS `--json` (exit 2) — the raw unified
   diff is its machine format; no JSON arm exists.
8. **Skew visibility, not negotiation.** The server exposes its version;
   `auth status` surfaces it; the API changelog is keyed to it. No
   version-negotiation protocol in v1 (amended, see Amendments: capability
   discovery, the version header and the skew lines were added later).

## Considered Options

- **CLI-shaped envelopes over every response.** Rejected: a second schema
  to document, test, and keep in sync; the server shape is already the
  canonical one the web FE consumes.
- **JSON errors on stdout.** Rejected: forces shape-sniffing on one stream
  and pollutes pipelines. Structured JSON-on-stderr can arrive additively
  later.
- **Pipe auto-detection of output mode.** Rejected: behavior must follow
  visible state (the flag), not entry path — the invisible-mode-gates rule.
- **Version negotiation / pinned compatibility.** Rejected in v1: the
  additive-only promise plus the expand/contract window covers skew;
  visibility (server version in `auth status`) over protocol.

## Consequences

- Server response-shape changes are now governed: additive freely; removals
  and renames only via expand/contract with a changelog entry
  (`docs/api-changelog.md`, keyed to the server version).
- The eight-code exit table (`apps/cli/src/exit.ts`) and the invariant lead
  the agent-facing docs (the `mergebrief` skill's contract reference,
  `skills/mergebrief/contract.md`) — they are what make unattended agent
  loops safe.
- The TTY rendering layer is free to improve without ceremony.

## Amendments

### 2026-08-21: Capability discovery

`capabilities` joins `delta` and `auth status` as the third sanctioned
CLI-synthesized shape: the server's `GET /api/capabilities` response (its
registered operations) merged with what only the binary knows, `cliVersion`
and its committed command map. Server fields pass through verbatim inside it;
the join is additive-only like every synthesized shape. Exit code
6 = INCOMPATIBLE is appended to the table, and #8 gains the fail-closed
discovery check: `mergebrief capabilities --require` either passes every
required operation or exits 6 before anything runs, never a negotiation.
Passthrough, additive-only and the stream/exit invariant are untouched.

### 2026-10-03: Skew lines

Recorded with ADR 0045. #8 gains the `MergeBrief-Version` response header the
API stamps on every `/api/*` response past the session layer, which the CLI
reads off the first response of a run, and three line kinds, all on stderr,
never a refusal, never an exit-code change: a daily nag when npm has a newer
`mergebrief`; a warning on every successful run when the CLI and the server
differ by a major, either direction; and the suffix `[server x, cli y]`
(`, major gap` when major) on the one error line of a failed run while
versions differ. `MERGEBRIEF_NO_VERSION_WARNING` silences the first two; the
suffix stays. A dev build on either side (server `dev`, CLI `0.0.0`) prints
nothing. #5 is unchanged: the versions ride inside the one line
(`apps/cli/src/version/index.ts`).

### 2026-10-05: Rate limiting

Exit code 7 = RATE_LIMITED is appended to the table for a 429, which exit 5
would have told a self-correcting loop to resend at once. The one error line
ends `(HTTP 429, retry after <n>s)` when `Retry-After` is whole seconds; any
other form is ignored. #5 is unchanged.

### 2026-10-12: The promise starts at the first public release

#3's additive-only promise starts at the first public release, not before it.
While nothing has shipped there is no external client to protect, so
pre-release removals and renames are allowed; each one is listed in
`docs/api-changelog.md`. The HTTP-contract work used this window to drop
`{ok:true}` bodies, echo bodies and the catalog fingerprint before rc.1. A 204
success prints nothing (exit 0 stays the signal). The catalog fingerprint and
its mismatch warning are gone on both sides: `capabilities` joins the server's
operations with `cliVersion` and the binary's command map, and the server
version is the only skew signal (#8).
