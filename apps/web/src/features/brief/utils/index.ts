// Curated utils entry (ADR 0037): a convenience surface, not the only door —
// logic modules (repoConfig, validation, diffSlicing) stay direct file
// imports per the ADR, and internal brief files import the modules
// directly, never this index (import/no-cycle). Deliberately absent:
// queries.ts (touches
// server/brief.functions — server-touching modules never sit behind a
// barrel) and fixtures.ts (test-only — tests import ./fixtures directly;
// fixtures never ride a production barrel).
export { resolveLegacyDeltaRedirect } from "./legacyRedirect";
export {
  buildBriefViewModel,
  type BriefViewModel,
  type RiskFlag,
} from "./viewModel";
