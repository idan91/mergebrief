# mergebrief changelog

The CLI carries the same version number as the server: one git tag stamps
both at release, and the repo holds `0.0.0`, the dev sentinel. The output
contract is additive-only even pre-1.0; anything breaking ships
expand/contract with a deprecation entry here first.
Server-side shape changes live in
[`docs/api-changelog.md`](../../docs/api-changelog.md), keyed to the server
version (`auth status` → `server.version`).

## 0.1.0 (unreleased — BRIEF-17)

- Initial surface: `auth login`, `auth status`, `repos`, `pr [n]`,
  `groups <n>`, `conversation <n>`, `diff <n>` (`--base/--head`,
  `--group <id>`), `delta <n>` (`--baseline/--head`),
  `reply <commentId> --pr <n>`, `submit <n>` (`-F` | convenience flags),
  `capabilities` (`--require <ids...>` fail-closed preflight, exit 6
  INCOMPATIBLE).
- The exit-code contract (0-6, additive-only) and the stream/exit
  invariant (ADR 0029).
- Per-profile config (`~/.config/mergebrief`, 0600) with `owners:` routing,
  `MERGEBRIEF_PROFILE` / `MERGEBRIEF_TOKEN` overrides, per-profile static
  headers; per-profile no-TTL repos cache (`~/.cache/mergebrief`).
- `--agents` packaged guide.
