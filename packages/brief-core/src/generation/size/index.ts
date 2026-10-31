import {
  BYTES_PER_TOKEN,
  SINGLE_CALL_MAX_HUNKS,
  SINGLE_CALL_MAX_INPUT_TOKENS,
} from "./consts";
import { CallPlanKinds, type CallPlan, type CallPlanInput } from "./types";

const HUNK_HEADER = "@@ ";
const LINE_HUNK_HEADER = `\n${HUNK_HEADER}`;

export function estimateTokens(text: string, bytesPerToken: number): number {
  return Math.round(Buffer.byteLength(text, "utf8") / bytesPerToken);
}

/** A changed or context line always carries a prefix, so only a hunk header
 * starts a line with `@@`. */
export function countHunks(diff: string): number {
  let count = diff.startsWith(HUNK_HEADER) ? 1 : 0;
  let from = diff.indexOf(LINE_HUNK_HEADER);
  while (from !== -1) {
    count++;
    from = diff.indexOf(LINE_HUNK_HEADER, from + LINE_HUNK_HEADER.length);
  }
  return count;
}

export function decideCallPlan(input: CallPlanInput): CallPlan {
  const estimatedInputTokens = estimateTokens(input.diff, BYTES_PER_TOKEN.DIFF);
  const hunkCount = countHunks(input.diff);
  const forced = input.forceMultiCall === true;

  const overInput = estimatedInputTokens > SINGLE_CALL_MAX_INPUT_TOKENS;
  const overHunks = hunkCount > SINGLE_CALL_MAX_HUNKS;
  const multiCall = forced || overInput || overHunks;

  return {
    kind: multiCall ? CallPlanKinds.MULTI : CallPlanKinds.SINGLE,
    estimatedInputTokens,
    hunkCount,
    forced,
  };
}
