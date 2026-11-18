import { useTranslation } from "react-i18next";

import { useRegenerateBrief } from "../../../../../../hooks/regenerate-brief/useRegenerateBrief";
import { RegenerateNotices } from "../../../../../../hooks/regenerate-brief/utils";
import type { PrSummary } from "../../../../../../types";
import { LatestPushRunNotices } from "../latest-push/consts";
import { readLatestPushState } from "../latest-push";
import type { NewerCommitsChipState } from "../types";
import { deriveNewerCommitsStatus } from "../utils";
import { usePasteRegenerate } from "./usePasteRegenerate";

export interface UseNewerCommitsInput {
  readonly meta: PrSummary;
  readonly repoId: string;
  readonly prNumber: number;
  readonly staleHead: boolean;
  readonly onGoToNewest?: (() => void) | undefined;
}

/**
 * The chip's runs and its one live region, held by the page so both outlive
 * the chip. An installation row runs the latest push through the regenerate
 * route (Retry, Generate); a url row through the paste path. Only the run
 * the row kind allows can ever announce, so the region reads that one, and
 * either run announces the brief it asked for once it lands. A Retry or
 * Generate asks for the head it was queued on, on the PR's current base, so
 * a brief stored for that head on an earlier base is not its arrival.
 */
export function useNewerCommits({
  meta,
  repoId,
  prNumber,
  staleHead,
  onGoToNewest,
}: UseNewerCommitsInput): NewerCommitsChipState {
  const { t } = useTranslation();
  const latest = readLatestPushState(meta);
  const latestRun = useRegenerateBrief({
    repoId,
    prNumber,
    notices:
      latest === undefined ? RegenerateNotices : LatestPushRunNotices[latest],
    arrival: {
      arrived: meta.briefAvailable,
      head: meta.headSha,
      notice: "pulls.newerCommits.announce.arrived",
    },
  });
  const paste = usePasteRegenerate(meta, repoId, prNumber);

  const announcement = meta.appInstalled
    ? latestRun.announcement
    : paste.announcement;
  const status = deriveNewerCommitsStatus(t, {
    meta,
    staleHead,
    onGoToNewest,
    latestRun: { pending: latestRun.pending, trigger: latestRun.regenerate },
    pasteRun: paste,
  });
  if (status === undefined) {
    return { announcement };
  }
  return { announcement, status };
}
