import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGenerator,
  loadGeneratorConfigFile,
  type Effort,
  type TokenUsage,
} from "generators";
import {
  categorize,
  categorizeRevisionNarrative,
  type LengthViolation,
} from "brief-core";
import { loadCases } from "./loadCase";
import { loadPairCases } from "./pairs";
import { renderCostLine } from "./report";
import { withUsageSink } from "./usageSink";

/**
 * BRIEF-148 cross-model length spot check (length numbers only, no property
 * verdicts): run a case fixture through the --config generator and print
 * prose-length compliance. Exists because the eval harness refuses
 * cross-key runs before spend (by design). A SINGLE case id runs the full
 * brief; a PAIR case id runs a fresh revised-side brief plus the revision
 * NARRATIVE over the pair's incremental diff — the narrative surfaces
 * (overview + hover-callout chunk summaries) are only reachable this way.
 *
 *   pnpm -C tools/categorizer exec tsx eval/spot-brief148.ts <configPath> <caseId> <runs>
 */

const here = dirname(fileURLToPath(import.meta.url));

function printViolations(violations: readonly LengthViolation[]): void {
  if (violations.length === 0) {
    console.info("  prose length: CLEAN");
    return;
  }
  for (const v of violations) {
    console.info(`  VIOLATION ${v.surface}: ${v.field} ${v.actual}/${v.cap}`);
  }
}

async function main(): Promise<void> {
  const [configPath, caseId, runsRaw] = process.argv.slice(2);
  const runs = Number(runsRaw ?? "2");
  if (!configPath || !caseId || !Number.isInteger(runs) || runs < 1) {
    console.error(
      "usage: tsx eval/spot-brief148.ts <configPath> <caseId> <runs: positive integer>",
    );
    process.exit(2);
  }
  try {
    process.loadEnvFile(".env");
  } catch {
    // ambient env may carry the key
  }
  const loaded = loadGeneratorConfigFile(configPath);
  if (!loaded.ok) throw new Error(loaded.error.issues.join("; "));
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: "out",
  });
  if (!constructed.ok) throw new Error(constructed.error.issues.join("; "));
  const effort: Effort = loaded.value.generator.effort ?? "medium";
  // Cost on every spend (decision 7): sum usage and print the same line the
  // harness prints — tokens only (no price row lookup for spot runs).
  const usage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  const generator = withUsageSink(constructed.value, (u: TokenUsage) => {
    usage.calls += 1;
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cacheReadTokens += u.cacheReadTokens;
  });
  const origin = generator.origin(effort);
  const key = `${origin.provider}:${origin.model}`;

  const singles = await loadCases(join(here, "cases"));
  if (!singles.ok) throw new Error(singles.error);
  const single = singles.value.find((c) => c.id === caseId);
  const pairs = await loadPairCases(join(here, "pair-cases"), caseId);
  if (!pairs.ok) throw new Error(pairs.error);
  const pair = pairs.value[0];
  if (single === undefined && pair === undefined) {
    throw new Error(`unknown case "${caseId}" (singles and pair corpora)`);
  }

  for (let run = 1; run <= runs; run++) {
    console.info(`run ${run}/${runs}…`);
    if (single !== undefined) {
      // eslint-disable-next-line no-await-in-loop -- serial by design, matches runCase
      const brief = await categorize(
        single.fixture.pr,
        1,
        single.fixture.commitRange,
        generator,
        () => {},
        single.fixture.repoContext,
        effort,
      );
      console.info(
        `  groups: ${brief.changeGroups.length}; summaries chars: ${brief.changeGroups
          .map((g) => g.summary.length)
          .join(", ")}; titles chars: ${brief.changeGroups
          .map((g) => g.title.length)
          .join(", ")}`,
      );
      printViolations(brief.lengthViolations ?? []);
    } else if (pair !== undefined) {
      // Narrative mode: fresh revised-side brief, then the revision
      // narrative over the pair's incremental diff — the only path that
      // exercises narrative-overview / narrative-chunk-summary caps.
      // eslint-disable-next-line no-await-in-loop -- serial by design
      const brief = await categorize(
        pair.fixture.revised.pr,
        2,
        pair.fixture.revised.commitRange,
        generator,
        () => {},
        pair.fixture.revised.repoContext,
        effort,
      );
      // eslint-disable-next-line no-await-in-loop -- serial by design
      const narrative = await categorizeRevisionNarrative(
        {
          locator: pair.fixture.revised.pr.locator,
          meta: pair.fixture.revised.pr.meta,
          prevHeadSha: pair.fixture.base.commitRange.head,
          headSha: pair.fixture.revised.commitRange.head,
          prevIndex: 1,
          headIndex: 2,
          incrementalDiff: pair.fixture.increment.incrementalDiff,
          brief,
        },
        generator,
        () => {},
        effort,
      );
      console.info(
        `  brief groups: ${brief.changeGroups.length}; summaries chars: ${brief.changeGroups
          .map((g) => g.summary.length)
          .join(", ")}`,
      );
      printViolations(brief.lengthViolations ?? []);
      console.info(
        `  narrative overview chars: ${narrative.overview.length}; chunk summaries chars: ${narrative.chunks
          .map((c) => c.summary.length)
          .join(", ")}`,
      );
      printViolations(narrative.lengthViolations ?? []);
    }
  }
  console.info(
    renderCostLine({ key, billing: { kind: "api" }, usage, costUsd: null }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
