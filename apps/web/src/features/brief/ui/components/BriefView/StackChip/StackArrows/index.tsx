import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { IconButton } from "@web/components/IconButton";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import type { PrStack } from "../../../../../model/types";
import {
  NeighbourTargetKinds,
  StackDirections,
  type NeighbourTarget,
} from "../types";
import { resolveStackArrow, resolveStackNeighbours } from "../utils";
import styles from "./StackArrows.module.scss";

export interface StackArrowsProps {
  stack: PrStack;
  currentNumber: number;
  repoSlug: string;
  repoId: string | undefined;
  /** The stack chip the arrows flank. */
  children: ReactNode;
}

/**
 * Previous and next PR arrows either side of the stack chip, framed as one
 * stepper, for a linear stack only; a fork has no single neighbour, so the
 * chip stands alone.
 * Same link rule as the chip's rows: the app route when the repo is known,
 * GitHub in a new tab otherwise.
 */
export function StackArrows({
  stack,
  currentNumber,
  repoSlug,
  repoId,
  children,
}: StackArrowsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const neighbours = resolveStackNeighbours(stack, currentNumber);

  if (neighbours === undefined) {
    return children;
  }

  const previous = resolveStackArrow(
    t,
    StackDirections.PREVIOUS,
    neighbours.previous,
    repoId,
    repoSlug,
  );
  const next = resolveStackArrow(
    t,
    StackDirections.NEXT,
    neighbours.next,
    repoId,
    repoSlug,
  );
  const follow = (target: NeighbourTarget) => {
    if (target.kind === NeighbourTargetKinds.ROUTE) {
      void navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: target.params,
        search: target.search,
      });
      return;
    }
    if (target.kind === NeighbourTargetKinds.GITHUB) {
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <span
      aria-label={t("brief.header.stackNavigation")}
      className={styles["stackArrows"]}
      data-stack-stepper=""
      data-testid="stack-arrows"
      role="group"
    >
      <IconButton
        className={styles["arrow"]}
        data-testid="stack-previous"
        disabled={previous.disabled}
        label={previous.label}
        onClick={() => follow(previous.target)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.QUARTER}
          size={IconSizes.MD}
        />
      </IconButton>
      {children}
      <IconButton
        className={styles["arrow"]}
        data-testid="stack-next"
        disabled={next.disabled}
        label={next.label}
        onClick={() => follow(next.target)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.THREE_QUARTERS}
          size={IconSizes.MD}
        />
      </IconButton>
    </span>
  );
}
