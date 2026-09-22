import { useTranslation } from "react-i18next";

import { GenerationStatuses, PrStates } from "@web/features/pulls/types";
import type { InboxGeneration, InboxItem } from "../../../../types";
import CircleDashedIcon from "../../../icons/circle-dashed.svg?react";
import ClockIcon from "../../../icons/clock.svg?react";
import GitMergeIcon from "../../../icons/git-merge.svg?react";
import WarningIcon from "../../../icons/warning.svg?react";
import XCircleIcon from "../../../icons/x-circle.svg?react";
import styles from "./RowEnd.module.scss";
import { RowSignalKinds, type RowSignalKind } from "./types";

export interface RowEndProps {
  generation: InboxGeneration | null;
  state: InboxItem["state"];
  draft: boolean;
}

/**
 * The right edge: the generation state while a brief is on its way or
 * failed, and the status only when it is not Open. A column that repeats
 * one word on every row carries nothing.
 */
export function RowEnd({ generation, state, draft }: RowEndProps) {
  const { t } = useTranslation();
  const generationView = describeGeneration(generation);
  const status = describeStatus(state, draft);

  return (
    <span className={styles["end"]}>
      {generationView === null ? null : (
        <span
          className={styles["generation"]}
          data-generation={generationView.kind}
        >
          {generationView.kind === RowSignalKinds.RUNNING ? (
            <span aria-hidden="true" className={styles["spinner"]} />
          ) : (
            generationView.icon
          )}
          <span className={styles["label"]}>{t(generationView.label)}</span>
        </span>
      )}
      {status === null ? null : (
        <span className={styles["status"]} data-status={status.kind}>
          {status.icon}
          <span className={styles["label"]}>{t(status.label)}</span>
        </span>
      )}
    </span>
  );
}

interface EndSignal {
  readonly kind: RowSignalKind;
  readonly icon: React.ReactNode;
  readonly label:
    | "home.inbox.generation.queued"
    | "home.inbox.generation.generating"
    | "home.inbox.generation.failed"
    | "home.inbox.generation.capped"
    | "home.inbox.status.draft"
    | "home.inbox.status.merged"
    | "home.inbox.status.closed";
}

function describeGeneration(
  generation: InboxGeneration | null,
): EndSignal | null {
  switch (generation?.status) {
    case GenerationStatuses.PENDING:
      return {
        kind: RowSignalKinds.QUEUED,
        icon: <ClockIcon aria-hidden="true" />,
        label: "home.inbox.generation.queued",
      };
    case GenerationStatuses.RUNNING:
      return {
        kind: RowSignalKinds.RUNNING,
        icon: null,
        label: "home.inbox.generation.generating",
      };
    case GenerationStatuses.FAILED:
      return {
        kind: RowSignalKinds.FAILED,
        icon: <WarningIcon aria-hidden="true" />,
        label: "home.inbox.generation.failed",
      };
    case GenerationStatuses.CAPPED:
      return {
        kind: RowSignalKinds.CAPPED,
        icon: <ClockIcon aria-hidden="true" />,
        label: "home.inbox.generation.capped",
      };
    default:
      return null;
  }
}

function describeStatus(
  state: InboxItem["state"],
  draft: boolean,
): EndSignal | null {
  if (state === PrStates.MERGED) {
    return {
      kind: RowSignalKinds.MERGED,
      icon: <GitMergeIcon aria-hidden="true" />,
      label: "home.inbox.status.merged",
    };
  }
  if (state === PrStates.CLOSED) {
    return {
      kind: RowSignalKinds.CLOSED,
      icon: <XCircleIcon aria-hidden="true" />,
      label: "home.inbox.status.closed",
    };
  }
  if (draft) {
    return {
      kind: RowSignalKinds.DRAFT,
      icon: <CircleDashedIcon aria-hidden="true" />,
      label: "home.inbox.status.draft",
    };
  }
  return null;
}
