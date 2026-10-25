// The wait surface for the DB-brief route. Announced via the polite live
// region the body owns; presentational.
import { WaitReasons, type WaitReason } from "contract";
import { useTranslation } from "react-i18next";
import { EmptyBlock } from "@web/components/EmptyBlock";
import type { Span } from "../../../utils/briefRouteState";
import type { RerunNoteInput } from "../failed-head";
import { waitLabel } from "../waiting-head";
import { LiveDiffPreview } from "./LiveDiffPreview";
import { selectWaitDetail } from "./utils";

export interface WaitCardProps {
  status: "pending" | "running";
  phase: string | undefined;
  /** Known span → diff-first wait; unknown (first brief) → phase-only. */
  span: Span | undefined;
  repoId: string;
  prNumber: number;
  /**
   * Draft-damping notice (own-draft only): replaces the pending heading, whose
   * "shortly" is wrong while the configured window runs.
   */
  pendingNotice?: string | undefined;
  /** Why a pending generation has not started; absent shows the generic line. */
  waitReason?: WaitReason | undefined;
  /** The row and PR facts that name how a stalled head runs again. */
  rerun: RerunNoteInput;
}

export function WaitCard({
  status,
  phase,
  span,
  repoId,
  prNumber,
  pendingNotice,
  waitReason,
  rerun,
}: WaitCardProps) {
  const { t } = useTranslation();
  const heading = waitLabel(t, { status, phase, waitReason, pendingNotice });
  const stalled = status === "pending" && waitReason === WaitReasons.STALLED;
  const detail = selectWaitDetail(t, { span, stalled, rerun });

  return (
    <section aria-labelledby="wait-heading">
      <EmptyBlock
        busy={!stalled}
        detail={detail}
        heading={<h1 id="wait-heading">{heading}</h1>}
      >
        {span === undefined ? undefined : (
          <LiveDiffPreview prNumber={prNumber} repoId={repoId} span={span} />
        )}
      </EmptyBlock>
    </section>
  );
}
