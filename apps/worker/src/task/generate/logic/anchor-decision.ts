import type { PreviousBriefInput } from "brief-core";
import { FullRegenerations, type Anchor } from "generators";
import { AnchorStates, FreshRestartReasons } from "types/generations";
import type { ParsedGeneratePayload } from "../../payload";
import type { AnchorDecision, AnchorDecisionInputs } from "../types";
import {
  recoverCompleteBrief,
  recoverStoredBody,
  resolveChainGroupIds,
} from "../utils";
import { buildPreviousBriefInput } from "./anchored-run";

/**
 * Whether this run anchors on the previous brief, restarts fresh, or has
 * nothing to anchor on. Runs BEFORE the GENERATING phase mark; its two brief
 * reads and the one anchoring hop are the only side effects.
 */
export async function decideAnchor(
  payload: ParsedGeneratePayload,
  inputs: AnchorDecisionInputs,
): Promise<AnchorDecision> {
  const {
    store,
    source,
    fullRegeneration,
    generator,
    effort,
    prevBrief,
    priorBriefs,
    prevSpanFetch,
    baseSha,
    log,
  } = inputs;
  const { pullRequestId } = payload;

  const policy = fullRegeneration ?? FullRegenerations.NEVER;
  let anchor: Anchor = { state: AnchorStates.NONE };
  let previous: PreviousBriefInput | undefined;

  // The chain's used-id set rides ahead of the anchoring decision: even a
  // fresh restart keeps history reserved, or descent could resurrect a
  // retired id for an unrelated group.
  const prevRow =
    prevBrief === undefined
      ? undefined
      : await store.briefs.get(
          pullRequestId,
          prevBrief.baseSha,
          prevBrief.headSha,
        );
  const prevRead =
    prevRow === undefined ? undefined : recoverStoredBody(prevRow.body, log);
  const prevStored = prevRead?.ok ? prevRead.value : undefined;
  const previousRead =
    prevStored === undefined
      ? undefined
      : recoverCompleteBrief(prevStored, log);
  const previousBody = previousRead?.ok ? previousRead.value : undefined;

  // The chain reads off the NEWEST prior row, not `prevBrief`, that
  // lookup skips same-head rows, so after a base retarget (same head,
  // new base) it would drop the retargeted row's history for good.
  const chainSource = priorBriefs.at(-1);
  let chainRow = prevRow;
  let chainBody = prevStored;
  if (
    chainSource !== undefined &&
    (chainSource.headSha !== prevBrief?.headSha ||
      chainSource.baseSha !== prevBrief.baseSha)
  ) {
    chainRow = await store.briefs.get(
      pullRequestId,
      chainSource.baseSha,
      chainSource.headSha,
    );
    const chainRead =
      chainRow === undefined
        ? undefined
        : recoverStoredBody(chainRow.body, log);
    chainBody = chainRead?.ok ? chainRead.value : undefined;
  }
  const chainGroupIds = resolveChainGroupIds(chainRow, chainBody);

  if (prevBrief !== undefined && policy !== FullRegenerations.ALWAYS) {
    const current = generator.origin(effort ?? "medium");

    if (
      policy === FullRegenerations.ON_MODEL_SWAP &&
      prevRow !== undefined &&
      (prevRow.provider !== current.provider || prevRow.model !== current.model)
    ) {
      anchor = {
        state: AnchorStates.FRESH_RESTART,
        reason: FreshRestartReasons.MODEL_SWAP,
      };
      log.info(
        `generate: fresh restart — model swapped (${prevRow.provider}/${prevRow.model} → ${current.provider}/${current.model})`,
      );
    } else if (previousBody !== undefined) {
      previous = await buildPreviousBriefInput(payload, {
        store,
        source,
        prevBrief,
        previousBrief: previousBody,
        chainGroupIds,
        prevSpanFetch,
        baseSha,
        log,
      });
      anchor = { state: AnchorStates.ANCHORED };
    }
  }

  return { anchor, previous, chainGroupIds };
}
