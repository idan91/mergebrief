import { useCallback, useLayoutEffect, useState } from "react";

import {
  clearStoryCardTrack,
  readStoryCardTrack,
  writeStoryCardTrack,
} from "./story-card-track-storage";

export interface StoryCardTrack {
  /** Card column width in px; absent means the stylesheet default applies. */
  track: number | undefined;
  setTrack: (px: number) => void;
  resetTrack: () => void;
}

/**
 * Storage is read on the client only, after hydration and before paint: SSR
 * renders the default track so a remembered width never arrives as a
 * hydration mismatch, and a navigation never flashes the default.
 */
export function useStoryCardTrack(): StoryCardTrack {
  const [track, setTrackState] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    setTrackState(readStoryCardTrack());
  }, []);

  const setTrack = useCallback((px: number) => {
    setTrackState(px);
    writeStoryCardTrack(px);
  }, []);

  const resetTrack = useCallback(() => {
    setTrackState(undefined);
    clearStoryCardTrack();
  }, []);

  return { track, setTrack, resetTrack };
}
