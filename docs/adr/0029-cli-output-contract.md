# CLI Output Contract — Passthrough, Additive-Only, Exit-Code Invariant

> **Amended 2026-10-03: skew lines.** #8 gains the `MergeBrief-Version`
> response header the API stamps on every `/api/*` response past the session
> layer, which the CLI reads off the first response of a run, and three line
> kinds, all on stderr, never a refusal, never an exit-code change: a daily
> nag when npm has a newer `mergebrief`; a warning on every successful run
> when the CLI and the server differ by a major, either direction; and the
> suffix `[server x, cli y]` (`, major gap` when major) on the one error line
> of a failed run while versions differ. `MERGEBRIEF_NO_VERSION_WARNING`
> silences the first two; the suffix stays. A dev build on either side
> (server `dev`, CLI `0.0.0`) prints nothing. #5 is unchanged: the versions
> ride inside the one line.

> **Amended 2026-08-21 — capability discovery.** `capabilities` joins `delta`
> and `auth status` as the third sanctioned CLI-synthesized shape, exit code
> **6 = INCOMPATIBLE** is appended to the table, and the skew-visibility
> clause (#8) gains the fail-closed discovery check. Everything else —
> passthrough, additive-only, the stream/exit invariant — is untouched.

The `mergebrief` CLI's machine output is a public contract consumed by
user-owned agent scripts — nothing of ours can migrate them. This ADR fixes
what is promised, and how the contract evolves without breaking consumers
(client boundary per ADR 0028).

## Decision

1. **Passthrough-by-default.** `--json` output IS the server response or
   artifact body, verbatim — never re-parsed or reshaped. One canonical
   shape across web, API, and CLI; no second schema to maintain. `pr` list
   = `{pulls:[...]}` verbatim; `groups` = the brief artifact body;
   `conversation` = `PrConversation`; write receipts verbatim
   (`{reviewId, commentsDegraded}`, `{commentId}`); `repos` = the
   `GET /api/repos` response.
2. **Exactly three CLI-synthesized shapes; all else passthrough.**
   (a) `delta` — a discriminated union on both arms:
   `{available: true, baselineSha, headSha, artifact: <verbatim body>}` /
   `{available: false, reason}`; `baselineSha` records the checkpoint
   resolution the CLI itself performed. (b) `auth status` — CLI-owned by
   necessity (no single server response backs it); MUST include the server
   version. (c) `capabilities` — a join no single party can produce: the
   server's `GET /api/capabilities` response (its registered operations plus
   `catalogFingerprint`) merged with what only the binary knows —
   `cliVersion`, its committed command map, its baked fingerprint. Server
   fields pass through verbatim inside it; the join is additive-only like
   every synthesized shape. Any other command inventing its own shape is a
   boundary violation.
3. **Stability promise: additive-only from day one** — fields are never
   removed, renamed, or retyped within a major; new fields may appear any
   release; consumers tolerant-read. Holds explicitly even pre-1.0. The
   accepted consequence: API response shapes become a public contract — a
   discipline that is de facto required once any external client exists.
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
   (network, 5xx, server-400 skew) · 2 usage error caught client-side (bad
   flags, `--group` with a custom span, malformed submit JSON shape) ·
   3 auth (401 — re-mint) · 4 not found (404, incl. unmodeled delta 404) ·
   5 server rejected payload (4xx validation — makes an agent's submit loop
   self-correcting without stderr parsing) ·
   6 incompatible (`capabilities --require` found a required operation the
   server does not register or this binary maps to no command — stop before
   driving it).
7. **`--json` is an explicit flag** (gh posture). TTY default is human
   rendering, explicitly NON-contractual — it may change any release and
   must never be parsed. No pipe auto-detection: output shape follows the
   flag alone, never invocation context; TTY checks tune cosmetics only
   (`$PAGER`, color). `diff` REJECTS `--json` (exit 2) — the raw unified
   diff is its machine format; no JSON arm exists.
8. **Skew visibility, not negotiation.** The server exposes its version;
   `auth status` surfaces it; the API changelog is keyed to it. No
   version-negotiation protocol in v1. Discovery keeps that posture:
   `GET /api/capabilities` plus `mergebrief capabilities --require` is a
   **fail-closed compatibility check** — required operations either all pass
   or the command exits 6 before anything runs — never a negotiation, and a
   catalog-fingerprint mismatch alone is one stderr warning line, never a
   gate.

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
- The 6-code exit table and the invariant lead the agent-facing docs (the
  `mergebrief` skill's contract reference) — they are what make unattended
  agent loops safe.
- The TTY rendering layer is free to improve without ceremony.
