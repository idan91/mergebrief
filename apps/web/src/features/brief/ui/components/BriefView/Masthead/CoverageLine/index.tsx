import { LocalBriefKinds } from "contract";
import { Trans } from "react-i18next";

import type { Brief } from "../../../../../model/types";
import { SHORT_SHA_LENGTH } from "../../consts";
import styles from "./CoverageLine.module.scss";

export interface CoverageLineProps {
  brief: Brief;
}

/** The commit span a brief covers; a delta reads its span in its own context line. */
export function CoverageLine({ brief }: CoverageLineProps) {
  const range = brief.commitRange;
  const coversSpan =
    brief.artifactKind === LocalBriefKinds.BRIEF && range !== undefined;
  if (!coversSpan) {
    return null;
  }

  const base = range.base.slice(0, SHORT_SHA_LENGTH);
  const head = range.head.slice(0, SHORT_SHA_LENGTH);

  return (
    <p className={styles["coverage"]} data-testid="coverage-line">
      <Trans
        components={[
          <code key="base">{base}</code>,
          <code key="head">{head}</code>,
        ]}
        count={range.commitCount}
        i18nKey="brief.masthead.coverage"
      />
    </p>
  );
}
