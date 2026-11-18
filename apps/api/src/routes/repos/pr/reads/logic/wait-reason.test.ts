import { describe, expect, it } from "vitest";
import { WaitReasons, type WaitReason } from "contract";
import type { GenerateJobTiming, TakeoverJob } from "persistence";
import {
  GenerationStatuses,
  TakeoverJobStates,
  type GenerationStatus,
} from "types/generations";
import { deriveWaitReason } from "./wait-reason";

const STARTS_LATER: GenerateJobTiming = {
  startsLater: true,
  locked: false,
  hasAttemptsLeft: true,
};
const DUE_UNCLAIMED: GenerateJobTiming = {
  startsLater: false,
  locked: false,
  hasAttemptsLeft: true,
};
const DUE_LOCKED: GenerateJobTiming = {
  startsLater: false,
  locked: true,
  hasAttemptsLeft: true,
};
const SPENT: GenerateJobTiming = {
  startsLater: false,
  locked: false,
  hasAttemptsLeft: false,
};
const TAKEOVER_SCHEDULED: TakeoverJob = {
  state: TakeoverJobStates.SCHEDULED,
  runsAt: new Date("2026-10-24T12:00:00Z"),
};
const TAKEOVER_SPENT: TakeoverJob = { state: TakeoverJobStates.SPENT };

interface WaitReasonCase {
  readonly name: string;
  readonly status: GenerationStatus;
  readonly timing: GenerateJobTiming | undefined;
  readonly takeover?: TakeoverJob;
  readonly expected: WaitReason | undefined;
}

const CASES: readonly WaitReasonCase[] = [
  {
    name: "pending with a start time ahead is debouncing",
    status: GenerationStatuses.PENDING,
    timing: STARTS_LATER,
    expected: WaitReasons.DEBOUNCING,
  },
  {
    name: "pending, due and unclaimed is waiting for a slot",
    status: GenerationStatuses.PENDING,
    timing: DUE_UNCLAIMED,
    expected: WaitReasons.WAITING_FOR_SLOT,
  },
  {
    name: "pending with a due locked job has no reason",
    status: GenerationStatuses.PENDING,
    timing: DUE_LOCKED,
    expected: undefined,
  },
  {
    name: "pending with no queued job has no reason",
    status: GenerationStatuses.PENDING,
    timing: undefined,
    expected: undefined,
  },
  {
    name: "pending behind a spent job and no takeover is stalled",
    status: GenerationStatuses.PENDING,
    timing: SPENT,
    expected: WaitReasons.STALLED,
  },
  {
    name: "pending behind a spent job and a spent takeover is stalled",
    status: GenerationStatuses.PENDING,
    timing: SPENT,
    takeover: TAKEOVER_SPENT,
    expected: WaitReasons.STALLED,
  },
  {
    name: "pending behind a spent job with a takeover queued has no reason",
    status: GenerationStatuses.PENDING,
    timing: SPENT,
    takeover: TAKEOVER_SCHEDULED,
    expected: undefined,
  },
  {
    name: "running has no reason even with a future job",
    status: GenerationStatuses.RUNNING,
    timing: STARTS_LATER,
    expected: undefined,
  },
];

describe("deriveWaitReason", () => {
  it.each(CASES)("$name", ({ status, timing, takeover, expected }) => {
    expect(deriveWaitReason(status, timing, takeover)).toBe(expected);
  });
});
