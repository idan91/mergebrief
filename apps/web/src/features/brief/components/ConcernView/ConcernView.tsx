import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import styles from "./ConcernView.module.scss";

export interface ConcernViewProps {
  brief: Brief;
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
}

export function ConcernView({ brief, model, jumpToChunk }: ConcernViewProps) {
  const totalTouched = Math.max(1, model.totalAdded + model.totalDeleted);
  return (
    <section>
      <div className={`${styles["intro"]} reveal`}>
        <div className={styles["eyebrow"]}>Attention split</div>
        <p>
          The same {brief.chunks.length} chunks, pivoted by artifact instead of
          intent.
        </p>
      </div>
      {brief.concernView.map((rollup) => {
        const chunks = model.concernChunks.get(rollup.concern) ?? [];
        const pct = ((rollup.added + rollup.deleted) / totalTouched) * 100;
        return (
          <article
            className={`${styles["bucket"]} reveal`}
            key={rollup.concern}
          >
            <div className={styles["head"]}>
              <span className={styles["name"]}>
                <span className={styles["dot"]} />
                {rollup.concern}
              </span>
              <span className={styles["loc"]}>
                <span className="a">+{rollup.added}</span>{" "}
                <span className="d">−{rollup.deleted}</span>
              </span>
              <span className={styles["count"]}>
                {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles["bar"]}>
              <i style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
            <div className={styles["files"]}>
              {chunks.map((chunk) => (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() => jumpToChunk(chunk.id)}
                >
                  {chunk.file}{" "}
                  <span className={styles["fileLoc"]}>
                    · <span className="a">+{chunk.loc.added}</span>{" "}
                    <span className="d">−{chunk.loc.deleted}</span>
                  </span>
                </button>
              ))}
            </div>
          </article>
        );
      })}
      <div className={`${styles["bucket"]} reveal`} data-muted="">
        <div className={styles["head"]}>
          <span className={styles["name"]} data-muted="">
            empty concerns
          </span>
          <span className={styles["count"]}>
            generated · spec · config may be absent from this local brief
          </span>
        </div>
      </div>
    </section>
  );
}
