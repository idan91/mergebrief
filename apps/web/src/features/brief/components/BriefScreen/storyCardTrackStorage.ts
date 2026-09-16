import { z } from "zod/v4";

export const STORY_CARD_TRACK_STORAGE_KEY = "mergebrief.storyCardTrack";

// Bounds live in the CSS clamp; storage only refuses shapes that are not a
// pixel count at all.
const storyCardTrackSchema = z.number().int().positive();

export function readStoryCardTrack(): number | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.localStorage.getItem(STORY_CARD_TRACK_STORAGE_KEY);
    if (raw === null) return undefined;

    const parsed = storyCardTrackSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoryCardTrack(px: number): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      STORY_CARD_TRACK_STORAGE_KEY,
      JSON.stringify(px),
    );
  } catch {
    // Storage denied (private mode, quota): the width still holds for this page.
  }
}

export function clearStoryCardTrack(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(STORY_CARD_TRACK_STORAGE_KEY);
  } catch {
    // Same as the write: the reset still holds for this page.
  }
}
