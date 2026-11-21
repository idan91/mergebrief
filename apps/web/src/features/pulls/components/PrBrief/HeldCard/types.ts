/** What the held panel renders: its lead, whether it lists conditions, and Generate. */
export interface HeldCardFacade {
  readonly lead: string;
  /** False once the pull request is no longer open. */
  readonly showsConditions: boolean;
  readonly pending: boolean;
  readonly announcement: string;
  /** Absent where the viewer may not generate. */
  readonly onGenerate?: (() => void) | undefined;
}
