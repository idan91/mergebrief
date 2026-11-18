/** Today's runs that claimed more than one unit, and the units they took. */
export interface SpendLargeRuns {
  readonly runs: number;
  readonly units: number;
}

/** What `read-spend` answers: today's started runs against the daily cap. */
export interface SpendView {
  /** Run units this Instance started on the current UTC day, every repository and retry included. */
  readonly startedRuns: number;
  /** The daily cap; absent on an uncapped Instance. */
  readonly cap?: number;
  /** Absent when no run today claimed more than one unit. */
  readonly largeRuns?: SpendLargeRuns;
  /** The UTC day the count covers: its first instant and the instant it resets, ISO 8601. */
  readonly dayStartedAt: string;
  readonly resetsAt: string;
}
