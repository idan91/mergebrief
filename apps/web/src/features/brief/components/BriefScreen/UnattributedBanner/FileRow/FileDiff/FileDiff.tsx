import { useTranslation } from "react-i18next";

import type { ChunkComparisonView } from "../../../../../comparison/comparison";
import type { UnattributedFileView } from "../../../../../utils/viewModel";
import { DiffTable } from "../../../DiffTable/DiffTable";
import { toDisplayChunk } from "../../utils";
import styles from "./FileDiff.module.scss";

export interface FileDiffProps {
  file: UnattributedFileView;
}

// A read-only table paints no overlay, so this never mutates — hoisted so
// every file's table shares one identity.
const EMPTY_COMPARISON_VIEW: ChunkComparisonView = {
  marks: new Map(),
  runs: [],
  runByRow: new Map(),
};

/**
 * An unattributed file's diff rows, read-only: the rows belong to no chunk,
 * so every comment affordance is stood down (same posture as the raw span
 * diff). Degrades to a note when rows are unavailable.
 */
export function FileDiff({ file }: FileDiffProps) {
  const { t } = useTranslation();

  if (file.diff === undefined || file.diff.length === 0) {
    return (
      <p className={styles["noDiff"]} role="status">
        {t("brief.unattributed.noDiff")}
      </p>
    );
  }

  return (
    <div className={styles["fileDiff"]}>
      <DiffTable
        addressedComments={[]}
        chunk={toDisplayChunk(file)}
        comparisonSkipReason={null}
        comparisonSource={{ kind: "last-review", delta: null }}
        comparisonView={EMPTY_COMPARISON_VIEW}
        readOnlyReason={t("brief.unattributed.readOnlyReason")}
        reviewCommentLabel=""
      />
    </div>
  );
}
