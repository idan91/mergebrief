/** The held head's reason as the row's second line prints it. */
export interface HeldReason {
  /** The first unmet item, blocker first, in the Entry's words. */
  readonly text: string;
  /** Unmet items past the first. */
  readonly more: number;
}
