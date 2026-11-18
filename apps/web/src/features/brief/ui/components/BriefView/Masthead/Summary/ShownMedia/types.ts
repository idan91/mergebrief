import type { CSSProperties } from "react";

/** The shown row's style: the height cap its image and video rules read. */
export interface ShownRowStyle extends CSSProperties {
  "--shown-media-max-height": `${number}px`;
}
