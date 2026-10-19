/** What `read-spend` answers: today's started runs against the daily cap. */
export interface SpendView {
  /** Runs this Instance started on the current UTC day, every repository and retry included. */
  readonly startedRuns: number;
  /** The daily cap; absent on an uncapped Instance. */
  readonly cap?: number;
  /** The UTC day the count covers: its first instant and the instant it resets, ISO 8601. */
  readonly dayStartedAt: string;
  readonly resetsAt: string;
}
