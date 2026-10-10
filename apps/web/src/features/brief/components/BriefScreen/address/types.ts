import type { ValueOf } from "types/utils";

import type { LineSelection } from "@web/features/review/utils";
import type { ViewParam } from "../../../comparison/compareState";
import type { ReadingPositionStore } from "../readingPosition";

/** What the URL's `l` and `focus` params say. */
export interface Address {
  link: string | undefined;
  focus: boolean;
}

export interface AddressState {
  lineSelection: LineSelection | undefined;
  focusMode: boolean;
  scope: ViewParam;
  activeChunkId: string | undefined;
  /** The Address the URL carries now. */
  url: Address;
  /** The link this page last wrote; starts undefined on every Brief. */
  writtenLink: string | undefined;
}

/** The moments a steady state cannot show; each is reported once, as it happens. */
export const AddressEventKinds = {
  CHUNK_SHARED: "chunk-shared",
  LINE_LINK_MISSED: "line-link-missed",
  LINK_UNPARSED: "link-unparsed",
} as const;

/** @public */
export type AddressEventKind = ValueOf<typeof AddressEventKinds>;

export type AddressEvent =
  | { kind: typeof AddressEventKinds.CHUNK_SHARED; chunkId: string }
  | { kind: typeof AddressEventKinds.LINE_LINK_MISSED }
  | { kind: typeof AddressEventKinds.LINK_UNPARSED };

export interface AddressOutcome {
  /** One write per field that differs from the URL; an equal field is no write. */
  address: Address;
  /** The next state's `writtenLink`. */
  writtenLink: string | undefined;
}

export interface UseAddressInput {
  briefId: string;
  lineSelection: LineSelection | undefined;
  focusMode: boolean;
  scope: ViewParam;
  /** Its active chunk is read on each change, and its moves are changes too. */
  position: ReadingPositionStore;
  url: Address;
  /** Replaces the `l` param; undefined drops it. */
  navigateLink: ((link: string | undefined) => void) | undefined;
  /** Replaces the `focus` param. */
  setFocusParam: ((focus: boolean) => void) | undefined;
}

export interface AddressHandle {
  /**
   * Writes what the event asks for at once. After CHUNK_SHARED the caller
   * clears the line selection in the same task, or the selection writes its
   * lines back.
   */
  send: (event: AddressEvent) => void;
  /** True for the link this page last wrote on this Brief. */
  isOwnLink: (link: string) => boolean;
}
