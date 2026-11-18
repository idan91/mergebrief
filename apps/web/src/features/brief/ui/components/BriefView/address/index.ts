import { useCallback, useEffect, useMemo, useRef } from "react";

import { deriveAddress } from "./derive";
import type {
  Address,
  AddressEvent,
  AddressHandle,
  AddressState,
  UseAddressInput,
} from "./types";

interface FieldWrite<Value> {
  url: Value;
  value: Value;
}

interface FieldStep<Value> {
  write: boolean;
  last: FieldWrite<Value> | undefined;
}

interface AddressMemory {
  briefId: string;
  writtenLink: string | undefined;
  lastLink: FieldWrite<string | undefined> | undefined;
  lastFocus: FieldWrite<boolean> | undefined;
}

function createMemory(briefId: string): AddressMemory {
  return {
    briefId,
    writtenLink: undefined,
    lastLink: undefined,
    lastFocus: undefined,
  };
}

/** A write the URL has not answered yet is not sent again. */
function planFieldWrite<Value>(
  next: Value,
  url: Value,
  last: FieldWrite<Value> | undefined,
): FieldStep<Value> {
  if (next === url) {
    return { write: false, last: undefined };
  }
  const repeated =
    last !== undefined && last.url === url && last.value === next;
  if (repeated) {
    return { write: false, last };
  }

  return { write: true, last: { url, value: next } };
}

function readAddressState(
  input: UseAddressInput,
  writtenLink: string | undefined,
): AddressState {
  return {
    lineSelection: input.lineSelection,
    focusMode: input.focusMode,
    scope: input.scope,
    activeChunkId: input.position.getState().activeChunkId ?? undefined,
    url: input.url,
    writtenLink,
  };
}

function writeAddress(
  input: UseAddressInput,
  next: Address,
  memory: AddressMemory,
): void {
  const link = planFieldWrite(next.link, input.url.link, memory.lastLink);
  memory.lastLink = link.last;
  if (link.write) {
    input.navigateLink?.(next.link);
  }

  const focus = planFieldWrite(next.focus, input.url.focus, memory.lastFocus);
  memory.lastFocus = focus.last;
  if (focus.write) {
    input.setFocusParam?.(next.focus);
  }
}

/**
 * The one writer of the `l` and `focus` params. Each change to the reading
 * state or the URL derives the Address once and replaces only the fields
 * that differ; what the page wrote is forgotten on every Brief.
 */
export function useAddress(input: UseAddressInput): AddressHandle {
  const latest = useRef(input);
  latest.current = input;
  const memory = useRef(createMemory(input.briefId));
  if (memory.current.briefId !== input.briefId) {
    memory.current = createMemory(input.briefId);
  }

  const apply = useCallback((event?: AddressEvent) => {
    const current = latest.current;
    const remembered = memory.current;
    const state = readAddressState(current, remembered.writtenLink);

    const outcome = deriveAddress(state, event);
    remembered.writtenLink = outcome.writtenLink;
    writeAddress(current, outcome.address, remembered);
  }, []);

  const {
    briefId,
    lineSelection,
    focusMode,
    scope,
    position,
    url,
    navigateLink,
    setFocusParam,
  } = input;
  useEffect(() => {
    apply();
  }, [
    apply,
    briefId,
    lineSelection,
    focusMode,
    scope,
    url.link,
    url.focus,
    navigateLink,
    setFocusParam,
  ]);
  useEffect(
    () =>
      position.subscribe((state, previous) => {
        if (state.activeChunkId !== previous.activeChunkId) {
          apply();
        }
      }),
    [apply, position],
  );

  return useMemo(
    () => ({
      send: (event: AddressEvent) => {
        apply(event);
      },
      isOwnLink: (link: string) => memory.current.writtenLink === link,
    }),
    [apply],
  );
}
