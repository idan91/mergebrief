// Facade hook: owns the delete flow (per-row pending, error copy, list
// invalidation) so the section stays wiring.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { buildUrlBriefsQueryOptions, deleteUrlBrief } from "../../queries";

export interface YourBriefsFlow {
  /** `repoId#prNumber` of the row whose delete is in flight; null = none. */
  readonly deletePendingKey: string | null;
  readonly deleteFailed: boolean;
  requestDelete(repoId: string, prNumber: number): void;
}

export function buildRowKey(repoId: string, prNumber: number): string {
  return `${repoId}#${String(prNumber)}`;
}

export function useYourBriefs(): YourBriefsFlow {
  const queryClient = useQueryClient();
  const [deletePendingKey, setDeletePendingKey] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ repoId, prNumber }: { repoId: string; prNumber: number }) =>
      deleteUrlBrief(repoId, prNumber),
    onSettled: async () => {
      setDeletePendingKey(null);
      await queryClient.invalidateQueries({
        queryKey: buildUrlBriefsQueryOptions().queryKey,
      });
    },
  });

  return {
    deletePendingKey,
    deleteFailed: mutation.isError,
    requestDelete(repoId, prNumber) {
      if (deletePendingKey !== null) {
        return;
      }
      setDeletePendingKey(buildRowKey(repoId, prNumber));
      mutation.mutate({ repoId, prNumber });
    },
  };
}
