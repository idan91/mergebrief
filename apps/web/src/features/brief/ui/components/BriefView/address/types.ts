import type { ValueOf } from "types/utils";

import type { LineSelection } from "@web/features/review/utils";
import type {
  BriefSearchParams,
  ViewParam,
} from "../../../../model/comparison/compare-state";
import type { ReadingPositionStore } from "../reading/reading-position";
import type { ScopeExitOptions } from "../types";

/** What the URL's `l` and `focus` params say. */
export interface Address {
  link: string | undefined;
  focus: boolean;
}

/** A same-route search write: the reducer runs against the URL as it is then. */
export interface SearchNavigation<Search> {
  search: (previous: Search) => Search;
  replace: boolean;
  resetScroll?: boolean;
}

/** The route's navigate, narrowed to same-route search writes. */
export type NavigateSearch<Search> = (
  navigation: SearchNavigation<Search>,
) => Promise<void>;

/** The URL writes a route hands the screen; every member is stable. */
export interface BriefAddressPort {
  /** The `l` param as the URL carries it. */
  link: string | undefined;
  /** Replaces `l`, undefined dropping it; keeps the scroll. */
  navigateLink: (link: string | undefined) => void;
  /** Replaces `focus`; keeps the scroll. */
  setFocusParam: (focus: boolean) => void;
  /** Drops `diff` with replace, so the stored preference shows. */
  clearDiffParam: () => void;
  /** Writes the whole View/Compare/diff trio: a key `next` omits is dropped. */
  navigateSearch: (next: BriefSearchParams, options?: ScopeExitOptions) => void;
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
