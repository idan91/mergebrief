import cardStyles from "../stateCard.module.scss";

export interface FailedCardProps {
  error: string | null;
  attempts: number;
}

export function FailedCard({ error, attempts }: FailedCardProps) {
  return (
    <section aria-labelledby="failed-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="failed-heading">
        Brief generation failed
      </h1>
      <p className={cardStyles["copy"]}>
        {/* Sanitized at write time (first line, URLs redacted, capped). */}
        {error ?? "No failure detail was recorded."}
      </p>
      <p className={cardStyles["meta"]}>
        {attempts + 1} attempt{attempts === 0 ? "" : "s"} so far. A new push
        re-queues generation automatically.
      </p>
    </section>
  );
}
