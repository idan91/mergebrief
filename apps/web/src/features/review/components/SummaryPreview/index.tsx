import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Roles, type Brief } from "@web/features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  buildReceipt,
  RECEIPT_NOT_CHECKED_KEYS,
  receiptCommentLabel,
  receiptRiskGroups,
  type ReceiptRiskRow,
} from "../../utils/receipt";
import type { SessionSnapshot } from "../../session";
import { reviewOutcomeLabel, summarySignatureLine } from "../../utils/state";
import styles from "./SummaryPreview.module.scss";

export interface SummaryPreviewProps {
  brief: Brief;
  snapshot: SessionSnapshot;
}

export function SummaryPreview({ brief, snapshot }: SummaryPreviewProps) {
  const { t } = useTranslation();
  const model = buildBriefViewModel(brief);
  const receipt = buildReceipt(t, snapshot, brief, model);
  const reviewedChunkIds = new Set(snapshot.reviewedChunkIds);
  const coreChunks = brief.chunks.filter((chunk) => chunk.role === Roles.CORE);
  const supportingChunks = brief.chunks.filter(
    (chunk) => chunk.role === Roles.SUPPORTING,
  );

  return (
    <main className={styles["page"]} id="main-content" tabIndex={-1}>
      <section className={styles["shell"]}>
        <div className={styles["kicker"]}>{t("review.summary.kicker")}</div>
        <div className={styles["head"]}>
          <div>
            <h1>{t("review.summary.heading")}</h1>
            <p>
              {t("review.summary.byline", {
                repo: brief.pr.repo,
                number: brief.pr.number,
                sha: brief.pr.sha.slice(0, 7),
              })}
            </p>
          </div>
          <span className={styles["badge"]}>{t("review.summary.badge")}</span>
        </div>

        <section className={styles["card"]}>
          {/* Read-only document: the verdict is chosen in the submit modal;
              this surface only reflects it. */}
          <div className={styles["row"]}>
            <span>{t("review.summary.outcomeLabel")}</span>
            <span className={styles["outcomeValue"]}>
              {reviewOutcomeLabel(t, snapshot.reviewOutcome)}
            </span>
          </div>
          <div className={styles["signature"]}>
            {summarySignatureLine(t, {
              reviewedChunks: reviewedChunkIds.size,
              addressedRisks: receipt.counts.addressed,
              dismissedRisks: receipt.counts.dismissed,
            })}
          </div>
        </section>

        <section className={styles["grid"]}>
          <div className={styles["card"]}>
            <h2>{t("review.summary.coveredHeading")}</h2>
            <dl className={styles["metrics"]}>
              <div>
                <dt>{t("review.summary.chunksReviewed")}</dt>
                <dd>
                  {reviewedChunkIds.size}/{receipt.progress.chunkTotal}
                </dd>
              </div>
              <div>
                <dt>{t("review.summary.coreChunks")}</dt>
                <dd>
                  {
                    coreChunks.filter((chunk) => reviewedChunkIds.has(chunk.id))
                      .length
                  }
                  /{coreChunks.length}
                </dd>
              </div>
              <div>
                <dt>{t("review.summary.supportingChunks")}</dt>
                <dd>
                  {
                    supportingChunks.filter((chunk) =>
                      reviewedChunkIds.has(chunk.id),
                    ).length
                  }
                  /{supportingChunks.length}
                </dd>
              </div>
            </dl>
            <h3>{t("review.summary.inlineComments")}</h3>
            {receipt.comments.length === 0 ? (
              <p className={styles["empty"]}>
                {t("review.summary.noComments")}
              </p>
            ) : null}
            {receipt.comments.map((comment) => (
              <div className={styles["comment"]} key={comment.id}>
                <span>{receiptCommentLabel(comment)}</span>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {comment.firstLine}
                </ReactMarkdown>
              </div>
            ))}
          </div>

          <div className={styles["card"]}>
            <h2>{t("review.summary.dispositionHeading")}</h2>
            {receiptRiskGroups(t, receipt).map((group) => (
              <RiskList
                items={group.items}
                key={group.key}
                title={group.title}
              />
            ))}
          </div>
        </section>

        <section className={`${styles["card"]} ${styles["notChecked"]}`}>
          <h2>{t("review.summary.notCheckedHeading")}</h2>
          {RECEIPT_NOT_CHECKED_KEYS.map((key) => (
            <span key={key}>{t(key)}</span>
          ))}
        </section>
      </section>
    </main>
  );
}

interface RiskListProps {
  title: string;
  items: ReceiptRiskRow[];
}

function RiskList({ title, items }: RiskListProps) {
  const { t } = useTranslation();
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className={styles["empty"]}>{t("review.summary.none")}</p>
      ) : null}
      {items.map((item) => (
        <div className={styles["risk"]} key={item.id}>
          <span>
            {item.attr} · {item.file}
          </span>
          <small>{item.detail}</small>
        </div>
      ))}
    </div>
  );
}
