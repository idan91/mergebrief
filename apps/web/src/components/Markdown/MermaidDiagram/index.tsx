import { readDiagramType } from "brief-core/media";
import { useTranslation } from "react-i18next";

import { DIAGRAM_TITLE_KEYS } from "./consts";
import { DiagramFrame } from "./DiagramFrame";
import { DiagramSource } from "./DiagramSource";
import { DiagramRenderStatuses } from "./types";
import { useRenderedDiagram } from "./useRenderedDiagram";
import styles from "./MermaidDiagram.module.scss";

export interface MermaidDiagramProps {
  /** The fence's code as the sanitized tree holds it. */
  code: string;
}

/**
 * A Mermaid fence drawn as a diagram in a sandboxed frame, its source one
 * disclosure away. Mermaid loads only once a diagram mounts; a fence it
 * cannot draw stays a code block under a one-line note.
 */
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { t } = useTranslation();
  const render = useRenderedDiagram(code);

  if (render.status === DiagramRenderStatuses.FAILED) {
    return (
      <div
        className={styles["diagram"]}
        data-state={render.status}
        data-testid="mermaid-diagram"
      >
        <p className={styles["note"]}>{t("shell.media.diagramFailed")}</p>
        <pre>
          <code className="language-mermaid">{code}</code>
        </pre>
      </div>
    );
  }

  const title = t(DIAGRAM_TITLE_KEYS[readDiagramType(code)]);
  return (
    <div
      className={styles["diagram"]}
      data-state={render.status}
      data-testid="mermaid-diagram"
    >
      {render.status === DiagramRenderStatuses.RENDERED ? (
        <DiagramFrame diagram={render.diagram} title={title} />
      ) : (
        <div aria-hidden="true" className={styles["pending"]} />
      )}
      <DiagramSource code={code} />
    </div>
  );
}
