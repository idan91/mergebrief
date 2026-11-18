import type { BriefAddressSearch } from "@web/features/brief/model";
import type { ConversationFilterSearch } from "@web/features/conversation/utils";

/** The PR page's search: the screen's params, the revision keys, the filters. */
export interface PrBriefSearch
  extends BriefAddressSearch, ConversationFilterSearch {
  /** The brief's index on this PR; the one revision key fresh links carry. */
  rev?: number;
  /** Legacy span keys, read only: an old Entry-comment link still lands. */
  base?: string;
  head?: string;
  /** This route reserves the param; the conversation section reads it. */
  thread?: number;
}

/** A change to the PR page's search; an explicit `undefined` drops a key. */
export type PrSearchChange = {
  readonly [Key in keyof PrBriefSearch]?: PrBriefSearch[Key] | undefined;
};
