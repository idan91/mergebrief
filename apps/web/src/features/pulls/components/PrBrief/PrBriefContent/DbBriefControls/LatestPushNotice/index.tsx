import { Button } from "@web/components/Button";
import { Chip } from "@web/components/Chip";
import { handOffFocusOnRemoval } from "../../../../../utils/focus-hand-off";
import noticeStyles from "../revision-notices.module.scss";
import type { LatestPushAction } from "./types";
import styles from "./LatestPushNotice.module.scss";

export interface LatestPushNoticeProps {
  label: string;
  title: string;
  /** What happened to the latest push, where the chip alone would not say. */
  detail?: string | undefined;
  /** Absent for a viewer the route would refuse, and on a PR that is not open. */
  action?: LatestPushAction | undefined;
}

/**
 * The PR's latest push has no brief while an older one is on screen: it
 * failed, it waits for a collaborator's Generate, or it is generating. The
 * chip names the state, the detail says why, and the one run the viewer may
 * queue sits beside them; the notice leaves once that push's brief lands.
 */
export function LatestPushNotice({
  label,
  title,
  detail,
  action,
}: LatestPushNoticeProps) {
  return (
    <span className={noticeStyles["notice"]} data-testid="latest-push-notice">
      <Chip
        as="span"
        className={noticeStyles["chip"]}
        title={title}
        variant="fact"
      >
        {label}
      </Chip>
      {detail === undefined ? null : (
        <span className={styles["detail"]}>{detail}</span>
      )}
      {action === undefined ? null : (
        <Button
          ref={handOffFocusOnRemoval}
          loading={action.pending}
          size="sm"
          type="button"
          variant="secondary"
          onClick={action.onTrigger}
        >
          {action.label}
        </Button>
      )}
    </span>
  );
}
