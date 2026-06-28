import { Markdown } from "../../../../components/Markdown/Markdown";
import type { Brief } from "../../types";

export interface DeltaContextProps {
  brief: Brief;
}

export function DeltaContext({ brief }: DeltaContextProps) {
  return (
    <div className="delta-context">
      {brief.commentsAddressed ? (
        <section>
          <div className="eyebrow">Comments addressed</div>
          <Markdown content={brief.commentsAddressed} />
        </section>
      ) : null}
      {brief.wholePrImpact ? (
        <section>
          <div className="eyebrow">Whole-PR impact</div>
          <p>{brief.wholePrImpact}</p>
        </section>
      ) : null}
    </div>
  );
}
