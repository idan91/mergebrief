// ENTRY POINT — the ingest core, importable by tests and the e2e seeder.
// `src/main.ts` is the runnable CLI wrapper and is deliberately not exported.
export {
  ingestBriefDirectory,
  type IngestBriefOptions,
  type IngestSummary,
  type RepoResolution,
  type ResolveRepo,
} from "./ingest";
