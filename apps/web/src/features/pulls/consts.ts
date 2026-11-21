import { GenerateNotices } from "./components/PrBrief/trigger-offer";
import { RegenerateResultKinds, type RegenerateNoticeKeys } from "./types";

/** PR meta re-reads at this cadence while a generation is in flight. */
export const IN_FLIGHT_POLL_MS = 4_000;
/** PR meta and the stack chip follow GitHub at this cadence while the tab is visible. */
export const LIVE_POLL_MS = 30_000;
/** A poll held back by an outage waits at least this multiple of its healthy cadence. */
export const OUTAGE_BACKOFF_FACTOR = 2;
/** The longest a poll waits between reads during an outage. */
export const OUTAGE_POLL_MAX_MS = 5 * 60_000;
/** The video asset list is reused this long before a new bare asset line asks again. */
export const VIDEO_ASSETS_STALE_MS = 60_000;
/** How long an unobserved stored brief and its layout stay cached. */
export const BRIEF_READ_GC_MS = 10 * 60_000;

/** Generate now on a held head: a head that stopped being held says so. */
export const HeldGenerateNotices: RegenerateNoticeKeys = {
  ...GenerateNotices,
  [RegenerateResultKinds.NOT_REGENERABLE]: "pulls.held.generate.stale",
};
