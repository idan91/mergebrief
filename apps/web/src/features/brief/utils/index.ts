// Curated utils entry: a convenience surface, not the only door — logic
// modules stay direct file imports, and internal brief files import the
// modules directly, never this index. Deliberately absent: queries.ts
// (server-touching modules never sit behind a barrel) and fixtures.ts
// (test-only — fixtures never ride a production barrel).
export { resolveLegacyDeltaRedirect } from "./legacyRedirect";
export {
  buildBriefViewModel,
  type BriefViewModel,
  type RiskFlag,
} from "./viewModel";
