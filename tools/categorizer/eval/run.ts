import type { Brief } from "../src/types";

/**
 * The run executor's seam is an injected `generate` closure — the CLI
 * wires the real `categorize()` call; tests wire fakes. Serial by design:
 * runs share the provider's prompt cache and a failure storm should stop
 * costing money at the point someone can Ctrl-C.
 */
export interface CaseRunResult {
  briefs: Brief[];
  generationFailures: number;
  failureMessages: string[];
}

export async function runCase(
  generate: () => Promise<Brief>,
  runs: number,
): Promise<CaseRunResult> {
  const briefs: Brief[] = [];
  const failureMessages: string[] = [];
  for (let run = 1; run <= runs; run++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- serial by design (see module doc)
      briefs.push(await generate());
    } catch (error) {
      failureMessages.push(
        `run ${run}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { briefs, generationFailures: failureMessages.length, failureMessages };
}
