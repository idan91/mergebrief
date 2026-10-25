import type { GenerationSummary, PrSummary } from "../../../../../types";

/** A failed latest push with no brief; override per case. */
export function makeGeneration(
  overrides: Partial<GenerationSummary> = {},
): GenerationSummary {
  return {
    status: "failed",
    attempts: 0,
    errorCode: "provider-timeout",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

/** An open installation PR a pusher reads, behind its failed latest push. */
export function makeMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    headSha: "head-2",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: true,
    viewerCanPush: true,
    appInstalled: true,
    behind: true,
    updatedAt: "2026-10-24T10:00:00.000Z",
    generation: makeGeneration(),
    ...overrides,
  };
}
