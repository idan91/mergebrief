import type { ThreadComposerWiring } from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";

import type { FileLineOwners } from "../../../../model/utils/lineOwner";

/**
 * What a guest table in Changes scope needs to take a comment: the full
 * brief's owners per file, the live threads per file and the conversation
 * composer.
 */
export interface ChangesReviewWiring {
  lineOwnersByFile: ReadonlyMap<string, FileLineOwners>;
  lineThreadsByFile: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  conversationComposer: ThreadComposerWiring | undefined;
}
