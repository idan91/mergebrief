import type { Effort, Generator, Logger } from "generators";
import type { FetchedPr } from "../../github/types";
import type { ChangeGroup, ProductDiff } from "../../types";
import type { WarningCollector } from "../warnings/types";

/** What a call wrote, before the check: a section nobody has marked read yet. */
export type WrittenProductDiff = Pick<ProductDiff, "changes" | "hasMore">;

export interface CheckedProductDiff {
  /** Always a section the stored schema accepts. */
  readonly productDiff: ProductDiff;
  readonly issues: string[];
}

/** What the call lists of one change-group: enough to name it, never its code. */
export type ListedChangeGroup = Pick<ChangeGroup, "id" | "title" | "summary">;

/** One Product diff call, made after a brief that ran as one call. */
export interface ProductDiffRequest {
  readonly generator: Generator;
  readonly pr: FetchedPr;
  /** The finished brief's change-groups, which each Product change names by id. */
  readonly changeGroups: readonly ListedChangeGroup[];
  readonly effort: Effort;
  readonly log: Logger;
  readonly warnings: WarningCollector;
}
