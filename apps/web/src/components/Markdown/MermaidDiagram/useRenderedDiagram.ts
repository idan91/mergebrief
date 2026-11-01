import { useEffect, useState } from "react";

import { drawMermaidDiagram, type DiagramRenderResult } from "./draw-diagram";
import { DiagramRenderStatuses, type DiagramRender } from "./types";

interface SettledRender {
  readonly code: string;
  readonly result: DiagramRenderResult;
}

const PENDING_RENDER: DiagramRender = { status: DiagramRenderStatuses.PENDING };
const FAILED_RENDER: DiagramRender = { status: DiagramRenderStatuses.FAILED };

/** The diagram `code` draws, pending until Mermaid answers; rendered in the browser only. */
export function useRenderedDiagram(code: string): DiagramRender {
  const [settled, setSettled] = useState<SettledRender | undefined>();

  useEffect(() => {
    let current = true;
    async function settle(): Promise<void> {
      const result = await drawMermaidDiagram(code);
      if (current) {
        setSettled({ code, result });
      }
    }

    void settle();
    return () => {
      current = false;
    };
  }, [code]);

  if (settled?.code !== code) {
    return PENDING_RENDER;
  }
  if (!settled.result.ok) {
    return FAILED_RENDER;
  }
  return {
    status: DiagramRenderStatuses.RENDERED,
    diagram: settled.result.value,
  };
}
