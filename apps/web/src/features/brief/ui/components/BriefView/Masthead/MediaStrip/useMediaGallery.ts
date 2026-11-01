import type { MediaKey } from "brief-core/media";
import { useCallback, useMemo, useState } from "react";

import type { MediaLightboxHandle } from "@web/components/Markdown/context";
import type { Brief } from "../../../../../model/types";
import type { MediaGallery } from "./types";
import { useStripEntries } from "./useStripEntries";
import { stepIndex } from "./utils";

interface OpenedMedia {
  readonly key: MediaKey;
  readonly opener: HTMLElement;
}

/**
 * The strip's entries and the one lightbox over them. The open item is held
 * by key, so a video confirmed while the lightbox is open never shifts it.
 */
export function useMediaGallery(brief: Brief): MediaGallery {
  const entries = useStripEntries(brief);
  const [opened, setOpened] = useState<OpenedMedia | undefined>();

  const openMedia = useCallback((key: MediaKey, opener: HTMLElement) => {
    setOpened({ key, opener });
  }, []);
  const lightbox = useMemo<MediaLightboxHandle>(
    () => ({
      hasMedia: (key) => entries.some((entry) => entry.key === key),
      openMedia,
    }),
    [entries, openMedia],
  );

  const found = entries.findIndex((entry) => entry.key === opened?.key);
  const openIndex = found === -1 ? undefined : found;

  function stepMedia(offset: number): void {
    if (opened === undefined || openIndex === undefined) {
      return;
    }
    const next = entries[stepIndex(openIndex, offset, entries.length)];
    if (next !== undefined) {
      setOpened({ key: next.key, opener: opened.opener });
    }
  }

  function closeMedia(): void {
    setOpened(undefined);
  }

  return {
    entries,
    openIndex,
    opener: opened?.opener,
    lightbox,
    stepMedia,
    closeMedia,
  };
}
