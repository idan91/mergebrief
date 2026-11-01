import type { ShownRowStyle } from "./types";

/** The tallest any shown item draws, in pixels: images, videos and diagrams alike. */
export const SHOWN_MEDIA_MAX_HEIGHT_PX = 320;

/** Hands the cap to the image and video rules, so one number sizes all three. */
export const SHOWN_ROW_STYLE: ShownRowStyle = {
  "--shown-media-max-height": `${SHOWN_MEDIA_MAX_HEIGHT_PX}px`,
};
