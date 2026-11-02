// The worker's own `audit_log.operation` token: the job runs off the request
// path, so it names itself rather than a Product Operation descriptor.
export const AUDIT_OPERATION_GENERATE = "generate";

export const DEFAULT_HEAD_POLL_INTERVAL_MS = 20_000;

/** The row claim's lease, renewed on each head-poll tick. */
export const CLAIM_LEASE_MS = 120_000;

/** A follow-up or recovery job starts this long after the holder's lease ends. */
export const AFTER_LEASE_MARGIN_SECONDS = 5;

export const MS_PER_SECOND = 1000;

/** The generating Entry's estimate for a multi-call run: a detail call's wall time, the grouping and merge around them, and the step it is rounded to. */
export const DETAIL_CALL_MINUTES = 3;
export const MULTI_CALL_SETUP_MINUTES = 5;
export const ESTIMATE_STEP_MINUTES = 5;

/** The most of the default branch's `.gitattributes` read; brief-core parses no more than this. */
export const GITATTRIBUTES_MAX_BYTES = 65_536;
export const GITATTRIBUTES_PATH = ".gitattributes";

/** The Entry sync waits this long, so a run's own post lands first and the sync finds it live. */
export const ENTRY_SYNC_DELAY_SECONDS = 30;

export const HTTP_STATUS_REQUEST_TIMEOUT = 408;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
/** Every status at or above this is a server-side failure worth a retry. */
export const HTTP_STATUS_SERVER_ERROR_FLOOR = 500;
