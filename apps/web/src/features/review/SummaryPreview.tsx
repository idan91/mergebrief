import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Roles, type Brief } from "../brief/types";
import { buildBriefViewModel } from "../brief/viewModel";
import type { SessionSnapshot } from "./session";
import {
  commentLocation,
  riskDispositionCounts,
  riskEvidenceLabel,
  summarySignatureLine,
  type ReviewMode,
  type ReviewOutcome,
} from "./state";

interface SummaryPreviewProps {
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
  const flagIds = model.flags.map((flag) => flag.id);
  const counts = riskDispositionCounts(snapshot.dispositions, flagIds);
  const reviewedChunkIds = new Set(snapshot.reviewedChunkIds);
  const carrierChunks = brief.chunks.filter(
    (chunk) => chunk.role === Roles.Carrier,
  );
  const supportingChunks = brief.chunks.filter(
    (chunk) => chunk.role === Roles.Supporting,
  );
  const addressed = model.flags.filter(
    (flag) => snapshot.dispositions[flag.id]?.kind === "addressed",
  );
  const dismissed = model.flags.filter(
    (flag) => snapshot.dispositions[flag.id]?.kind === "dismissed",
  );
  const open = model.flags.filter(
    (flag) => (snapshot.dispositions[flag.id]?.kind ?? "open") === "open",
  );
  const title = mode === "author" ? "Self-review summary" : "Review Summary";

  return (
    <main className="summary-page">
      <section className="summary-shell">
        <div className="summary-kicker">Frozen preview · interview demo</div>
        <div className="summary-head">
          <div>
            <h1>{title}</h1>
            <p>
              Reviewed by @you · {brief.pr.repo} #{brief.pr.number} ·{" "}
              {brief.pr.sha.slice(0, 7)}
            </p>
          </div>
          <span className="summary-badge">Tool receipt, not an approval</span>
        </div>

        <section className="summary-card">
          <div className="summary-row">
            <span>Review outcome</span>
            <div className="outcome-pick">
              {(["comment", "approve", "request-changes"] as const).map(
                (outcome) => (
                  <button
                    className={
                      snapshot.reviewOutcome === outcome ? "active" : ""
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
          <div className="signature-line">
            {summarySignatureLine({
              reviewedChunks: reviewedChunkIds.size,
              addressedRisks: counts.addressed,
              dismissedRisks: counts.dismissed,
            })}
          </div>
        </section>

        <section className="summary-grid">
          <div className="summary-card">
            <h2>What the reviewer covered</h2>
            <dl className="summary-metrics">
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
            {snapshot.reviewComments.length === 0 ? (
              <p className="summary-empty">
                No draft comments in this preview.
              </p>
            ) : null}
            {snapshot.reviewComments.map((comment) => (
              <div className="summary-comment" key={comment.id}>
                <span>{commentLocation(comment)}</span>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {comment.body.split("\n")[0] ?? ""}
                </ReactMarkdown>
              </div>
            ))}
          </div>

          <div className="summary-card">
            <h2>Risk surface disposition</h2>
            <RiskList
              title="Addressed risks"
              flags={addressed}
              renderDetail={(flag) => {
                const disposition = snapshot.dispositions[flag.id];
                return disposition?.kind === "addressed" && disposition.evidence
                  ? riskEvidenceLabel(
                      disposition.evidence,
                      snapshot.reviewComments,
                      brief.chunks,
                    )
                  : "no evidence linked";
              }}
            />
            <RiskList
              title="Dismissed risks"
              flags={dismissed}
              renderDetail={(flag) => {
                const disposition = snapshot.dispositions[flag.id];
                return disposition?.kind === "dismissed"
                  ? disposition.reason
                  : "";
              }}
            />
            <RiskList
              title="Open risks at submit"
              flags={open}
              renderDetail={() => "not addressed, not dismissed"}
            />
          </div>
        </section>

        <section className="summary-card not-checked">
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

function reviewOutcomeLabel(outcome: ReviewOutcome): string {
  if (outcome === "request-changes") return "Request changes";
  if (outcome === "approve") return "Approve";
  return "Comment";
}

function RiskList({
  title,
  flags,
  renderDetail,
}: {
  title: string;
  flags: ReturnType<typeof buildBriefViewModel>["flags"];
  renderDetail: (
    flag: ReturnType<typeof buildBriefViewModel>["flags"][number],
  ) => string;
}) {
  return (
    <div className="summary-risk-list">
      <h3>{title}</h3>
      {flags.length === 0 ? <p className="summary-empty">None.</p> : null}
      {flags.map((flag) => (
        <div className="summary-risk" key={flag.id}>
          <span>
            {flag.attr} · {flag.file}
          </span>
          <small>{renderDetail(flag)}</small>
        </div>
      ))}
    </div>
  );
}
