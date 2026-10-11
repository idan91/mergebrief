import type { OperatorReads } from "../../../src/client/types";
import { REPO, requireOperatorToken } from "../helpers";
import { ContractOutcomes } from "./types";

export const HEAD_SHA = "b".repeat(40);
export const BASE_SHA = "a".repeat(40);
export const DIFF = "diff --git a/src/a.ts b/src/a.ts\n";
export const ATTACHMENT_COMMIT_SHA = `${"0".repeat(39)}1`;

export const REVIEWER_TOKEN = "ghu_reviewer";
export const RENEWED_TOKEN = "ghu_reviewer_renewed";

/** The gate passed pull request 7 of `REPO` at its base and head. */
export const OPERATOR_READS: OperatorReads = {
  token: requireOperatorToken("ghp_operator"),
  repo: REPO,
  prNumber: 7,
  loadKnownCommits: async () => new Set([BASE_SHA, HEAD_SHA]),
};

export type DenialOutcome =
  | typeof ContractOutcomes.NOT_FOUND
  | typeof ContractOutcomes.FORBIDDEN
  | typeof ContractOutcomes.UNAUTHORIZED;

export const DENIAL_CODES: Readonly<Record<DenialOutcome, string>> = {
  [ContractOutcomes.NOT_FOUND]: "not-found",
  [ContractOutcomes.FORBIDDEN]: "forbidden",
  [ContractOutcomes.UNAUTHORIZED]: "unauthorized",
};
