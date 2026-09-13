import { requestChunkTokens } from "@web/utils/diffTokens/client";
import type {
  ChunkTokensRequest,
  ChunkTokensState,
  DiffLine,
  GrammarName,
} from "@web/utils/diffTokens/types";
import { useTokenRequestState } from "./tokenRequestState";

export interface ChunkTokensInput {
  /** The brief this chunk belongs to; chunk ids restart per brief. */
  briefKey: string;
  chunkId: string;
  filePath: string;
  rows: DiffLine[];
  /** The grammars this brief's budget admitted, from `planBriefGrammars`. */
  admitted: ReadonlySet<GrammarName>;
  /** Names the rows expansion spliced in; absent while the chunk is folded. */
  expansionKey?: string;
}

/** Colour for one chunk of one brief, reconstructed from both hunk sides. */
export function useChunkTokens(input: ChunkTokensInput): ChunkTokensState {
  const { briefKey, chunkId, filePath, rows, admitted, expansionKey } = input;
  const request: ChunkTokensRequest = {
    briefKey,
    chunkId,
    filePath,
    rows,
    admitted,
  };
  let requestKey = `${briefKey}:${chunkId}`;
  if (expansionKey !== undefined) {
    request.expansionKey = expansionKey;
    requestKey = `${requestKey}:${expansionKey}`;
  }

  return useTokenRequestState({
    requestKey,
    filePath,
    rowCount: rows.length,
    admitted,
    startRequest: () => requestChunkTokens(request),
  });
}
