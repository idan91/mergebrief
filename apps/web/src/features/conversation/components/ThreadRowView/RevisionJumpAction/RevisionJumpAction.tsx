import { useTranslation } from "react-i18next";
import { useId } from "react";

import { Button } from "@web/components/Button/Button";
import rowStyles from "../../../rows.module.scss";
import type { ConversationThread } from "../../../types";
import type { ThreadRevisionJump } from "../../../wiring";

const SHORT_SHA = 7;

export interface RevisionJumpActionProps {
  thread: ConversationThread;
  /** Absent when there is no timeline (inline renders, local path). */
  jump: ThreadRevisionJump | undefined;
}

/**
 * The outdated-thread revision jump, rendered only for an outdated thread that
 * carries an anchor commit with a timeline present. When the anchor was a
 * briefed head it navigates there; otherwise it stays focusable-disabled with
 * a reachable reason, and the sibling GitHub permalink is the fallback. No
 * nearest-revision guessing.
 */
export function RevisionJumpAction({ thread, jump }: RevisionJumpActionProps) {
  const { t } = useTranslation();
  const reasonId = `${useId()}-jump-reason`;
  if (
    !thread.isOutdated ||
    thread.anchorSha === undefined ||
    jump === undefined
  ) {
    return null;
  }
  const anchorSha = thread.anchorSha;
  const label = t("conversation.jumpToRevision", {
    sha: anchorSha.slice(0, SHORT_SHA),
  });
  if (jump.knownHeads.has(anchorSha)) {
    return (
      <Button
        variant="quiet"
        onClick={() => jump.onJump(anchorSha, thread.rootCommentId)}
      >
        {label}
      </Button>
    );
  }
  return (
    <>
      <Button aria-describedby={reasonId} disabled variant="quiet">
        {label}
      </Button>
      <span className={rowStyles["note"]} id={reasonId}>
        {t("conversation.revisionNeverBriefed")}
      </span>
    </>
  );
}
