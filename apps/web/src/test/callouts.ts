import { vi } from "vitest";

import {
  CALLOUT_HOVER_DELAY_MS,
  CALLOUT_WARM_MS,
} from "@web/components/Callout/consts";

const COLD_CLOCK_STEP_MS = 10 * (CALLOUT_WARM_MS + CALLOUT_HOVER_DELAY_MS);

let coldClock = Date.now();

/** Fake timers on a clock past any earlier test's warm callout window. */
export function startColdCalloutTimers(): void {
  coldClock += COLD_CLOCK_STEP_MS;
  vi.useFakeTimers({ now: coldClock });
}
