# mergebrief changelog

The CLI carries the same version number as the server: one git tag stamps
both at release, and the repo holds `0.0.0`, the dev sentinel. Once
released, the output contract is additive within a major; anything breaking
ships expand/contract with a deprecation entry here first. Before the first
release a field may still be removed.
Server-side shape changes live in
[`docs/api-changelog.md`](../../docs/api-changelog.md), keyed to the server
version (`auth status` → `server.version`).

## 0.1.0 (unreleased)

- Initial surface: `auth login`, `auth status`, `repos`, `pr [n]`,
  `generation <n>`, `groups <n>`, `conversation <n>`, `diff <n>`
  (`--base/--head`, `--group <id>`), `delta <n>` (`--baseline/--head`),
  `session`, `marks`, `narrative`, `context`,
  `draft create|update|reanchor|delete|attach`, `chunk-read`,
  `risk dismiss|address|reopen`, `reclassify`, `outcome`,
  `thread resolve|unresolve`, `ready`, `generate <url>`, `collaborators`,
  `spend`, `reply <commentId> --pr <n>`, `submit <n>` (`-F` | convenience
  flags), `capabilities` (`--require <ids...>` fail-closed preflight, exit 6
  INCOMPATIBLE).
- The exit-code contract (0-7, additive-only) and the stream/exit
  invariant: exit 0 prints the documented output (JSON, the raw diff, or
  nothing), any other exit prints
  nothing on stdout and one line on stderr. Exit 7 RATE_LIMITED is a 429; its error line ends
  `(HTTP 429, retry after <n>s)` when the server sent `Retry-After` in
  whole seconds.
- Per-profile config (`~/.config/mergebrief`, 0600) with `owners:` routing,
  `MERGEBRIEF_PROFILE` / `MERGEBRIEF_TOKEN` overrides, per-profile static
  headers; per-profile no-TTL repos cache (`~/.cache/mergebrief`).
- `--agents` is deprecated: it prints where the agent guide moved (the
  `mergebrief` skill).
