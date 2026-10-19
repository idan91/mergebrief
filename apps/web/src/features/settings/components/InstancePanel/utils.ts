import type { SpendView } from "../../types";
import {
  MAX_TICKS,
  MINUTES_PER_HOUR,
  MS_PER_MINUTE,
  NEAR_CAP_SHARE,
} from "./consts";
import {
  SpendLevels,
  type CountSentenceKey,
  type SpendLevel,
  type SpendReading,
} from "./types";

function deriveSpendLevel(view: SpendView): SpendLevel {
  if (view.cap === undefined) {
    return SpendLevels.UNCAPPED;
  }
  if (view.startedRuns >= view.cap) {
    return SpendLevels.CAPPED;
  }
  const share = view.startedRuns / view.cap;
  if (share >= NEAR_CAP_SHARE) {
    return SpendLevels.NEAR;
  }
  return SpendLevels.CLEAR;
}

function formatResetRelative(resetsAt: Date, now: Date, locale: string) {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const msLeft = resetsAt.getTime() - now.getTime();
  const minutesLeft = Math.max(1, Math.round(msLeft / MS_PER_MINUTE));
  if (minutesLeft < MINUTES_PER_HOUR) {
    const inMinutes = relative.format(minutesLeft, "minute");
    return inMinutes;
  }
  const hoursLeft = Math.round(minutesLeft / MINUTES_PER_HOUR);
  const inHours = relative.format(hoursLeft, "hour");
  return inHours;
}

/** The spend as the panel says it, read at `now`; `timeZone` absent is the viewer's own. */
export function deriveSpendReading(
  view: SpendView,
  now: Date,
  locale: string,
  timeZone?: string,
): SpendReading {
  const resetsAt = new Date(view.resetsAt);
  const clock: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const localClock = new Intl.DateTimeFormat(locale, { ...clock, timeZone });
  const utcClock = new Intl.DateTimeFormat(locale, {
    ...clock,
    timeZone: "UTC",
  });
  const resetLocal = localClock.format(resetsAt);
  const resetUtc = utcClock.format(resetsAt);
  const readAtLocal = localClock.format(now);
  const level = deriveSpendLevel(view);
  const resetRelative = formatResetRelative(resetsAt, now, locale);
  const localIsUtc = resetLocal === resetUtc;

  return {
    level,
    resetLocal,
    resetUtc,
    resetRelative,
    localIsUtc,
    readAtLocal,
  };
}

/** Under the cap, at it, or past it: a cap lowered mid-day leaves the count above it. */
export function resolveCountKey(
  startedRuns: number,
  cap: number,
): CountSentenceKey {
  if (startedRuns > cap) {
    return "spend.overCap";
  }
  if (startedRuns === cap) {
    return "spend.allUsed";
  }
  return "spend.startedOfCap";
}

/** One tick per run up to fifty; a started run always shows as a tick. */
export function deriveTickFills(
  startedRuns: number,
  cap: number,
): readonly boolean[] {
  const count = Math.min(cap, MAX_TICKS);
  const counted = Math.min(startedRuns, cap);
  const scaled = Math.floor((counted * count) / cap);
  const filled = startedRuns > 0 ? Math.max(1, scaled) : 0;
  const fills = Array.from({ length: count }, (_, index) => index < filled);
  return fills;
}
