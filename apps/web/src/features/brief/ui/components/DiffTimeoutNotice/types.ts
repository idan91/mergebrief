/** A diff read GitHub did not render in time, and the one way to ask again. */
export interface DiffFetchRetry {
  /** The retry is in flight. */
  readonly pending: boolean;
  /** Failed reads so far; each new one re-announces the notice. */
  readonly failureCount: number;
  readonly retry: () => void;
  /** The notice leaves the page holding focus; the surface moves it on landing. */
  readonly releaseFocus: () => void;
}

/** A surface's timeout retry, and its polite line for the body that lands. */
export interface DiffRetryLanding {
  readonly retry: DiffFetchRetry | undefined;
  /** Text for a status region the surface keeps mounted through both states. */
  readonly announcement: string;
}

/** The part of a diff query's state the notice reads. */
export interface DiffQueryState {
  readonly data: unknown;
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly errorUpdateCount: number;
  refetch(): Promise<unknown>;
}
