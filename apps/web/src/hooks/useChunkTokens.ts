import { requestChunkTokens } from "@web/utils/diffTokens/client";
import type {
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
}

/** Colour for one chunk of one brief, reconstructed from both hunk sides. */
export function useChunkTokens(input: ChunkTokensInput): ChunkTokensState {
  const { briefKey, chunkId, filePath, rows, admitted } = input;

  return useTokenRequestState({
    requestKey: `${briefKey}:${chunkId}`,
    filePath,
    rowCount: rows.length,
    admitted,
    startRequest: () =>
      requestChunkTokens({ briefKey, chunkId, filePath, rows, admitted }),
  });
}
