import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";

export interface ConcernViewProps {
  brief: Brief;
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
}

export function ConcernView({ brief, model, jumpToChunk }: ConcernViewProps) {
  const totalTouched = Math.max(1, model.totalAdded + model.totalDeleted);
  return (
    <section className="concern-view">
      <div className="concern-intro reveal">
        <div className="eyebrow">Attention split</div>
        <p>
          The same {brief.chunks.length} chunks, pivoted by artifact instead of
          intent.
        </p>
      </div>
      {brief.concernView.map((rollup) => {
        const chunks = model.concernChunks.get(rollup.concern) ?? [];
        const pct = ((rollup.added + rollup.deleted) / totalTouched) * 100;
        return (
          <article className="concern-bucket reveal" key={rollup.concern}>
            <div className="cb-head">
              <span className="cb-name">
                <span className="dot" />
                {rollup.concern}
              </span>
              <span className="cb-loc">
                <span className="a">+{rollup.added}</span>{" "}
                <span className="d">−{rollup.deleted}</span>
              </span>
              <span className="cb-count">
                {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="cb-bar">
              <i style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
            <div className="cb-files">
              {chunks.map((chunk) => (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() => jumpToChunk(chunk.id)}
                >
                  {chunk.file}{" "}
                  <span className="floc2">
                    · <span className="a">+{chunk.loc.added}</span>{" "}
                    <span className="d">−{chunk.loc.deleted}</span>
                  </span>
                </button>
              ))}
            </div>
          </article>
        );
      })}
      <div className="concern-bucket muted reveal">
        <div className="cb-head">
          <span className="cb-name muted-name">empty concerns</span>
          <span className="cb-count">
            generated · spec · config may be absent from this local brief
          </span>
        </div>
      </div>
    </section>
  );
}
