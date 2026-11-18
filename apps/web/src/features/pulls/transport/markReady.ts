// The mark-ready write. Expected failures are RESULT KINDS the own-draft flow
// renders as toast copy. The operation is idempotent server-side, so retrying
// any kind is safe.
import type { QueryKey } from "@tanstack/react-query";
import { ProductActionIds } from "contract";

import {
  MarkReadyResultKinds,
  type MarkReadyAction,
  type MarkReadyResult,
  type MarkReadyResultKind,
} from "@web/features/brief/model";

import { ApiErrorCodes } from "../../../data/apiFetch";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";
import { buildPrMetaQueryOptions } from "../queries";

type MarkReadyFailureKind = Exclude<
  MarkReadyResultKind,
  typeof MarkReadyResultKinds.READY
>;

// A 403 on this route is ONLY the missing `contents: write` (the fresh-resolve
// denial collapses to 404 server-side), so a codeless 403 reads the same.
// The route's only 400 is a malformed :prNumber, unreachable from a valid UI
// state, so it stays in the upstream fallback. An unreadable 2xx body means
// the flip may have landed, so it reads as indeterminate.
const ReadyKinds: WriteKindTable<MarkReadyFailureKind> = {
  [ApiErrorCodes.FORBIDDEN]: MarkReadyResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.GITHUB_PERMISSION]: MarkReadyResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: MarkReadyResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.NOT_FOUND]: MarkReadyResultKinds.NOT_FOUND,
  [ApiErrorCodes.MALFORMED]: MarkReadyResultKinds.INDETERMINATE,
  fallback: MarkReadyResultKinds.UPSTREAM,
};

export async function markPrReady(
  repoId: string,
  prNumber: number,
): Promise<MarkReadyResult> {
  try {
    await request(ProductActionIds.MARK_READY, {
      params: { repoId, prNumber },
    });
    return { kind: MarkReadyResultKinds.READY };
  } catch (error) {
    return { kind: readFailureKind(error, ReadyKinds) };
  }
}

/** The invalidation boundary the action needs, a `QueryClient` satisfies it. */
export interface PrMetaInvalidator {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<void>;
}

/**
 * Build the route-injected mark-ready action. On success it invalidates the
 * PR-meta query and AWAITS the refetch before resolving, the own-draft UI
 * keys off PR-meta, so pending must hold until the flip is real (no optimistic
 * clear, no flicker). Every failure kind resolves WITHOUT touching the cache.
 */
export function createMarkReadyAction(
  client: PrMetaInvalidator,
  repoId: string,
  prNumber: number,
  transport: (
    repoId: string,
    prNumber: number,
  ) => Promise<MarkReadyResult> = markPrReady,
): MarkReadyAction {
  return async () => {
    const result = await transport(repoId, prNumber);
    if (result.kind === MarkReadyResultKinds.READY) {
      await client.invalidateQueries({
        queryKey: buildPrMetaQueryOptions(repoId, prNumber).queryKey,
      });
    }
    return result;
  };
}
