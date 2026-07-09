# API changelog

Consumer-visible changes to the public HTTP surfaces — `/api/*` and the
browser-managed `/auth/*` management routes — keyed to the
**server version** (`GET /api/version`; surfaced by
`mergebrief auth status`). Entries name the version that shipped them —
NOT a git SHA: releases are what adopters deploy, and the version string is
what a skewed client can actually see. (Within this monorepo, pre-release
"versions" are the `SERVER_VERSION` the operator sets; `dev` means an
untagged build — key such entries to the merge date instead.)

The contract discipline (ADR 0029): response shapes change additively
within a major; removals/renames ship expand/contract — new field first,
deprecation note here, removal only at a major.

## dev (2026-07-09 — BRIEF-17)

- **Added** `GET /api/version` → `{version}` (session-gated, both
  presentation channels).
- **Added** `GET /api/repos` → `{repos:[{repoId, fullName}]}` — the
  installation ∩ user-access intersection; flat, unpaginated, `no-store`;
  GitHub failure is a 401/502, never a DB-derived listing.
- **Added** Bearer-token presentation on `/api/*`
  (`Authorization: Bearer mergebrief_...`) — second channel over the same
  session machinery (ADR 0016 #4 as amended). `/auth/*` stays browser-only.
- **Added** `POST /auth/tokens`, `GET /auth/tokens`, and
  `DELETE /auth/tokens/:id` (browser-only token management).
