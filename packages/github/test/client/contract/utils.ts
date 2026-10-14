import { expect } from "vitest";
import { DENIAL_CODES, type DenialOutcome } from "./consts";
import { ContractOutcomes, type ContractCase } from "./types";

export function shapeDenialAnswer<Client>(
  testCase: ContractCase<Client>,
  outcome: DenialOutcome,
): unknown {
  const folds =
    outcome === ContractOutcomes.NOT_FOUND && "notFound" in testCase;
  if (folds) {
    return { ok: true, value: testCase.notFound };
  }
  return {
    ok: false,
    error: expect.objectContaining({ code: DENIAL_CODES[outcome] }),
  };
}
