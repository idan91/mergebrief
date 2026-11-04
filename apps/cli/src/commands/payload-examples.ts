// The `-F` payloads `--help` shows. `satisfies` holds each to its wire type, so
// an example that drifts from the contract stops the build.
import type {
  AddressRiskBody,
  CreateDraftCommentBody,
  DismissRiskBody,
  ReanchorDraftCommentBody,
  ReopenRiskBody,
  SubmitReviewBody,
  UpdateDraftCommentBody,
} from "contract";

const FLAG_ANCHOR = {
  filePath: "src/a.ts",
  attribute: "touches-auth",
  regionStart: 10,
  regionEnd: 12,
};

export const CREATE_DRAFT_EXAMPLE = {
  filePath: "src/a.ts",
  side: "new",
  startLine: 10,
  endLine: 12,
  body: "tighten this",
} satisfies CreateDraftCommentBody;

export const UPDATE_DRAFT_EXAMPLE = {
  body: "tighten this further",
} satisfies UpdateDraftCommentBody;

export const REANCHOR_DRAFT_EXAMPLE = {
  filePath: "src/a.ts",
  side: "new",
  startLine: 14,
  endLine: 16,
} satisfies ReanchorDraftCommentBody;

export const DISMISS_RISK_EXAMPLE = {
  flags: [FLAG_ANCHOR],
  reason: "the caller already checks this",
} satisfies DismissRiskBody;

export const ADDRESS_RISK_EXAMPLE = {
  flags: [
    {
      ...FLAG_ANCHOR,
      evidence: { kind: "chunk-reviewed", ref: "c1" },
    },
  ],
} satisfies AddressRiskBody;

export const REOPEN_RISK_EXAMPLE = {
  flags: [FLAG_ANCHOR],
} satisfies ReopenRiskBody;

export const SUBMIT_REVIEW_EXAMPLE = {
  outcome: "comment",
  body: "one question inline",
} satisfies SubmitReviewBody;
