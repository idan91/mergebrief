import {
  isFileCommentAnchor,
  isLineCommentAnchor,
  type CommentAnchor,
  type LineCommentAnchor,
} from "../../utils/comments";
import {
  ComposerStateKinds,
  type ClosedComposerState,
  type ComposerPlace,
  type ComposerState,
} from "./types";

const CLOSED_COMPOSER: ClosedComposerState = {
  kind: ComposerStateKinds.CLOSED,
};

/** A saving composer stays put: its write owns the anchor until it settles. */
export function openComposerState(
  current: ComposerState,
  anchor: CommentAnchor,
  host: string,
): ComposerState {
  if (current.kind === ComposerStateKinds.SAVING) {
    return current;
  }
  return { kind: ComposerStateKinds.OPEN, anchor, host };
}

export function startComposerSave(
  current: ComposerState,
  token: number,
): ComposerState {
  if (current.kind !== ComposerStateKinds.OPEN) {
    return current;
  }
  return { ...current, kind: ComposerStateKinds.SAVING, token };
}

/** Closes on a landed write; a failure reopens it with the same Save available. */
export function settleComposerSave(
  current: ComposerState,
  token: number,
  saved: boolean,
): ComposerState {
  const currentSave =
    current.kind === ComposerStateKinds.SAVING && current.token === token;
  if (!currentSave) {
    return current;
  }
  if (saved) {
    return CLOSED_COMPOSER;
  }
  return {
    kind: ComposerStateKinds.OPEN,
    anchor: current.anchor,
    host: current.host,
  };
}

/** The host went away: close whatever it showed, orphaning a save in flight. */
export function dismissComposer(current: ComposerState): ComposerState {
  if (current.kind === ComposerStateKinds.REANCHORING) {
    return current;
  }
  return CLOSED_COMPOSER;
}

/** The reviewer's own cancel, refused while the write is in flight. */
export function cancelComposerState(current: ComposerState): ComposerState {
  if (current.kind !== ComposerStateKinds.OPEN) {
    return current;
  }
  return CLOSED_COMPOSER;
}

export function armReanchorState(
  current: ComposerState,
  draftId: string,
): ComposerState {
  if (current.kind === ComposerStateKinds.SAVING) {
    return current;
  }
  return { kind: ComposerStateKinds.REANCHORING, draftId };
}

export function disarmReanchorState(current: ComposerState): ComposerState {
  if (current.kind !== ComposerStateKinds.REANCHORING) {
    return current;
  }
  return CLOSED_COMPOSER;
}

export function getComposerAnchor(
  state: ComposerState,
): CommentAnchor | undefined {
  if (
    state.kind === ComposerStateKinds.OPEN ||
    state.kind === ComposerStateKinds.SAVING
  ) {
    return state.anchor;
  }
  return undefined;
}

export function getComposerHost(state: ComposerState): string | undefined {
  if (
    state.kind === ComposerStateKinds.OPEN ||
    state.kind === ComposerStateKinds.SAVING
  ) {
    return state.host;
  }
  return undefined;
}

export function isComposerSaving(state: ComposerState): boolean {
  return state.kind === ComposerStateKinds.SAVING;
}

export function getReanchorDraftId(state: ComposerState): string | undefined {
  if (state.kind !== ComposerStateKinds.REANCHORING) {
    return undefined;
  }
  return state.draftId;
}

/** The line composer this table shows, if it is the host. */
export function getHostedLineAnchor(
  state: ComposerState,
  host: string,
): LineCommentAnchor | undefined {
  const anchor = getComposerAnchor(state);
  if (anchor === undefined || !isLineCommentAnchor(anchor)) {
    return undefined;
  }
  if (getComposerHost(state) !== host) {
    return undefined;
  }
  return anchor;
}

/** The file composer sits under the header that opened it, never a sibling's. */
export function isHostingFileComposer(
  state: ComposerState,
  host: string,
): boolean {
  const anchor = getComposerAnchor(state);
  const fileComposer = anchor !== undefined && isFileCommentAnchor(anchor);
  const hostedHere = fileComposer && getComposerHost(state) === host;
  return hostedHere;
}

export function isHostSaving(state: ComposerState, host: string): boolean {
  const hostSaving = isComposerSaving(state) && getComposerHost(state) === host;
  return hostSaving;
}

/** Two anchors name the same lines, or the same file, whatever rows they carry. */
export function isSameCommentPlace(
  first: CommentAnchor,
  second: CommentAnchor,
): boolean {
  const sameKindAndFile =
    first.kind === second.kind && first.file === second.file;
  if (!sameKindAndFile) {
    return false;
  }
  const bothLines = isLineCommentAnchor(first) && isLineCommentAnchor(second);
  if (!bothLines) {
    return true;
  }
  const sameStartSide =
    (first.startSide ?? first.side) === (second.startSide ?? second.side);
  const sameLines =
    sameStartSide &&
    first.side === second.side &&
    first.startLine === second.startLine &&
    first.endLine === second.endLine;
  return sameLines;
}

/** The same lines, or the same file under the same header: one stored text. */
export function isSameComposerPlace(
  first: ComposerPlace,
  second: ComposerPlace,
): boolean {
  if (!isSameCommentPlace(first.anchor, second.anchor)) {
    return false;
  }
  const samePlace =
    isLineCommentAnchor(first.anchor) || first.host === second.host;
  return samePlace;
}
