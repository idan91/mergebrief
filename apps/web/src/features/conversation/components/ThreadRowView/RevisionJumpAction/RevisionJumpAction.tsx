import { useId } from "react";

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
  const reasonId = `${useId()}-jump-reason`;
  if (
    !thread.isOutdated ||
    thread.anchorSha === undefined ||
    jump === undefined
  ) {
    return null;
  }
  const anchorSha = thread.anchorSha;
  const label = `Jump to revision ${anchorSha.slice(0, SHORT_SHA)}`;
  if (jump.knownHeads.has(anchorSha)) {
    return (
      <button
        className={rowStyles["action"]}
        onClick={() => jump.onJump(anchorSha, thread.rootCommentId)}
        type="button"
      >
        {label}
      </button>
    );
  }
  return (
    <>
      <button
        aria-describedby={reasonId}
        aria-disabled="true"
        className={rowStyles["action"]}
        type="button"
      >
        {label}
      </button>
      <span className={rowStyles["note"]} id={reasonId}>
        This revision was never briefed — open it on GitHub.
      </span>
    </>
  );
}
