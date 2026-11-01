import { useTranslation } from "react-i18next";

import { DIAGRAM_TITLE_KEYS } from "@web/components/MermaidDiagram/consts";
import { DiagramFailed } from "@web/components/MermaidDiagram/DiagramFailed";
import { DiagramFrame } from "@web/components/MermaidDiagram/DiagramFrame";
import {
  DiagramRenderStatuses,
  type FrameBounds,
} from "@web/components/MermaidDiagram/types";
import { useRenderedDiagram } from "@web/components/MermaidDiagram/useRenderedDiagram";
import type { DiagramStripEntry } from "../../../types";
import { LightboxZoom } from "../LightboxZoom";
import styles from "./LightboxDiagram.module.scss";

/** The zoom sizes the frame's box, so the frame only fills it. */
const ZOOM_SIZED_FRAME: FrameBounds = {};

export interface LightboxDiagramProps {
  entry: DiagramStripEntry;
}

/**
 * The drawn diagram fitted to the stage, offering its natural size when
 * that is larger; one Mermaid cannot draw shows its source as a code block.
 */
export function LightboxDiagram({ entry }: LightboxDiagramProps) {
  const { t } = useTranslation();
  const render = useRenderedDiagram(entry.code);

  if (render.status === DiagramRenderStatuses.FAILED) {
    return (
      <div className={styles["failed"]}>
        <DiagramFailed code={entry.code} />
      </div>
    );
  }
  if (render.status === DiagramRenderStatuses.PENDING) {
    return null;
  }

  const { diagram } = render;
  const naturalSize = { width: diagram.width, height: diagram.height };
  const title = t(DIAGRAM_TITLE_KEYS[entry.diagramType]);
  return (
    <LightboxZoom naturalSize={naturalSize}>
      <DiagramFrame bounds={ZOOM_SIZED_FRAME} diagram={diagram} title={title} />
    </LightboxZoom>
  );
}
