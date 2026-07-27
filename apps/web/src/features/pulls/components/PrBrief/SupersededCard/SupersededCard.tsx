import cardStyles from "../stateCard.module.scss";

export function SupersededCard() {
  return (
    <section
      aria-labelledby="superseded-heading"
      className={cardStyles["card"]}
    >
      <h1 className={cardStyles["heading"]} id="superseded-heading">
        A newer revision is on the way
      </h1>
      <span aria-hidden="true" className={cardStyles["spinner"]} />
      <p className={cardStyles["copy"]}>
        This push was superseded before its brief finished; the brief for the
        newest push will appear here automatically.
      </p>
    </section>
  );
}
