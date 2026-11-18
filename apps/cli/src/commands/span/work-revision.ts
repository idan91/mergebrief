// Where the reviewer's work sits, for a machine with no record of what they
// read. A session read on the latest brief names it, and creates nothing.
import { ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { buildSkewError } from "../../utils";
import { buildRequestPath } from "../request-path";
import type { StoredRevision } from "./pr-meta";

const sessionPlaceSliceSchema = z.object({
  materialized: z.boolean(),
  carriedFrom: z
    .object({ revisions: z.number(), items: z.number() })
    .nullable(),
});

export interface WorkRevisionLookup {
  readonly client: ApiClient;
  readonly repoId: string;
  readonly prNumber: number;
  readonly revisions: readonly StoredRevision[];
  readonly latest: StoredRevision;
}

function parseSessionPlace(bodyText: string) {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    throw buildSkewError("session");
  }
  const place = sessionPlaceSliceSchema.safeParse(parsedJson);
  if (!place.success) {
    throw buildSkewError("session");
  }
  return place.data;
}

/** The revision holding this reviewer's work; undefined when they have none anywhere. */
export async function findWorkRevision(
  lookup: WorkRevisionLookup,
): Promise<StoredRevision | undefined> {
  const { client, repoId, prNumber, revisions, latest } = lookup;
  const { bodyText } = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_REVIEW_SESSION,
      { repoId, prNumber },
      { base: latest.baseSha, head: latest.headSha },
    ),
  });

  const { materialized, carriedFrom } = parseSessionPlace(bodyText);
  if (materialized) {
    return latest;
  }
  // A previous session that carried nothing leaves no work to stay with.
  if (carriedFrom === null || carriedFrom.items === 0) {
    return undefined;
  }
  const headIndex = latest.headIndex - carriedFrom.revisions;
  return revisions.find((revision) => revision.headIndex === headIndex);
}
