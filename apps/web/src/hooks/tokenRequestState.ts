import { useEffect, useState, useSyncExternalStore } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { canTokenizeChunks } from "@web/utils/diffTokens/client";
import { PENDING_CEILING_MS } from "@web/utils/diffTokens/consts";
import { resolveGrammar } from "@web/utils/diffTokens/grammarMap";
import {
  ChunkTokenStatuses,
  TokenFailureReasons,
  type ChunkTokensHandle,
  type ChunkTokensResult,
  type ChunkTokensState,
  type GrammarName,
} from "@web/utils/diffTokens/types";
import { isChunkTokenizable } from "@web/utils/diffTokens/utils";

export interface TokenRequestInput {
  /** Identity of the reply; a new one re-requests and reads pending again. */
  requestKey: string;
  filePath: string;
  rowCount: number;
  /** The grammars the brief's budget admitted, from `planBriefGrammars`. */
  admitted: ReadonlySet<GrammarName>;
  /** Posts the request; read through a ref so an unmemoized caller is free. */
  startRequest: () => ChunkTokensHandle;
  /** False keeps the rows plain and posts nothing until the caller opts in. */
  enabled?: boolean;
}

/** The reply we hold, and the request it answered. */
interface SettledTokens {
  requestKey: string | undefined;
  state: ChunkTokensState;
}

/** How many times this request's grammar load has been retried. */
interface RequestRetry {
  requestKey: string | undefined;
  attempt: number;
}

/** A grammar chunk fetch can drop; one retry covers that without a loop. */
const GRAMMAR_LOAD_RETRIES = 1;
const GRAMMAR_LOAD_RETRY_MS = 300;
const PENDING_STATE: ChunkTokensState = { status: ChunkTokenStatuses.PENDING };
const PLAIN_STATE: ChunkTokensState = { status: ChunkTokenStatuses.PLAIN };
const NO_RETRY: RequestRetry = { requestKey: undefined, attempt: 0 };
const NOTHING_SETTLED: SettledTokens = {
  requestKey: undefined,
  state: PENDING_STATE,
};

/**
 * The cancel, key and availability logic both token hooks run. Whatever they
 * are colouring, the shape is the same: refuse before asking where the answer
 * is already known, hold one reply, and drop it the moment the key moves.
 */
export function useTokenRequestState(
  input: TokenRequestInput,
): ChunkTokensState {
  const workerAvailable = useSyncExternalStore(
    subscribeToNothing,
    canTokenizeChunks,
    readServerSnapshot,
  );
  const enabled = input.enabled ?? true;
  const tokenizable =
    enabled &&
    workerAvailable &&
    isTokenizableInput(input.filePath, input.rowCount, input.admitted);
  const { requestKey } = input;
  const [settled, setSettled] = useState<SettledTokens>(NOTHING_SETTLED);
  // The client does not cache a grammar-load failure so the next request can
  // retry; settling plain here would spend that chance without taking it.
  // Counted per request: a card the virtualizer reuses starts its retry fresh.
  const [retry, setRetry] = useState<RequestRetry>(NO_RETRY);
  const attempt = retry.requestKey === requestKey ? retry.attempt : 0;
  const [lapsedKey, setLapsedKey] = useState<string | undefined>(undefined);
  const latestStart = useLatestRef(input.startRequest);

  useEffect(() => {
    if (!tokenizable) {
      return undefined;
    }

    let live = true;
    const handle = latestStart.current();
    const timer = setTimeout(() => {
      if (live) {
        setLapsedKey(requestKey);
      }
    }, PENDING_CEILING_MS);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void handle.promise.then((result) => {
      clearTimeout(timer);
      if (!live) {
        return undefined;
      }
      if (isRetryableLoad(result) && attempt < GRAMMAR_LOAD_RETRIES) {
        retryTimer = setTimeout(
          () => setRetry({ requestKey, attempt: attempt + 1 }),
          GRAMMAR_LOAD_RETRY_MS,
        );

        return undefined;
      }
      setSettled({ requestKey, state: shapeState(result) });

      return undefined;
    });

    return () => {
      live = false;
      clearTimeout(timer);
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
      handle.cancel();
    };
  }, [
    attempt,
    requestKey,
    input.filePath,
    input.rowCount,
    tokenizable,
    latestStart,
  ]);

  if (!tokenizable) {
    return PLAIN_STATE;
  }
  if (settled.requestKey === requestKey) {
    return settled.state;
  }

  return lapsedKey === requestKey ? PLAIN_STATE : PENDING_STATE;
}

function isTokenizableInput(
  filePath: string,
  rowCount: number,
  admitted: ReadonlySet<GrammarName>,
): boolean {
  const grammar = resolveGrammar(filePath);
  if (grammar === undefined) {
    return false;
  }

  return isChunkTokenizable(rowCount) && admitted.has(grammar);
}

function isRetryableLoad(result: ChunkTokensResult): boolean {
  return (
    result.status === ChunkTokenStatuses.FAILED &&
    result.reason === TokenFailureReasons.GRAMMAR_LOAD
  );
}

function shapeState(result: ChunkTokensResult): ChunkTokensState {
  if (result.status === ChunkTokenStatuses.READY) {
    return result;
  }

  return PLAIN_STATE;
}

// The worker's availability never changes under React, so there is nothing to
// subscribe to; the server snapshot is false so hydration paints plain and the
// first client re-render moves into pending on its own.
function subscribeToNothing(): () => void {
  return () => undefined;
}

function readServerSnapshot(): boolean {
  return false;
}
