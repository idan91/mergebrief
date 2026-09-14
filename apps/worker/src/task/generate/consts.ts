// The worker's own `audit_log.operation` token: the job runs off the request
// path, so it names itself rather than a Product Operation descriptor.
export const AUDIT_OPERATION_GENERATE = "generate";

export const DEFAULT_HEAD_POLL_INTERVAL_MS = 20_000;

/** GitHub refuses to render the diff (too large); permanent per span. */
export const HTTP_STATUS_NOT_ACCEPTABLE = 406;
export const HTTP_STATUS_REQUEST_TIMEOUT = 408;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
/** Every status at or above this is a server-side failure worth a retry. */
export const HTTP_STATUS_SERVER_ERROR_FLOOR = 500;
