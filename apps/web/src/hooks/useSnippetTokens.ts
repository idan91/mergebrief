import { requestSnippetTokens } from "@web/utils/diffTokens/client";
import {
  TokenizeModes,
  type ChunkTokensState,
  type DiffLine,
  type GrammarName,
  type TokenizeMode,
} from "@web/utils/diffTokens/types";
import { useTokenRequestState } from "./tokenRequestState";

export interface SnippetTokensInput {
  /** The brief the snippet is read under; empty outside a token plan. */
  briefKey: string;
  /** Identity of this snippet, stable across renders of the same rows. */
  snippetKey: string;
  /** The file the language is anchored on; no grammar renders plain. */
  filePath: string;
  rows: DiffLine[];
  admitted: ReadonlySet<GrammarName>;
  /**
   * `standalone` by default: a snippet is one side already. Rows that are a
   * real unified diff, hunk headers included, ask for `hunk` instead.
   */
  mode?: TokenizeMode | undefined;
  /** False holds the rows plain, so collapsed content costs no request. */
  enabled?: boolean | undefined;
}

/** Colour for rows with no hunk behind them: they tokenize as one snippet. */
export function useSnippetTokens(input: SnippetTokensInput): ChunkTokensState {
  const { briefKey, snippetKey, filePath, rows, admitted } = input;
  const mode = input.mode ?? TokenizeModes.STANDALONE;

  return useTokenRequestState({
    requestKey: `${briefKey}:${mode}:${snippetKey}`,
    filePath,
    rowCount: rows.length,
    admitted,
    enabled: input.enabled ?? true,
    startRequest: () =>
      requestSnippetTokens({
        briefKey,
        snippetKey,
        filePath,
        rows,
        admitted,
        mode,
      }),
  });
}
