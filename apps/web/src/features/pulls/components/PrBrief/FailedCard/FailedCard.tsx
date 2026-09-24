import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock/EmptyBlock";
import type { GenerationFailureCode } from "../../../types";
import { failureLine } from "./utils";

export interface FailedCardProps {
  /** Null when the code is absent or one this bundle doesn't know. */
  errorCode: GenerationFailureCode | null;
  /** Sanitized detail for the two codes that carry one. */
  errorDetail: string | null;
  attempts: number;
}

export function FailedCard({
  errorCode,
  errorDetail,
  attempts,
}: FailedCardProps) {
  const { t } = useTranslation();
  const attemptsLine = t("pulls.failed.attempts", { count: attempts + 1 });
  const note = `${attemptsLine} ${t("pulls.failed.requeueNote")}`;

  return (
    <section aria-labelledby="failed-heading">
      <EmptyBlock
        detail={failureLine(t, errorCode, errorDetail)}
        heading={<h1 id="failed-heading">{t("pulls.failed.heading")}</h1>}
        note={note}
      />
    </section>
  );
}
