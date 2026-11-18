import type { Result } from "types/utils";
import type { ContextReadFailure } from "../types";

export type ReadResult<Value> = Result<Value, ContextReadFailure>;

export function failRead(
  reason: ContextReadFailure["reason"],
  detail: string,
): ReadResult<never> {
  return { ok: false, error: { reason, detail } };
}
