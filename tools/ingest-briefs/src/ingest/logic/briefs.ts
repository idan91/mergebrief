// Phase 3: brief bodies, verbatim.
import { UNKNOWN_ORIGIN } from "../consts";
import type {
  IngestRun,
  ParsedBriefFile,
  ResolvedPullRequests,
} from "../types";
import { buildPrKey, throwFileError } from "../utils";

export async function writeBriefs(
  run: IngestRun,
  briefFiles: readonly ParsedBriefFile[],
  resolved: ResolvedPullRequests,
): Promise<number> {
  let briefCount = 0;

  for (const brief of briefFiles) {
    const key = buildPrKey(brief.meta.pr.repo, brief.meta.pr.number);
    const row = resolved.prRows.get(key);
    if (row === undefined) {
      // Left unmapped in phase 2 (a pre-index brief whose base could not
      // resolve).
      if (run.unmapped.includes(brief.name)) {
        continue;
      }
      return throwFileError(brief.name, "brief with no pull_request row");
    }

    // A pre-index brief with no resolved base cannot be placed on its own,
    // even when a sibling brief gave the PR a row.
    const legacyBase =
      brief.legacy === true ? resolved.legacyBaseShas.get(key) : undefined;
    if (brief.legacy === true && legacyBase === undefined) {
      run.unmapped.push(brief.name);
      run.log(`skip ${brief.name}: pre-index brief with no resolved base SHA`);
      continue;
    }

    const origin = brief.meta.generation ?? UNKNOWN_ORIGIN;
    const written = await run.store.briefs.write({
      pullRequestId: row.id,
      baseSha: legacyBase ?? brief.meta.commitRange.base,
      headSha: brief.meta.commitRange.head,
      headIndex: brief.meta.index,
      commitCount: brief.meta.commitRange.commitCount ?? 0,
      provider: origin.provider,
      model: origin.model,
      effort: origin.effort,
      body: brief.body,
    });
    if (!written.ok) {
      return throwFileError(brief.name, written.error.message);
    }

    briefCount += 1;
    run.log(`brief ${brief.name}`);
  }

  return briefCount;
}
