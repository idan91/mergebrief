import { capForRepo } from "generators";
import { GenerationStatuses } from "persistence";
import { entryCommentCappedBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { utcDayBounds } from "../../spend";
import type { SpendGateInputs } from "../types";

/**
 * The daily generation cap. Runs BEFORE markRunning and any provider call so
 * a run never counts itself. Returns true when the run is capped: the
 * projection is terminal `capped` (or left `failed`) and the caller stops.
 */
export async function applySpendGate(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
): Promise<boolean> {
  const {
    deps,
    projection,
    target,
    prRow,
    repoSlug,
    entryCommentManager,
    log,
  } = inputs;
  const { headSha } = payload;

  // Gate model spend before markRunning so the current attempt cannot count itself.
  // Binding the GitHub source may precede this gate. Count attempts, not rows; capped jobs
  // are terminal skips with no retry or consumed attempt.
  const cap =
    deps.spend === undefined ? null : capForRepo(deps.spend, repoSlug);
  if (cap !== null) {
    const day = utcDayBounds(new Date());
    const started = await projection.countStartedRunsForRepo({
      repoId: prRow.repoId,
      from: day.from,
      to: day.to,
    });
    if (started >= cap) {
      log.warn("generate: daily generation cap reached — skipping this run", {
        evt: "spend.cap.trip",
        repo: repoSlug,
        cap,
        dayUtc: day.label,
      });
      if (
        entryCommentManager.getCurrentId() !== null &&
        payload.grantId === undefined
      ) {
        // UPDATE ONLY: a capped PR never gets an Entry comment created for it,
        // the cap must not make MergeBrief louder on a thread than it was.
        await entryCommentManager.refresh(
          entryCommentCappedBody({
            publicBaseUrl: deps.publicBaseUrl,
            repoId: prRow.repoId,
            prNumber: prRow.prNumber,
            headSha,
            resetsAt: day.to,
          }),
        );
      }
      // Do NOT overwrite a `failed` row: an at-cap graphile retry lands here
      // with the previous attempt's real failure recorded, and stamping
      // `capped` over it would erase why the job actually broke.
      const current = await projection.get(target);
      if (current?.status !== GenerationStatuses.FAILED) {
        await projection.markCapped(target);
      }
      return true;
    }
  }
  return false;
}
