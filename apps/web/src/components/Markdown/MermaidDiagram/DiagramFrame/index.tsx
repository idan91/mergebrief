import type { RenderedDiagram } from "../types";
import { buildFrameStyle } from "../utils";
import styles from "./DiagramFrame.module.scss";

export interface DiagramFrameProps {
  diagram: RenderedDiagram;
  /** The diagram's type, read out as the frame's name. */
  title: string;
}

/**
 * The drawn diagram in a frame with every sandbox flag off: no script, no
 * same origin, no popup and no top-level navigation; a link in a label can
 * still navigate the frame itself. A host narrower than the diagram's
 * readable width scrolls it sideways, from the keyboard too.
 */
export function DiagramFrame({ diagram, title }: DiagramFrameProps) {
  const frameStyle = buildFrameStyle(diagram);
  return (
    <div
      aria-label={title}
      className={styles["scroller"]}
      role="region"
      tabIndex={0}
    >
      <iframe
        className={styles["frame"]}
        sandbox=""
        srcDoc={diagram.srcDoc}
        style={frameStyle}
        title={title}
      />
    </div>
  );
}
