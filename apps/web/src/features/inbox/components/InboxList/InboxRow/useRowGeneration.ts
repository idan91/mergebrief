import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { LIVE_POLL_MS } from "@web/features/pulls/consts";
import { buildPrMetaQueryOptions } from "@web/features/pulls/queries";
import { deriveGenerationWait } from "@web/utils/generation-wait";
import {
  GenerationWaits,
  type GenerationWait,
} from "@web/utils/generation-wait/types";
import { GenerationStatuses } from "types";
import type { InboxGeneration, InboxItem } from "../../../types";
import { INBOX_QUERY_ROOT, ROW_POLL_MS } from "../../../consts";

function isInFlight(
  generation: Pick<InboxGeneration, "status"> | undefined,
): boolean {
  return (
    generation?.status === GenerationStatuses.PENDING ||
    generation?.status === GenerationStatuses.RUNNING
  );
}

const ROW_POLL_PACE: Record<GenerationWait, number | false> = {
  [GenerationWaits.IN_FLIGHT]: ROW_POLL_MS,
  [GenerationWaits.STALLED]: LIVE_POLL_MS,
  [GenerationWaits.SETTLED]: false,
};

/**
 * A terminal read stamped before the list's own in-flight stamp is a prior
 * run's cached answer, not this run's end; ISO stamps compare as strings.
 */
function isStaleRead(
  read: InboxGeneration | undefined,
  listed: InboxGeneration | undefined,
): boolean {
  if (read === undefined || isInFlight(read)) {
    return false;
  }
  return read.updatedAt < (listed?.updatedAt ?? "");
}

/**
 * A pending or running row polls its own status through the per-pull-request
 * read; the list itself never polls. Once the poll reports a terminal state
 * the list re-reads, so the row picks up its new brief and review state. A
 * stalled head has no job left to run, so it polls at the Brief page's
 * settled pace until a rerun moves it.
 */
export function useRowGeneration(item: InboxItem): InboxGeneration | undefined {
  const queryClient = useQueryClient();
  const enabled = isInFlight(item.generation);
  const meta = useQuery({
    ...buildPrMetaQueryOptions(item.repoId, item.prNumber),
    enabled,
    // A failed read ends the poll: the list's own window-focus re-read is
    // the retry, and an outage must not be hit every four seconds.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (query.state.status === "error" || data === undefined) {
        return false;
      }
      if (isStaleRead(data.generation, item.generation)) {
        return ROW_POLL_MS;
      }
      return ROW_POLL_PACE[deriveGenerationWait(data.generation)];
    },
  }).data;

  const read = meta?.generation;
  const staleRead = isStaleRead(read, item.generation);
  const settled =
    enabled && read !== undefined && !isInFlight(read) && !staleRead;
  useEffect(() => {
    if (!settled) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
  }, [settled, queryClient]);

  // Once the list no longer holds the row in flight, the list wins: a stale
  // read from a poll that ended on an error must not outrank it, and neither
  // does a prior run's terminal answer while this run is still queued.
  if (!enabled || read === undefined || staleRead) {
    return item.generation;
  }
  return { status: read.status, updatedAt: read.updatedAt };
}
