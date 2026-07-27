import { Markdown } from "@web/components/Markdown/Markdown";
import type { Brief } from "../../../types";
import styles from "./DeltaContext.module.scss";

export interface DeltaContextProps {
  brief: Brief;
}

export function DeltaContext({ brief }: DeltaContextProps) {
  return (
    <div className={styles["context"]}>
      {brief.commentsAddressed ? (
        <section>
          <div className={styles["eyebrow"]}>Comments addressed</div>
          <Markdown content={brief.commentsAddressed} />
        </section>
      ) : null}
      {brief.wholePrImpact ? (
        <section>
          <div className={styles["eyebrow"]}>Whole-PR impact</div>
          <p>{brief.wholePrImpact}</p>
        </section>
      ) : null}
    </div>
  );
}
