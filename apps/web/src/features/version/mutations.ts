// The dismiss write: one POST naming the release, then the cached snapshot
// takes the dismissal so the band leaves without a refetch. A failure throws
// its `ApiError` and keeps the band and its button where the same action is
// still available.
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { ProductActionIds, type DismissVersionNoticeBody } from "contract";

import { request } from "../../data/request";
import { buildVersionQueryOptions } from "./queries";
import { VersionStates, type VersionState } from "./types";

async function postDismiss(version: string): Promise<void> {
  const body: DismissVersionNoticeBody = { version };
  await request(ProductActionIds.DISMISS_VERSION_NOTICE, { params: {}, body });
}

function applyDismissal(
  state: VersionState | undefined,
  version: string,
): VersionState | undefined {
  if (state === undefined || state.kind !== VersionStates.KNOWN) {
    return state;
  }
  return {
    kind: VersionStates.KNOWN,
    snapshot: { ...state.snapshot, dismissedVersion: version },
  };
}

export function useDismissVersion(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  const { queryKey } = buildVersionQueryOptions();
  return useMutation({
    mutationFn: postDismiss,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (_result, version) => {
      queryClient.setQueryData(queryKey, (state: VersionState | undefined) =>
        applyDismissal(state, version),
      );
    },
  });
}
