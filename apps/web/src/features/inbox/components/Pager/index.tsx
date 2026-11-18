import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./Pager.module.scss";
import { PAGE_GAP, listPageSteps } from "./utils";

/** A page number, or a step from the page the URL holds when the write lands. */
export type PageStep = number | ((current: number) => number);

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: PageStep) => void;
}

/** Numbered 30px squares, the current one in the accent, and the range in words. */
export function Pager({ page, pageSize, total, onPage }: PagerProps) {
  const { t } = useTranslation();
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) {
    return null;
  }

  const first = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const steps = listPageSteps(page, last);
  const atFirst = page === 1;
  const atLast = page === last;

  function stepBack(): void {
    if (!atFirst) {
      onPage((current) => Math.max(1, current - 1));
    }
  }

  function stepForward(): void {
    if (!atLast) {
      onPage((current) => Math.min(last, current + 1));
    }
  }

  return (
    <nav aria-label={t("home.pager.ariaLabel")} className={styles["pager"]}>
      <span aria-live="polite" className={styles["range"]}>
        {t("home.pager.range", { first, last: end, total })}
      </span>
      <div className={styles["pages"]}>
        {/* oxlint-disable-next-line house/no-raw-button -- DESIGN.md's numbered 30px pager squares; no shared primitive has that shape */}
        <button
          aria-disabled={atFirst}
          aria-label={t("home.pager.previous")}
          className={styles["page"]}
          type="button"
          onClick={stepBack}
        >
          <Icon
            name={IconNames.CARET_DOWN}
            rotation={IconRotations.QUARTER}
            size={IconSizes.MD}
          />
        </button>
        {steps.map((step, position) =>
          step === PAGE_GAP ? (
            <span
              aria-hidden="true"
              className={styles["gap"]}
              key={`gap-${position}`}
            >
              …
            </span>
          ) : (
            // oxlint-disable-next-line house/no-raw-button -- DESIGN.md's numbered 30px pager squares
            <button
              aria-current={step === page ? "page" : undefined}
              aria-label={t("home.pager.page", { page: step })}
              className={styles["page"]}
              key={step}
              type="button"
              onClick={() => onPage(step)}
            >
              {step}
            </button>
          ),
        )}
        {/* oxlint-disable-next-line house/no-raw-button -- DESIGN.md's numbered 30px pager squares */}
        <button
          aria-disabled={atLast}
          aria-label={t("home.pager.next")}
          className={styles["page"]}
          type="button"
          onClick={stepForward}
        >
          <Icon
            name={IconNames.CARET_DOWN}
            rotation={IconRotations.THREE_QUARTERS}
            size={IconSizes.MD}
          />
        </button>
      </div>
    </nav>
  );
}
