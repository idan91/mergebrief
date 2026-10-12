import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { InboxGeneration, InboxItem } from "../../../../types";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import styles from "./RowEnd.module.scss";
import { RowSignalKinds, type RowSignalKind } from "./types";
import { readGenerationSignal, readStatusSignal } from "./utils";

export interface RowEndProps {
  generation: InboxGeneration | undefined;
  state: InboxItem["state"];
  draft: boolean;
}

const ICONS: Readonly<Record<RowSignalKind, ReactNode>> = {
  [RowSignalKinds.QUEUED]: <Icon name={IconNames.CLOCK} />,
  [RowSignalKinds.RUNNING]: <span className={styles["spinner"]} />,
  [RowSignalKinds.FAILED]: <Icon name={IconNames.WARNING} />,
  [RowSignalKinds.CAPPED]: <Icon name={IconNames.CLOCK} />,
  [RowSignalKinds.DRAFT]: <Icon name={IconNames.CIRCLE_DASHED} />,
  [RowSignalKinds.MERGED]: <Icon name={IconNames.GIT_MERGE} />,
  [RowSignalKinds.CLOSED]: <Icon name={IconNames.X_CIRCLE} />,
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
