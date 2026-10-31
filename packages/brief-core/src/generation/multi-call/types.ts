import type { Logger } from "generators";
import type { FetchedPr } from "../../github/types";
import type { Outline } from "../outline/types";
import type { RepoContext } from "../repo-context";
import type { WarningCollector } from "../warnings/types";

export interface GroupingRequestInput {
  readonly pr: FetchedPr;
  readonly outline: Outline;
  readonly hunkCount: number;
  readonly repoContext: RepoContext | undefined;
  readonly log: Logger;
  readonly warnings: WarningCollector;
}

/** The grouping call's prompts, plus what the request step accepted for the validation context. */
export interface GroupingRequest {
  readonly system: string;
  readonly user: string;
  /** The primary ticket as the prompt rendered it; "" without one. */
  readonly primaryText: string;
  /** The repo context the gates let through; its custom attributes bind the detail calls. */
  readonly repoContext: RepoContext | undefined;
}
