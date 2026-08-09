import cardStyles from "../stateCard.module.scss";

/**
 * The default copy promises generation "on the next push" — wrong under the
 * instance drafts-off policy, so the own-draft notice replaces it wholesale.
 */
export function emptyCardCopy(copyOverride: string | undefined): string {
  return (
    copyOverride ??
    "Generation starts automatically on the next push (or a submitted review) in a repository where the App is installed."
  );
}

export interface EmptyCardProps {
  /** Drafts-off notice (own-draft only); replaces the copy. */
  copyOverride?: string | undefined;
}

export function EmptyCard({ copyOverride }: EmptyCardProps) {
  return (
    <section aria-labelledby="empty-heading" className={cardStyles["card"]}>
      <h1 className={cardStyles["heading"]} id="empty-heading">
        No brief for this pull request yet
      </h1>
      <p className={cardStyles["copy"]}>{emptyCardCopy(copyOverride)}</p>
    </section>
  );
}
