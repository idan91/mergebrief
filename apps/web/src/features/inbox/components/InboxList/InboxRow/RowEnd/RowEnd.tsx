import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { InboxGeneration, InboxItem } from "../../../../types";
import CircleDashedIcon from "../../../icons/circle-dashed.svg?react";
import ClockIcon from "../../../icons/clock.svg?react";
import GitMergeIcon from "../../../icons/git-merge.svg?react";
import WarningIcon from "../../../icons/warning.svg?react";
import XCircleIcon from "../../../icons/x-circle.svg?react";
import styles from "./RowEnd.module.scss";
import { RowSignalKinds, type RowSignalKind } from "./types";
import { readGenerationSignal, readStatusSignal } from "./utils";

export interface RowEndProps {
  generation: InboxGeneration | null;
  state: InboxItem["state"];
  draft: boolean;
}

const ICONS: Readonly<Record<RowSignalKind, ReactNode>> = {
  [RowSignalKinds.QUEUED]: <ClockIcon />,
  [RowSignalKinds.RUNNING]: <span className={styles["spinner"]} />,
  [RowSignalKinds.FAILED]: <WarningIcon />,
  [RowSignalKinds.CAPPED]: <ClockIcon />,
  [RowSignalKinds.DRAFT]: <CircleDashedIcon />,
  [RowSignalKinds.MERGED]: <GitMergeIcon />,
  [RowSignalKinds.CLOSED]: <XCircleIcon />,
};

/**
 * The right edge: the generation state while a brief is on its way or
 * failed, and the status only when it is not Open. A column that repeats
 * one word on every row carries nothing. Hidden from assistive technology
 * and from the pointer: the row link names these states and takes the click.
 */
export function RowEnd({ generation, state, draft }: RowEndProps) {
  const { t } = useTranslation();
  const generationSignal = readGenerationSignal(generation);
  const status = readStatusSignal(state, draft);

  return (
    <span aria-hidden="true" className={styles["end"]}>
      {generationSignal === null ? null : (
        <span
          className={styles["generation"]}
          data-generation={generationSignal.kind}
        >
          {ICONS[generationSignal.kind]}
          <span className={styles["label"]}>{t(generationSignal.label)}</span>
        </span>
      )}
      {status === null ? null : (
        <span className={styles["status"]} data-status={status.kind}>
          {ICONS[status.kind]}
          <span className={styles["label"]}>{t(status.label)}</span>
        </span>
      )}
    </span>
  );
}
