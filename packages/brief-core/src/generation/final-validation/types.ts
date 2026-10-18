import type { FileDiff } from "../../diff/file-diff";
import type { RevisionChangeFile } from "../../diff/revchanges";
import type { PrFile } from "../../github/types";
import type { Brief, PrimaryTicket } from "../../types";
import type { CustomRiskAttributeInput } from "../repo-context";
import type { IntentSource, PrimaryTicketFacts } from "../validate";
import type { WarningCollector } from "../warnings/types";

/** What the request step showed the model, which the final brief is checked against. */
export interface BriefValidationContext {
  readonly prFiles: readonly PrFile[];
  readonly fileDiffs: readonly FileDiff[];
  readonly changedFiles: readonly RevisionChangeFile[];
  /** Absent when no repo context was accepted; the token check then skips. */
  readonly customAttributes?: readonly CustomRiskAttributeInput[];
  readonly injectedUrls: readonly string[];
  /** The sanitized texts the prompt rendered, which quotes verify against. */
  readonly corpus: readonly IntentSource[];
  readonly primaryFacts?: PrimaryTicketFacts;
  /** Stamped after validation; the model never sees it. */
  readonly primaryTicket?: PrimaryTicket;
}

export interface FinalValidationArgs {
  readonly brief: Brief;
  readonly context: BriefValidationContext;
  /** Their tokens were checked against the vocabulary of the run that wrote them. */
  readonly carriedChunkIds: readonly string[];
  readonly acceptsRevisionDroppedChecks: boolean;
  readonly warnings: WarningCollector;
}
