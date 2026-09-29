import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useSnippetTokens } from "@web/hooks/useSnippetTokens";
import { useTokenPlan } from "@web/hooks/useTokenPlan";
import {
  ChunkTokenStatuses,
  type TokenizeMode,
} from "@web/utils/diffTokens/types";
import { buildSnippetKey } from "@web/utils/diffTokens/utils";

import type { ChunkComparisonView } from "../../../../comparison/runs";
import { useFileRows } from "../../../../hooks/useFileRows";
import type { AddressedReviewComment, BriefChunk } from "../../../../types";
import type {
  GuestRowOrigin,
  GuestRowsInput,
} from "../../../../utils/guest-rows";
import { DiffTable } from "../../DiffTable";
import type { ChangesReviewWiring } from "../types";
import styles from "./GuestDiff.module.scss";
import type { GuestDiffVariant } from "./types";

export interface GuestDiffProps {
  /** The host chunk: an id no brief chunk uses, the file, and the guest rows. */
  chunk: BriefChunk;
  review: ChangesReviewWiring | undefined;
  variant: GuestDiffVariant;
  /** The owner row a guest row came from, when it came from the owner's diff. */
  originOf?: ((index: number) => GuestRowOrigin | undefined) | undefined;
  /** Requests syntax tokens for the rows in this mode; absent renders plain. */
  tokenizeMode?: TokenizeMode | undefined;
}

// A guest table paints no overlay, so this never mutates, hoisted so every
// table shares one identity.
const EMPTY_COMPARISON_VIEW: ChunkComparisonView = {
  marks: new Map(),
  runs: [],
  runByRow: new Map(),
};
const NO_ADDRESSED_COMMENTS: AddressedReviewComment[] = [];
const NO_ROWS: never[] = [];

/**
 * A `DiffTable` over rows another diff produced: every row resolves to the
 * full brief's chunk that owns its line, against the PR diff's rows for the
 * file, and the file's live threads sit at their lines. While the PR diff
 * is not loaded the rows say so instead of claiming the diff lacks them.
 */
export function GuestDiff({
  chunk,
  review,
  variant,
  originOf,
  tokenizeMode,
}: GuestDiffProps) {
  const { t } = useTranslation();
  const rows = chunk.diff ?? NO_ROWS;
  const cache = useFileRows();
  const diffLoaded = cache !== undefined && !cache.isEmpty;
  const fileRows = diffLoaded
    ? (cache.getFileRows(chunk.file) ?? NO_ROWS)
    : undefined;
  const owners = review?.lineOwnersByFile.get(chunk.file);
  // One identity per row set, or every drag re-render re-resolves the rows.
  const guest = useMemo<GuestRowsInput>(
    () => ({ file: chunk.file, fileRows, owners, originOf }),
    [chunk.file, fileRows, owners, originOf],
  );
  const plan = useTokenPlan();
  const snippetKey = useMemo(
    () => buildSnippetKey(chunk.file, rows),
    [chunk.file, rows],
  );
  const tokens = useSnippetTokens({
    briefKey: plan.briefKey,
    snippetKey,
    filePath: chunk.file,
    rows,
    admitted: plan.admitted,
    mode: tokenizeMode,
    enabled: tokenizeMode !== undefined,
  });
  const tokensByRow =
    tokens.status === ChunkTokenStatuses.READY ? tokens.tokensByRow : undefined;

  return (
    <div className={styles["guestDiff"]} data-variant={variant}>
      <DiffTable
        addressedComments={NO_ADDRESSED_COMMENTS}
        chunk={chunk}
        comparisonSkipReason={null}
        comparisonSource={{ kind: "last-review", delta: null }}
        comparisonView={EMPTY_COMPARISON_VIEW}
        conversationComposer={review?.conversationComposer}
        fileThreads={review?.lineThreadsByFile?.get(chunk.file)}
        guest={guest}
        reviewCommentLabel={t("brief.chunk.reviewComment")}
        tokensByRow={tokensByRow}
        tokensPending={tokens.status === ChunkTokenStatuses.PENDING}
      />
    </div>
  );
}
