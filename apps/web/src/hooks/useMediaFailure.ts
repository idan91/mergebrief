import { useEffect, useRef, useState, type RefObject } from "react";

import { useLatestRef } from "./useLatestRef";

/** A media element's load failure, tagged with the source it failed on. */
export interface MediaFailure<MediaElement extends HTMLElement> {
  readonly mediaRef: RefObject<MediaElement | null>;
  /** The current source failed; a new source starts fresh. */
  readonly failed: boolean;
  /** The element's `onError`: the current source failed. */
  readonly markFailed: () => void;
}

/**
 * Calls `onBroken` when the image at `source` already settled broken: a
 * server-rendered image can fail before hydration attaches onError, and
 * decode() on a settled image rejects only when it is broken.
 */
function useBrokenImageCheck(
  imageRef: RefObject<HTMLImageElement | null>,
  source: string | undefined,
  onBroken: (source: string) => void,
): void {
  const latestOnBroken = useLatestRef(onBroken);

  useEffect(() => {
    const image = imageRef.current;
    const settled = source !== undefined && image?.complete === true;
    if (!settled) {
      return;
    }
    image.decode().catch(() => {
      latestOnBroken.current(source);
    });
  }, [imageRef, latestOnBroken, source]);
}

/** The failure plus the setter a settled check reports a source through. */
interface SourceFailure<
  MediaElement extends HTMLElement,
> extends MediaFailure<MediaElement> {
  readonly failSource: (failedSource: string) => void;
}

function useSourceFailure<MediaElement extends HTMLElement>(
  source: string | undefined,
): SourceFailure<MediaElement> {
  const mediaRef = useRef<MediaElement>(null);
  const [failedSource, setFailedSource] = useState<string>();
  const failed = source !== undefined && failedSource === source;

  function markFailed(): void {
    setFailedSource(source);
  }

  return { mediaRef, failed, markFailed, failSource: setFailedSource };
}

/** An image's failure, from its onError or a broken settled image. */
export function useImageFailure(
  source: string | undefined,
): MediaFailure<HTMLImageElement> {
  const { failSource, ...failure } = useSourceFailure<HTMLImageElement>(source);
  useBrokenImageCheck(failure.mediaRef, source, failSource);
  return failure;
}

/**
 * A player's failure, from its onError or an error it already raised: a
 * server-rendered video can fail before hydration attaches onError, and
 * the element keeps that error.
 */
export function useVideoFailure(
  source: string | undefined,
): MediaFailure<HTMLVideoElement> {
  const { failSource, ...failure } = useSourceFailure<HTMLVideoElement>(source);
  const { mediaRef } = failure;

  useEffect(() => {
    const raisedError = mediaRef.current?.error?.code !== undefined;
    if (raisedError && source !== undefined) {
      failSource(source);
    }
  }, [failSource, mediaRef, source]);

  return failure;
}
