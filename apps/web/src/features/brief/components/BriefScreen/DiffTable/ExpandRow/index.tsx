import type { ExpandableEdge } from "../../../../types";
import { ExpandControl, type ExpandedEvent } from "../ExpandControl";

export interface ExpandRowProps {
  edges: ExpandableEdge[];
  columnCount: number;
  path: string;
  hiddenThreadLines: readonly number[];
  onExpanded: (event: ExpandedEvent) => void;
  onAbandoned: (edgeKey: string) => void;
}

/** A row of its own for the expand control, where no hunk row hosts it. */
export function ExpandRow({
  edges,
  columnCount,
  path,
  hiddenThreadLines,
  onExpanded,
  onAbandoned,
}: ExpandRowProps) {
  return (
    <tr data-line-kind="expand">
      <ExpandControl
        columnCount={columnCount}
        edges={edges}
        hiddenThreadLines={hiddenThreadLines}
        onAbandoned={onAbandoned}
        onExpanded={onExpanded}
        path={path}
      />
    </tr>
  );
}
