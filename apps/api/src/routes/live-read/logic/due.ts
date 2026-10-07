import type { PullRequestRef } from "github";
import type { PullRequestRow } from "persistence";
import { PrStates } from "types/pull-requests";
import { parseOwnerAndName } from "../../repos/utils";

/** A row is due when it is not merged and its last read is missing or older than the window. */
export function isDue(
  row: PullRequestRow,
  now: Date,
  staleMs: number,
): boolean {
  if (row.state === PrStates.MERGED) {
    return false;
  }
  if (row.githubReadAt === null) {
    return true;
  }
  return row.githubReadAt.getTime() < now.getTime() - staleMs;
}

/** A row paired with the ref GitHub is asked about. */
export interface ReadTarget {
  readonly row: PullRequestRow;
  readonly ref: PullRequestRef;
}

export interface ReadPlan {
  readonly targets: readonly ReadTarget[];
  /** Rows with no usable slug: nothing to ask GitHub about. */
  readonly unaddressable: readonly PullRequestRow[];
}

export function planReadTargets(rows: readonly PullRequestRow[]): ReadPlan {
  const targets: ReadTarget[] = [];
  const unaddressable: PullRequestRow[] = [];
  for (const row of rows) {
    const parsed =
      row.repoSlug === null ? undefined : parseOwnerAndName(row.repoSlug);
    if (parsed === undefined) {
      unaddressable.push(row);
      continue;
    }
    targets.push({
      row,
      ref: { owner: parsed.owner, repo: parsed.repo, prNumber: row.prNumber },
    });
  }
  return { targets, unaddressable };
}

export function splitChunks<Item>(
  items: readonly Item[],
  size: number,
): Item[][] {
  const chunks: Item[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
