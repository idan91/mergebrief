import { useEffect, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { requestChunkTokens } from "@web/utils/diffTokens/client";
import { resolveGrammar } from "@web/utils/diffTokens/grammarMap";
import {
  ChunkTokenStatuses,
  TokenFailureReasons,
  type ChunkTokensResult,
  type ChunkTokensState,
  type DiffLine,
  type GrammarName,
} from "@web/utils/diffTokens/types";
import { isChunkTokenizable } from "@web/utils/diffTokens/utils";

export interface ChunkTokensInput {
  /** The brief this chunk belongs to; chunk ids restart per brief. */
  briefKey: string;
  chunkId: string;
  filePath: string;
  rows: DiffLine[];
  /** The grammars this brief's budget admitted, from `planBriefGrammars`. */
  admitted: ReadonlySet<GrammarName>;
}

/** How many times this chunk's grammar load has been retried. */
interface ChunkRetry {
  chunkKey: string | undefined;
  attempt: number;
}

/** The reply we hold, and the chunk it answered. */
interface SettledChunkTokens {
  chunkKey: string | undefined;
  state: ChunkTokensState;
}

/** A grammar chunk fetch can drop; one retry covers that without a loop. */
const GRAMMAR_LOAD_RETRIES = 1;
const GRAMMAR_LOAD_RETRY_MS = 300;
const PENDING_STATE: ChunkTokensState = { status: ChunkTokenStatuses.PENDING };
const PLAIN_STATE: ChunkTokensState = { status: ChunkTokenStatuses.PLAIN };
const NO_RETRY: ChunkRetry = { chunkKey: undefined, attempt: 0 };
const NOTHING_SETTLED: SettledChunkTokens = {
  chunkKey: undefined,
  state: PENDING_STATE,
};

/**
 * Colour for one chunk, off the page's worker. A chunk we will not colour
 * reads `plain` on the first render, so nothing waits on a reply that is
 * never coming; a chunk whose input just changed reads `pending` on that same
 * render, so the outgoing chunk's tokens never paint on the incoming one.
 */
export function useChunkTokens(input: ChunkTokensInput): ChunkTokensState {
  const { briefKey, chunkId, filePath, rows, admitted } = input;
  const chunkKey = `${briefKey}:${chunkId}`;
  const rowCount = rows.length;
  const tokenizable = isTokenizableChunk(filePath, rowCount, admitted);
  const [settled, setSettled] = useState<SettledChunkTokens>(NOTHING_SETTLED);
  // The client does not cache a grammar-load failure so the next request can
  // retry; settling plain here would spend that chance without taking it.
  // Counted per chunk: a card the virtualizer reuses starts its retry fresh.
  const [retry, setRetry] = useState<ChunkRetry>(NO_RETRY);
  const attempt = retry.chunkKey === chunkKey ? retry.attempt : 0;

  // A chunk's rows never change in place, so the chunk key plus the row count
  // identifies the request. Depending on the array and the Set themselves
  // would cancel and re-post on every render an unmemoized caller makes.
  const latestRows = useLatestRef(rows);
  const latestAdmitted = useLatestRef(admitted);

  useEffect(() => {
    if (!tokenizable) return undefined;

    let live = true;
    const handle = requestChunkTokens({
      briefKey,
      chunkId,
      filePath,
      rows: latestRows.current,
      admitted: latestAdmitted.current,
    });
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void handle.promise.then((result) => {
      if (!live) return undefined;
      if (isRetryableLoad(result) && attempt < GRAMMAR_LOAD_RETRIES) {
        retryTimer = setTimeout(
          () => setRetry({ chunkKey, attempt: attempt + 1 }),
          GRAMMAR_LOAD_RETRY_MS,
        );

        return undefined;
      }
      setSettled({ chunkKey, state: shapeState(result) });

      return undefined;
    });

    return () => {
      live = false;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      handle.cancel();
    };
  }, [
    attempt,
    briefKey,
    chunkId,
    chunkKey,
    filePath,
    rowCount,
    tokenizable,
    latestRows,
    latestAdmitted,
  ]);

  if (!tokenizable) return PLAIN_STATE;

  return settled.chunkKey === chunkKey ? settled.state : PENDING_STATE;
}

function isTokenizableChunk(
  filePath: string,
  rowCount: number,
  admitted: ReadonlySet<GrammarName>,
): boolean {
  const grammar = resolveGrammar(filePath);
  if (grammar === undefined) return false;

  return isChunkTokenizable(rowCount) && admitted.has(grammar);
}

function isRetryableLoad(result: ChunkTokensResult): boolean {
  return (
    result.status === ChunkTokenStatuses.FAILED &&
    result.reason === TokenFailureReasons.GRAMMAR_LOAD
  );
}

function shapeState(result: ChunkTokensResult): ChunkTokensState {
  if (result.status === ChunkTokenStatuses.READY) return result;

  return PLAIN_STATE;
}
