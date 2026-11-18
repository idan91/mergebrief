import { MediaKinds } from "brief-core/media";

import type { MediaLightboxHandle } from "@web/components/Markdown/context";
import { MermaidDiagram } from "@web/components/MermaidDiagram";
import type { DiagramPreviewOptions } from "@web/components/MermaidDiagram/types";
import type { StripEntry } from "../../../MediaStrip/types";
import { SHOWN_MEDIA_MAX_HEIGHT_PX } from "../consts";
import { ShownImage } from "../ShownImage";
import { ShownVideo } from "../ShownVideo";

export interface ShownItemProps {
  entry: StripEntry;
  onOpen: MediaLightboxHandle["openMedia"];
}

/** One shown item drawn the way the description draws it inline, capped, and opening the lightbox at its place. */
export function ShownItem({ entry, onOpen }: ShownItemProps) {
  const diagramPreview: DiagramPreviewOptions = {
    maxHeight: SHOWN_MEDIA_MAX_HEIGHT_PX,
    onOpen: (opener) => {
      onOpen(entry.key, opener);
    },
  };

  switch (entry.kind) {
    case MediaKinds.IMAGE:
      return <ShownImage entry={entry} onOpen={onOpen} />;
    case MediaKinds.VIDEO:
      return <ShownVideo entry={entry} />;
    case MediaKinds.DIAGRAM:
      return <MermaidDiagram code={entry.code} preview={diagramPreview} />;
  }
}
