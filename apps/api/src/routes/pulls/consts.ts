/**
 * Installations read at once for the session list. Each read is three
 * queries on the shared pool (default size 10), so an unbounded fan-out over
 * a viewer's installations would starve every other request.
 */
export const LIST_INSTALLATION_CONCURRENCY = 3;
