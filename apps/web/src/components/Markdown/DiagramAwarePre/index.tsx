import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { readMarkedFenceCode } from "../diagram-fences";
import { MermaidDiagram } from "@web/components/MermaidDiagram";

export type DiagramAwarePreProps = ComponentProps<"pre"> & ExtraProps;

/** The renderer's `pre`: a Mermaid fence the fence step marked draws as a diagram, anything else stays a code block. */
export function DiagramAwarePre({
  node,
  children,
  ...props
}: DiagramAwarePreProps) {
  const code = readMarkedFenceCode(node);
  if (code === undefined) {
    return <pre {...props}>{children}</pre>;
  }
  return <MermaidDiagram code={code} />;
}
