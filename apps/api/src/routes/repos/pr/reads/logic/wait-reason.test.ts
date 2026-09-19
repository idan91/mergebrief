import { describe, expect, it } from "vitest";
import { WaitReasons, type WaitReason } from "contract";
import {
  GenerationStatuses,
  type GenerateJobTiming,
  type GenerationStatus,
} from "persistence";
import { deriveWaitReason } from "./wait-reason";

const STARTS_LATER: GenerateJobTiming = { startsLater: true, locked: false };
const DUE_UNCLAIMED: GenerateJobTiming = { startsLater: false, locked: false };
const DUE_LOCKED: GenerateJobTiming = { startsLater: false, locked: true };
const LATER_LOCKED: GenerateJobTiming = { startsLater: true, locked: true };

interface WaitReasonCase {
  readonly name: string;
  readonly status: GenerationStatus;
  readonly timing: GenerateJobTiming | undefined;
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
    name: "pending with a locked job scheduled later has no reason",
    status: GenerationStatuses.PENDING,
    timing: LATER_LOCKED,
    expected: undefined,
  },
  {
    name: "pending with no queued job has no reason",
    status: GenerationStatuses.PENDING,
    timing: undefined,
    expected: undefined,
  },
  {
    name: "running has no reason even with a future job",
    status: GenerationStatuses.RUNNING,
    timing: STARTS_LATER,
    expected: undefined,
  },
  {
    name: "succeeded has no reason even with a due job",
    status: GenerationStatuses.SUCCEEDED,
    timing: DUE_UNCLAIMED,
    expected: undefined,
  },
  {
    name: "failed has no reason",
    status: GenerationStatuses.FAILED,
    timing: DUE_UNCLAIMED,
    expected: undefined,
  },
];

describe("deriveWaitReason", () => {
  it.each(CASES)("$name", ({ status, timing, expected }) => {
    expect(deriveWaitReason(status, timing)).toBe(expected);
  });
});
