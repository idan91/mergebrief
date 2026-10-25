// The Regenerate write. A 409 means the meta read is stale, so both refusals
// read as their own kinds and the hook refreshes the meta.
import { ProductActionIds } from "contract";

import { ApiErrorCodes } from "../../../data/apiFetch";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";
import {
  RegenerateResultKinds,
  type RegenerateResult,
  type RegenerateResultKind,
} from "../types";

type RegenerateFailureKind = Exclude<
  RegenerateResultKind,
  typeof RegenerateResultKinds.QUEUED
>;

const RegenerateKinds: WriteKindTable<RegenerateFailureKind> = {
  [ApiErrorCodes.GENERATION_HELD]: RegenerateResultKinds.HELD,
  [ApiErrorCodes.GENERATION_NOT_REGENERABLE]:
    RegenerateResultKinds.NOT_REGENERABLE,
  [ApiErrorCodes.NOT_FOUND]: RegenerateResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.FORBIDDEN]: RegenerateResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.SCOPE_EXCEEDED]: RegenerateResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.HUMAN_ONLY]: RegenerateResultKinds.NOT_ALLOWED,
  [ApiErrorCodes.MALFORMED]: RegenerateResultKinds.INDETERMINATE,
  fallback: RegenerateResultKinds.UPSTREAM,
};

export async function regenerateBrief(
  repoId: string,
  prNumber: number,
): Promise<RegenerateResult> {
  try {
    await request(ProductActionIds.REGENERATE_BRIEF, {
      params: { repoId, prNumber },
    });
    return { kind: RegenerateResultKinds.QUEUED };
  } catch (error) {
    return { kind: readFailureKind(error, RegenerateKinds) };
  }
}
