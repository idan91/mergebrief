import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Roles, type Brief } from "../../../brief/types";
import { buildBriefViewModel } from "../../../brief/viewModel";
import { buildReceipt, type Receipt } from "../../receipt";
import type { SessionSnapshot } from "../../session";
import {
  summarySignatureLine,
  type ReviewMode,
  type ReviewOutcome,
} from "../../state";
import styles from "./SummaryPreview.module.scss";

export interface SummaryPreviewProps {
  brief: Brief;
  snapshot: SessionSnapshot;
  mode?: ReviewMode;
  setOutcome?: (outcome: ReviewOutcome) => void;
}

export function SummaryPreview({
  brief,
  snapshot,
  mode = "reviewer",
  setOutcome,
}: SummaryPreviewProps) {
  const model = buildBriefViewModel(brief);
  const receipt = buildReceipt(snapshot, brief, model);
  const reviewedChunkIds = new Set(snapshot.reviewedChunkIds);
  const carrierChunks = brief.chunks.filter(
    (chunk) => chunk.role === Roles.Carrier,
  );
  const supportingChunks = brief.chunks.filter(
    (chunk) => chunk.role === Roles.Supporting,
  );
  const title = mode === "author" ? "Self-review summary" : "Review Summary";

  return (
    <main className={styles["page"]}>
      <section className={styles["shell"]}>
        <div className={styles["kicker"]}>Frozen preview · interview demo</div>
        <div className={styles["head"]}>
          <div>
            <h1>{title}</h1>
            <p>
              Reviewed by @you · {brief.pr.repo} #{brief.pr.number} ·{" "}
              {brief.pr.sha.slice(0, 7)}
            </p>
          </div>
          <span className={styles["badge"]}>Tool receipt, not an approval</span>
        </div>

        <section className={styles["card"]}>
          <div className={styles["row"]}>
            <span>Review outcome</span>
            <div className={styles["outcomePick"]}>
              {(["comment", "approve", "request-changes"] as const).map(
                (outcome) => (
                  <button
                    data-state={
                      snapshot.reviewOutcome === outcome ? "active" : undefined
                    }
                    disabled={!setOutcome}
                    key={outcome}
                    type="button"
                    onClick={() => setOutcome?.(outcome)}
                  >
                    {reviewOutcomeLabel(outcome)}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className={styles["signature"]}>
            {summarySignatureLine({
              reviewedChunks: reviewedChunkIds.size,
              addressedRisks: receipt.counts.addressed,
              dismissedRisks: receipt.counts.dismissed,
            })}
          </div>
        </section>

        <section className={styles["grid"]}>
          <div className={styles["card"]}>
            <h2>What the reviewer covered</h2>
            <dl className={styles["metrics"]}>
              <div>
                <dt>Chunks reviewed</dt>
                <dd>
                  {reviewedChunkIds.size}/{brief.chunks.length}
                </dd>
              </div>
              <div>
                <dt>Carrier chunks</dt>
                <dd>
                  {
                    carrierChunks.filter((chunk) =>
                      reviewedChunkIds.has(chunk.id),
                    ).length
                  }
                  /{carrierChunks.length}
                </dd>
              </div>
              <div>
                <dt>Supporting chunks</dt>
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
            <h3>Inline comments</h3>
            {receipt.comments.length === 0 ? (
              <p className={styles["empty"]}>
                No draft comments in this preview.
              </p>
            ) : null}
            {receipt.comments.map((comment) => (
              <div className={styles["comment"]} key={comment.id}>
                <span>{commentLabel(comment)}</span>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {comment.firstLine}
                </ReactMarkdown>
              </div>
            ))}
          </div>

          <div className={styles["card"]}>
            <h2>Risk surface disposition</h2>
            <RiskList
              title="Addressed risks"
              items={receipt.addressed.map((flag) => ({
                attr: flag.attr,
                file: flag.file,
                detail: flag.evidenceLabel ?? "no evidence linked",
              }))}
            />
            <RiskList
              title="Dismissed risks"
              items={receipt.dismissed.map((flag) => ({
                attr: flag.attr,
                file: flag.file,
                detail: flag.reason,
              }))}
            />
            <RiskList
              title="Open risks at submit"
              items={receipt.open.map((flag) => ({
                attr: flag.attr,
                file: flag.file,
                detail: "not addressed, not dismissed",
              }))}
            />
          </div>
        </section>

        <section className={`${styles["card"]} ${styles["notChecked"]}`}>
          <h2>Not checked</h2>
          <span>business intent</span>
          <span>runtime behavior</span>
          <span>performance under load</span>
          <span>downstream integration</span>
          <span>general bug finding</span>
        </section>
      </section>
    </main>
  );
}

function commentLabel(comment: Receipt["comments"][number]): string {
  const sign = comment.side === "new" ? "+" : "-";
  const range =
    comment.startLine === comment.endLine
      ? `${sign}${comment.startLine}`
      : `${sign}${comment.startLine}-${comment.endLine}`;
  return `${comment.file}:${range}`;
}

function reviewOutcomeLabel(outcome: ReviewOutcome): string {
  if (outcome === "request-changes") return "Request changes";
  if (outcome === "approve") return "Approve";
  return "Comment";
}

interface RiskListItem {
  attr: string;
  file: string;
  detail: string;
}

interface RiskListProps {
  title: string;
  items: RiskListItem[];
}

function RiskList({ title, items }: RiskListProps) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? <p className={styles["empty"]}>None.</p> : null}
      {items.map((item) => (
        <div className={styles["risk"]} key={`${item.attr}:${item.file}`}>
          <span>
            {item.attr} · {item.file}
          </span>
          <small>{item.detail}</small>
        </div>
      ))}
    </div>
  );
}
