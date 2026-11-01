import type { FrameBounds, RenderedDiagram } from "../types";
import { buildFrameStyle } from "../utils";
import styles from "./DiagramFrame.module.scss";

export interface DiagramFrameProps {
  diagram: RenderedDiagram;
  /** The diagram's type, read out as the frame's name. */
  title: string;
  /** Absent, the frame never draws the diagram's text below the readable scale. */
  bounds?: FrameBounds;
}

/**
 * The drawn diagram in a frame with every sandbox flag off: no script, no
 * same origin, no popup and no top-level navigation; a link in a label can
 * still navigate the frame itself.
 */
export function DiagramFrame({ diagram, title, bounds }: DiagramFrameProps) {
  const frameBounds = bounds ?? { minScale: diagram.readableScale };
  const frameStyle = buildFrameStyle(diagram, frameBounds);
  return (
    <iframe
      className={styles["frame"]}
      sandbox=""
      srcDoc={diagram.srcDoc}
      style={frameStyle}
      title={title}
    />
  );
}
