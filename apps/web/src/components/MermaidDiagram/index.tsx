import { readDiagramType } from "brief-core/media";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { DIAGRAM_TITLE_KEYS } from "./consts";
import { DiagramFailed } from "./DiagramFailed";
import { DiagramFrame } from "./DiagramFrame";
import { DiagramPreview } from "./DiagramPreview";
import { DiagramSource } from "./DiagramSource";
import { DiagramRenderStatuses, type DiagramPreviewOptions } from "./types";
import { useRenderedDiagram } from "./useRenderedDiagram";
import styles from "./MermaidDiagram.module.scss";

export interface MermaidDiagramProps {
  /** The fence's code as the sanitized tree holds it. */
  code: string;
  /** Draws a capped preview that opens larger; absent, a readable diagram that scrolls sideways. */
  preview?: DiagramPreviewOptions;
}

/**
 * A Mermaid fence drawn as a diagram in a sandboxed frame, its source one
 * disclosure away. Mermaid loads only once a diagram mounts; a fence it
 * cannot draw stays a code block under a one-line note. A host narrower
 * than the diagram's readable width scrolls it sideways, from the keyboard
 * too.
 */
export function MermaidDiagram({ code, preview }: MermaidDiagramProps) {
  const { t } = useTranslation();
  const render = useRenderedDiagram(code);

  if (render.status === DiagramRenderStatuses.FAILED) {
    return (
      <div
        className={styles["diagram"]}
        data-state={render.status}
        data-testid="mermaid-diagram"
      >
        <DiagramFailed code={code} />
      </div>
    );
  }

  const title = t(DIAGRAM_TITLE_KEYS[readDiagramType(code)]);
  let drawn: ReactNode;
  if (render.status === DiagramRenderStatuses.PENDING) {
    drawn = <div aria-hidden="true" className={styles["pending"]} />;
  } else if (preview === undefined) {
    drawn = (
      <div
        aria-label={title}
        className={styles["scroller"]}
        role="region"
        tabIndex={0}
      >
        <DiagramFrame diagram={render.diagram} title={title} />
      </div>
    );
  } else {
    drawn = (
      <DiagramPreview
        diagram={render.diagram}
        preview={preview}
        title={title}
      />
    );
  }

  return (
    <div
      className={styles["diagram"]}
      data-state={render.status}
      data-testid="mermaid-diagram"
    >
      {drawn}
      <DiagramSource code={code} />
    </div>
  );
}
