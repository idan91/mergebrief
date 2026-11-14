import { useCallback, useEffect, useState } from "react";

import {
  clearStoryCardTrack,
  migrateLegacyStoryCardTrack,
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
 * The stored width seeds the first render on both sides from the cookie, so
 * the server draws the column at the width the reader left it and hydration
 * agrees with it.
 */
export function useStoryCardTrack(): StoryCardTrack {
  const [track, setTrackState] = useState<number | undefined>(
    readStoryCardTrack,
  );

  useEffect(() => {
    const migrated = migrateLegacyStoryCardTrack();
    if (migrated !== undefined) {
      setTrackState(migrated);
    }
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
