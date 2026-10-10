import { deriveLineLink, isLineLink, resolveLinkChunkId } from "../utils";
import {
  type AddressEvent,
  AddressEventKinds,
  type AddressOutcome,
  type AddressState,
} from "./types";

interface LinkStep {
  link: string | undefined;
  writtenLink: string | undefined;
}

function followLineSelection(state: AddressState): LinkStep {
  const { lineSelection, url, writtenLink } = state;
  if (lineSelection !== undefined) {
    const selected = deriveLineLink(lineSelection);
    if (selected === writtenLink) {
      return { link: url.link, writtenLink };
    }
    return { link: selected, writtenLink: selected };
  }

  if (!isLineLink(writtenLink)) {
    return { link: url.link, writtenLink };
  }
  if (writtenLink === url.link) {
    return { link: undefined, writtenLink: undefined };
  }
  return { link: url.link, writtenLink: undefined };
}

function dropOwnChunkLink(state: AddressState, step: LinkStep): LinkStep {
  const ownChunkLink =
    step.link !== undefined &&
    step.link === step.writtenLink &&
    !isLineLink(step.link);
  const focusLeft = !state.focusMode && state.url.focus;
  const focusInChanges = state.focusMode && state.scope === "changes";
  const staleChunkLink = ownChunkLink && (focusLeft || focusInChanges);
  if (staleChunkLink) {
    return { link: undefined, writtenLink: undefined };
  }
  return step;
}

function followActiveChunk(state: AddressState, step: LinkStep): LinkStep {
  const { activeChunkId } = state;
  const following =
    state.focusMode &&
    state.lineSelection === undefined &&
    state.scope === "full";
  const nothingToFollow = !following || activeChunkId === undefined;
  if (nothingToFollow) {
    return step;
  }

  const named =
    resolveLinkChunkId(step.link) === activeChunkId ||
    resolveLinkChunkId(step.writtenLink) === activeChunkId;
  if (named) {
    return step;
  }
  return { link: activeChunkId, writtenLink: activeChunkId };
}

function deriveEventStep(event: AddressEvent): LinkStep {
  if (event.kind === AddressEventKinds.CHUNK_SHARED) {
    return { link: event.chunkId, writtenLink: event.chunkId };
  }
  return { link: undefined, writtenLink: undefined };
}

function deriveSteadyStep(state: AddressState): LinkStep {
  const selected = followLineSelection(state);

  return followActiveChunk(state, dropOwnChunkLink(state, selected));
}

/**
 * The Address reading state asks for. An event answers alone; after a
 * CHUNK_SHARED the caller stands the line selection down before the next
 * derive, or the selection writes its lines back.
 */
export function deriveAddress(
  state: AddressState,
  event?: AddressEvent,
): AddressOutcome {
  const step =
    event === undefined ? deriveSteadyStep(state) : deriveEventStep(event);

  return {
    address: { link: step.link, focus: state.focusMode },
    writtenLink: step.writtenLink,
  };
}
