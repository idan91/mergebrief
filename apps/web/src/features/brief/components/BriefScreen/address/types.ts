import type { ValueOf } from "types/utils";

import type { LineSelection } from "@web/features/review/utils";
import type { ViewParam } from "../../../comparison/compareState";

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
} as const;

/** @public */
export type AddressEventKind = ValueOf<typeof AddressEventKinds>;

export type AddressEvent =
  | { kind: typeof AddressEventKinds.CHUNK_SHARED; chunkId: string }
  | { kind: typeof AddressEventKinds.LINE_LINK_MISSED };

export interface AddressOutcome {
  /** One write per field that differs from the URL; an equal field is no write. */
  address: Address;
  /** The next state's `writtenLink`. */
  writtenLink: string | undefined;
}
