import type { Brief } from "../../types";
import { Fragment } from "react";

import { ScreenReaderOnly } from "../../../../components/ScreenReaderOnly";
import { riskChipView, type BriefViewModel } from "../../viewModel";
import { RiskBadge } from "../Badge/RiskBadge";
import { RiskChipDisclosure } from "../Badge/RiskChipDisclosure";
import { RiskDetailList } from "../Badge/RiskDetailList";
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
                <Fragment key={chunk.id}>
                  <button type="button" onClick={() => jumpToChunk(chunk.id)}>
                    {chunk.file}{" "}
                    <span className={styles["fileLoc"]}>
                      · <span className="a">+{chunk.loc.added}</span>{" "}
                      <span className="d">−{chunk.loc.deleted}</span>
                    </span>
                    {chunk.riskSurface.length > 0 ? (
                      /* Same display weight as the Story view (BRIEF-52):
                       chips are display-only here — the row itself is the
                       jump button, so no nested disclosure buttons. */
                      <span className={styles["fileRisk"]} data-concern-risk="">
                        {riskChipView(chunk.riskSurface).shown.map((risk) => (
                          <RiskBadge
                            key={risk}
                            meta={model.riskMetaByChunk
                              .get(chunk.id)
                              ?.get(risk)}
                          >
                            {risk}
                          </RiskBadge>
                        ))}
                        {riskChipView(chunk.riskSurface).overflow.length > 0 ? (
                          <RiskBadge>
                            +{riskChipView(chunk.riskSurface).overflow.length}
                            <ScreenReaderOnly>
                              {` more: ${riskChipView(chunk.riskSurface).overflow.join(", ")}`}
                            </ScreenReaderOnly>
                          </RiskBadge>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                  {riskChipView(chunk.riskSurface).overflow.length > 0 ||
                  chunk.riskSurface.some((risk) => {
                    const meta = model.riskMetaByChunk.get(chunk.id)?.get(risk);
                    return (
                      meta?.source === "repo-policy" ||
                      meta?.deEmphasized === true
                    );
                  }) ? (
                    /* Keyboard/touch expansion for the WHOLE chunk's risk
                       detail (shown chips are inert inside the jump button;
                       nested interactive elements are invalid). */
                    <RiskChipDisclosure
                      detail={
                        <RiskDetailList
                          attrs={chunk.riskSurface}
                          metaFor={(attr) =>
                            model.riskMetaByChunk.get(chunk.id)?.get(attr)
                          }
                        />
                      }
                    >
                      <RiskBadge>
                        risk details
                        <ScreenReaderOnly>{` for ${chunk.file}`}</ScreenReaderOnly>
                      </RiskBadge>
                    </RiskChipDisclosure>
                  ) : null}
                </Fragment>
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
