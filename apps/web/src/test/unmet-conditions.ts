import type {
  UnmetAnyGroup,
  UnmetPlainCondition,
} from "types/trigger-conditions";

/** One unmet condition of each shape the held display words differently. */
export const UnmetFixtures = {
  READY_FOR_REVIEW: { kind: "ready-for-review", setBy: "instance" },
  CI_RUNNING: {
    kind: "ci",
    setBy: "repo",
    failed: [],
    running: ["build", "e2e"],
    missing: [],
    permissionMissing: false,
  },
  CI_FAILED: {
    kind: "ci",
    setBy: "repo",
    failed: ["test"],
    running: ["e2e"],
    missing: [],
    permissionMissing: false,
  },
  BOT_RUNNING: {
    kind: "bots",
    setBy: "repo",
    bot: "coderabbit",
    verdict: "finished",
    state: "running",
  },
  BOT_NOT_APPROVED: {
    kind: "bots",
    setBy: "repo",
    bot: "coderabbit",
    verdict: "approved",
    state: "not-approved",
  },
  SIZE_OVER: {
    kind: "size",
    setBy: "instance",
    measure: "changed-lines",
    side: "max",
    limit: 800,
    actual: 1284,
  },
  LABELS: { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
} as const satisfies Record<string, UnmetPlainCondition>;

/** An `any` group none of whose members passed. */
export function makeAnyGroup(
  ...conditions: UnmetPlainCondition[]
): UnmetAnyGroup {
  return { kind: "any", conditions };
}
