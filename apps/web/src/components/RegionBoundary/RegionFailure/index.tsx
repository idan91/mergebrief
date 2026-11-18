import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { FailureBlock } from "../../FailureBlock";
import { FailureBlockScales } from "../../FailureBlock/types";
import { FailureClassContext, FailureHeadingContext } from "../context";

export interface RegionFailureProps {
  reset: () => void;
}

// Its copy reads nothing off the error: a message can carry a request path.
export function RegionFailure({ reset }: RegionFailureProps) {
  const { t } = useTranslation();
  const heading = useContext(FailureHeadingContext);
  const className = useContext(FailureClassContext);

  return (
    <div className={className}>
      <FailureBlock
        detail={t("shell.regionFailed.detail")}
        heading={heading}
        retryLabel={t("shell.regionFailed.retry")}
        scale={FailureBlockScales.REGION}
        onRetry={reset}
      />
    </div>
  );
}
