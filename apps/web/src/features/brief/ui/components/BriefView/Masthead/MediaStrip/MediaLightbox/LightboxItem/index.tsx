import { MediaKinds } from "brief-core/media";

import type { StripEntry } from "../../types";
import { LightboxDiagram } from "./LightboxDiagram";
import { LightboxImage } from "./LightboxImage";
import { LightboxVideo } from "./LightboxVideo";

export interface LightboxItemProps {
  entry: StripEntry;
}

/**
 * The open item at full size: an image or diagram fitted to the stage, or
 * the player.
 */
export function LightboxItem({ entry }: LightboxItemProps) {
  switch (entry.kind) {
    case MediaKinds.IMAGE:
      return <LightboxImage entry={entry} />;
    case MediaKinds.VIDEO:
      return <LightboxVideo entry={entry} />;
    case MediaKinds.DIAGRAM:
      return <LightboxDiagram entry={entry} />;
  }
}
