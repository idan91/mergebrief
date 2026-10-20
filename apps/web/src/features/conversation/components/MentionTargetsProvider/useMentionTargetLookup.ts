import { useCallback, useMemo, useState } from "react";

import type { MentionTargets } from "@web/components/Markdown/context";
import { useLatestRef } from "@web/hooks/useLatestRef";
import {
  isExpectedLookupFailure,
  resolveMentionTargets,
} from "../../mention-targets";
import {
  addShownTargets,
  createMentionTargetBatcher,
  createShownMentionTargets,
} from "./utils";

export type MentionTargetLookup = Omit<MentionTargets, "viewerLogin">;

/** The repo's mention lookup: what GitHub showed the viewer so far, and how to ask for more. */
export function useMentionTargetLookup(repoId: string): MentionTargetLookup {
  const [shown, setShown] = useState(() => createShownMentionTargets(repoId));
  // An older repo's answer landing after a switch must not replace the new set.
  const liveRepoId = useLatestRef(repoId);
  // One batcher per repo: its asked set is what keeps a target from being asked twice.
  const batcher = useMemo(
    () =>
      createMentionTargetBatcher({
        resolve: (targets) => resolveMentionTargets(repoId, targets),
        onFound: (found) => {
          if (liveRepoId.current !== repoId) {
            return;
          }
          setShown((previous) => addShownTargets(previous, repoId, found));
        },
        onFailed: (error) => {
          if (!isExpectedLookupFailure(error)) {
            console.error("mention lookup failed", error);
          }
        },
      }),
    [liveRepoId, repoId],
  );

  const targets = shown.repoId === repoId ? shown.targets : undefined;
  const isTargetShown = useCallback(
    (target: string) => targets?.has(target.toLowerCase()) === true,
    [targets],
  );
  return useMemo(
    () => ({ isTargetShown, requestTarget: batcher.request }),
    [batcher, isTargetShown],
  );
}
