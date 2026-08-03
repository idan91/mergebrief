// The capped surface for the DB-brief route (BRIEF-20): this push got no
// brief because the repo hit the instance's daily generation cap. NOT a
// failure card — nothing went wrong, and the copy says when it resumes.
// Presentational; the announcement lives in the body's live region.
import cardStyles from "../stateCard.module.scss";
import { cappedLabel } from "./utils";

export interface CappedCardProps {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  cappedAt: string;
}

export function CappedCard({ cappedAt }: CappedCardProps) {
  return (
    <section
      aria-labelledby="capped-heading"
      className={cardStyles["card"]}
      data-testid="brief-capped-card"
    >
      <h1 className={cardStyles["heading"]} id="capped-heading">
        {cappedLabel(cappedAt)}
      </h1>
      <p className={cardStyles["copy"]}>
        This instance limits how many briefs each repository generates per day.
        The next push after the cap resets is briefed normally — this one will
        not be picked up again on its own.
      </p>
    </section>
  );
}
