import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DiffRows } from "@web/components/DiffRows";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { useSnippetTokens } from "@web/hooks/useSnippetTokens";
import { useTokenPlan } from "@web/hooks/useTokenPlan";
import { DiffLineKinds } from "types/diff-lines";
import {
  ChunkTokenStatuses,
  TokenizeModes,
  type DiffLine,
  type TokenizeMode,
} from "@web/utils/diffTokens/types";
import { buildSnippetKey } from "@web/utils/diffTokens/utils";
import type { SuggestionDiffRow } from "../utils";
import styles from "./SuggestionCard.module.scss";

export interface SuggestionCardProps {
  rows: SuggestionDiffRow[];
  /** The file the comment sits on; the snippet's language follows it. */
  filePath?: string | undefined;
  /** Anchored del plus add rows reconstruct; an addition-only block is one text. */
  mode?: TokenizeMode | undefined;
}

const NO_FILE = "";

/**
 * Anchored consumers pass del+add rows with line numbers; anchor-less
 * consumers pass addition-only rows and the number columns collapse.
 */
export function SuggestionCard({
  rows,
  filePath = NO_FILE,
  mode,
}: SuggestionCardProps) {
  const { t } = useTranslation();
  const plan = useTokenPlan();
  // Rows carrying both sides are a hunk whatever the caller said: joining
  // them into one text colours the removed and added lines as one file.
  const tokenizeMode = mode ?? resolveTokenizeMode(rows);
  const snippetKey = useMemo(
    () => buildSnippetKey(filePath, rows),
    [filePath, rows],
  );
  const tokens = useSnippetTokens({
    briefKey: plan.briefKey,
    snippetKey,
    filePath,
    rows,
    admitted: plan.admitted,
    mode: tokenizeMode,
  });
  const withNumbers = rows.some(
    (row) => row.oldLine !== undefined || row.newLine !== undefined,
  );
  const tokensByRow =
    tokens.status === ChunkTokenStatuses.READY ? tokens.tokensByRow : undefined;

  return (
    <div className={styles["suggestionCard"]}>
      <div className={styles["suggestionTitle"]}>
        {t("shell.suggestedChange")}
      </div>
      <div className={styles["suggestionScroll"]}>
        <table className={styles["suggestionDiff"]}>
          <ScreenReaderOnly as="caption">
            {t("brief.diff.captionSuggestion")}
          </ScreenReaderOnly>
          {withNumbers ? (
            <colgroup>
              <col className={styles["lineCol"]} />
              <col className={styles["lineCol"]} />
              <col />
            </colgroup>
          ) : null}
          <DiffRows
            lineNumbers={withNumbers}
            rows={rows}
            tokensByRow={tokensByRow}
            tokensPending={tokens.status === ChunkTokenStatuses.PENDING}
          />
        </table>
      </div>
    </div>
  );
}

/** Both sides present means a hunk; one side alone is a standalone snippet. */
function resolveTokenizeMode(rows: readonly DiffLine[]): TokenizeMode {
  const hasDeletes = rows.some((row) => row.kind === DiffLineKinds.DEL);
  const hasAdds = rows.some((row) => row.kind === DiffLineKinds.ADD);

  return hasDeletes && hasAdds ? TokenizeModes.HUNK : TokenizeModes.STANDALONE;
}
