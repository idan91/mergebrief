import type { DiffLine } from "@web/utils/diffTokens/types";
import { useQuery } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { DiffRows } from "@web/components/DiffRows";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { DiffTimeoutNotice, useDiffRetryLanding } from "@web/features/brief";
import { useSnippetTokens } from "@web/hooks/useSnippetTokens";
import { TokenPlanProvider, useTokenPlan } from "@web/hooks/useTokenPlan";
import { ChunkTokenStatuses, TokenizeModes } from "@web/utils/diffTokens/types";
import type { BriefChunkSize } from "@web/utils/diffTokens/types";
import { buildSnippetKey } from "@web/utils/diffTokens/utils";
import {
  parseUnifiedDiffPatch,
  splitUnifiedDiffByFile,
} from "brief-core/chunk-layout";
import type { Span } from "../../../../utils/briefRouteState";
import { buildPrDiffQueryOptions } from "../../../../queries";
import styles from "./LiveDiffPreview.module.scss";

export interface LiveDiffPreviewProps {
  repoId: string;
  prNumber: number;
  span: Span;
}

interface FileRows {
  readonly file: string;
  readonly rows: DiffLine[];
}

/** Read-only whole-PR diff for the wait screen. */
export function LiveDiffPreview({
  repoId,
  prNumber,
  span,
}: LiveDiffPreviewProps) {
  const { t } = useTranslation();
  const diff = useQuery(
    buildPrDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  const diffRef = useRef<HTMLDivElement>(null);
  const unavailableRef = useRef<HTMLParagraphElement>(null);
  const landing = useDiffRetryLanding(
    diff,
    () => diffRef.current ?? unavailableRef.current,
  );
  const files: FileRows[] = useMemo(() => {
    if (diff.data === undefined) {
      return [];
    }
    return [...splitUnifiedDiffByFile(diff.data)].map(([file, patch]) => ({
      file,
      rows: parseUnifiedDiffPatch(patch),
    }));
  }, [diff.data]);

  const chunkSizes = useMemo(() => deriveFileSizes(files), [files]);
  const previewKey = `pr-diff:${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  const [openByFile, setOpenByFile] = useState<OpenByFile>(NOTHING_TOGGLED);
  const openByDefault = files.length <= OPEN_BY_DEFAULT_LIMIT;
  const toggleFile = useCallback((file: string, open: boolean) => {
    setOpenByFile((current) => ({ ...current, [file]: open }));
  }, []);

  let body: ReactNode;
  if (diff.isPending) {
    body = <p className={styles["note"]}>{t("pulls.wait.diffLoading")}</p>;
  } else if (landing.retry !== undefined) {
    body = <DiffTimeoutNotice retry={landing.retry} />;
  } else if (diff.isError || files.length === 0) {
    body = (
      <p className={styles["note"]} ref={unavailableRef} tabIndex={-1}>
        {t("pulls.wait.diffUnavailable")}
      </p>
    );
  } else {
    body = (
      <TokenPlanProvider briefKey={previewKey} chunkSizes={chunkSizes}>
        <div className={styles["diff"]} ref={diffRef} tabIndex={-1}>
          {files.map(({ file, rows }) => (
            <FileDisclosure
              file={file}
              key={file}
              onToggle={toggleFile}
              open={readOpen(openByFile, file, openByDefault)}
              rows={rows}
            />
          ))}
        </div>
      </TokenPlanProvider>
    );
  }

  return (
    <>
      {body}
      <p className="sr-only" role="status">
        {landing.announcement}
      </p>
    </>
  );
}

interface FileDisclosureProps {
  file: string;
  rows: DiffLine[];
  open: boolean;
  onToggle: (file: string, open: boolean) => void;
}

/**
 * The disclosure owns whether its file is open, because a collapsed file must
 * not pay for tokens: a wide PR would otherwise post one request per file at
 * first paint for content nobody has looked at.
 */
// Memoized so one toggle re-renders one file, not every table in the PR.
const FileDisclosure = memo(function FileDisclosure({
  file,
  rows,
  open,
  onToggle,
}: FileDisclosureProps) {
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    onToggle(file, event.currentTarget.open);
  };

  return (
    <details className={styles["diffFile"]} onToggle={handleToggle} open={open}>
      <summary>{file}</summary>
      <FileDiffTable file={file} open={open} rows={rows} />
    </details>
  );
});

interface FileDiffTableProps {
  file: string;
  rows: DiffLine[];
  open: boolean;
}

function FileDiffTable({ file, rows, open }: FileDiffTableProps) {
  const snippetKey = useMemo(() => buildSnippetKey(file, rows), [file, rows]);
  const { t } = useTranslation();
  const plan = useTokenPlan();
  const tokens = useSnippetTokens({
    briefKey: plan.briefKey,
    snippetKey,
    filePath: file,
    rows,
    admitted: plan.admitted,
    // Whole-PR rows arrive as a real unified diff, hunk headers included.
    mode: TokenizeModes.HUNK,
    enabled: open,
  });
  const tokensByRow =
    tokens.status === ChunkTokenStatuses.READY ? tokens.tokensByRow : undefined;

  return (
    <table className={styles["diffTable"]}>
      <ScreenReaderOnly as="caption">
        {t("brief.diff.caption", { file })}
      </ScreenReaderOnly>
      <ScreenReaderOnly as="thead">
        <tr>
          <th scope="col">{t("brief.diff.colOld")}</th>
          <th scope="col">{t("brief.diff.colNew")}</th>
          <th scope="col">{t("brief.diff.colContent")}</th>
        </tr>
      </ScreenReaderOnly>
      <DiffRows
        rows={rows}
        tokensByRow={tokensByRow}
        tokensPending={tokens.status === ChunkTokenStatuses.PENDING}
      />
    </table>
  );
}

type OpenByFile = Readonly<Record<string, boolean>>;

const NOTHING_TOGGLED: OpenByFile = {};
const OPEN_BY_DEFAULT_LIMIT = 5;

function deriveFileSizes(files: readonly FileRows[]): BriefChunkSize[] {
  return files.map(({ file, rows }) => ({ file, rowCount: rows.length }));
}

function readOpen(
  openByFile: Readonly<Record<string, boolean>>,
  file: string,
  fallback: boolean,
): boolean {
  return Object.hasOwn(openByFile, file) ? openByFile[file] === true : fallback;
}
