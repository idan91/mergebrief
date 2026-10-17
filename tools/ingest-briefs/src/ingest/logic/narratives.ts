// Phase 4: revision narratives. The body carries its own full SHA pair; the
// anchoring brief is the SAME-index brief ingested in phase 3.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BriefSpanRow, PullRequestRowId } from "persistence";
import { NARRATIVE_FILE, UNKNOWN_ORIGIN } from "../consts";
import { NarrativeMetaSchema } from "../schemas";
import type { IngestRun, ResolvedPullRequests } from "../types";
import {
  buildPrKey,
  parseHeadIndex,
  readJsonFile,
  throwFileError,
} from "../utils";

/**
 * The head alone does not identify the brief: a base retarget produces two
 * briefs at one head with different indexes, and the narrative's group ids
 * belong to exactly one of them. The file name carries that index.
 */
async function findAnchorBrief(
  run: IngestRun,
  pullRequestId: PullRequestRowId,
  headSha: string,
  headIndex: number,
): Promise<BriefSpanRow | undefined> {
  const rows = await run.store.briefs.listForPullRequest(pullRequestId);
  return rows.find(
    (candidate) =>
      candidate.headSha === headSha && candidate.headIndex === headIndex,
  );
}

export async function writeNarratives(
  run: IngestRun,
  narrativeNames: readonly string[],
  resolved: ResolvedPullRequests,
): Promise<number> {
  let narrativeCount = 0;

  for (const name of narrativeNames) {
    const parsedJson = await readJsonFile(run.dir, name);
    const meta = NarrativeMetaSchema.safeParse(parsedJson);
    if (!meta.success) {
      return throwFileError(name, "narrative body missing its metadata slice");
    }

    const row = resolved.prRows.get(
      buildPrKey(meta.data.pr.repo, meta.data.pr.number),
    );
    if (row === undefined) {
      run.skipped.push(name);
      run.log(`skip ${name}: no ingested brief for its pull request`);
      continue;
    }

    const headIndex = parseHeadIndex(NARRATIVE_FILE.exec(name));
    if (headIndex === undefined) {
      return throwFileError(name, "narrative file name carries no head index");
    }

    const anchorRow = await findAnchorBrief(
      run,
      row.id,
      meta.data.headSha,
      headIndex,
    );
    if (anchorRow === undefined) {
      run.skipped.push(name);
      run.log(
        `skip ${name}: no ingested brief at its head and index ${headIndex}`,
      );
      continue;
    }

    const origin = meta.data.generation ?? UNKNOWN_ORIGIN;
    const body = await readFile(join(run.dir, name), "utf8");
    await run.store.revisionNarratives.write({
      pullRequestId: row.id,
      briefId: anchorRow.id,
      prevHeadSha: meta.data.prevHeadSha,
      headSha: meta.data.headSha,
      provider: origin.provider,
      model: origin.model,
      effort: origin.effort,
      body,
    });

    narrativeCount += 1;
    run.log(`narrative ${name}`);
  }

  return narrativeCount;
}
