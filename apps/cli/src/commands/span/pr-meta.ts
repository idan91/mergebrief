// The PR-meta slice the commands consume (tolerant-read: only the fields the
// CLI actually joins on, everything else passes through untouched).
import { ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { buildSkewError } from "../../utils";
import { buildRequestPath } from "../request-path";

const prMetaSliceSchema = z.object({
  baseSha: z.string().nullable(),
  headSha: z.string().nullable(),
  briefAvailable: z.boolean(),
  headBriefStored: z.boolean().optional(),
  behind: z.boolean().optional(),
  generation: z
    .object({
      status: z.string(),
      errorCode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  revisions: z
    .array(
      z.object({
        baseSha: z.string(),
        headSha: z.string(),
        headIndex: z.number().int().positive(),
      }),
    )
    .optional(),
  comparisons: z
    .object({
      lastReview: z
        .union([
          z.object({
            deltaAvailable: z.boolean(),
            deltaUnchanged: z.literal(true).optional(),
            baselineSha: z.string(),
          }),
          z.object({ unavailable: z.string() }),
        ])
        .optional(),
    })
    .optional(),
});

export type PrMetaFields = z.infer<typeof prMetaSliceSchema>;

export type StoredRevision = NonNullable<PrMetaFields["revisions"]>[number];

export interface PrMetaSlice {
  readonly bodyText: string;
  readonly slice: PrMetaFields;
}

export async function fetchPrMeta(
  client: ApiClient,
  repoId: string,
  prNumber: number,
): Promise<PrMetaSlice> {
  const response = await client.request({
    path: buildRequestPath(ProductQueryIds.READ_PULL, { repoId, prNumber }),
  });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.bodyText);
  } catch {
    throw buildSkewError("PR-meta");
  }
  const slice = prMetaSliceSchema.safeParse(parsedJson);
  if (!slice.success) {
    throw buildSkewError("PR-meta");
  }
  return { bodyText: response.bodyText, slice: slice.data };
}

/**
 * A brief is stored at the meta's own span, on whatever base it was built.
 * A server older than `headBriefStored` meant exactly this by
 * `briefAvailable`.
 */
export function isSpanBriefStored(slice: PrMetaFields): boolean {
  return slice.headBriefStored ?? slice.briefAvailable;
}
