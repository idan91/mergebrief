// Phase 6: delta bodies, verbatim: the "your last review" compare content.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UNKNOWN_ORIGIN } from "../consts";
import { DeltaMetaSchema } from "../schemas";
import type { IngestRun, ResolvedPullRequests } from "../types";
import { buildPrKey, throwFileError } from "../utils";

export async function writeDeltas(
  run: IngestRun,
  deltaNames: readonly string[],
  resolved: ResolvedPullRequests,
): Promise<number> {
  let deltaCount = 0;

  for (const name of deltaNames) {
    const body = await readFile(join(run.dir, name), "utf8");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return throwFileError(name, "not valid JSON");
    }

    const meta = DeltaMetaSchema.safeParse(parsedJson);
    if (!meta.success) {
      return throwFileError(name, "delta body missing its metadata slice");
    }

    const row = resolved.prRows.get(
      buildPrKey(meta.data.pr.repo, meta.data.pr.number),
    );
    if (row === undefined) {
      run.skipped.push(name);
      run.log(`skip ${name}: no ingested pull request for its delta`);
      continue;
    }

    const origin = meta.data.generation ?? UNKNOWN_ORIGIN;
    await run.store.deltas.write({
      pullRequestId: row.id,
      baselineSha: meta.data.baselineSha,
      headSha: meta.data.headSha,
      provider: origin.provider,
      model: origin.model,
      effort: origin.effort,
      body,
    });

    deltaCount += 1;
    run.log(`delta ${name}`);
  }

  return deltaCount;
}
