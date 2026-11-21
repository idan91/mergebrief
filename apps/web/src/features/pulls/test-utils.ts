import { QueryClient } from "@tanstack/react-query";
import type { MockedFunction } from "vitest";
import type {
  UnmetAnyGroup,
  UnmetPlainCondition,
} from "types/trigger-conditions";

import type { apiFetch } from "../../data/apiFetch";

/** Answers the mocked `apiFetch` with `status`, and a refusal body naming `code` when one is given. */
export function answerApiFetch(
  apiFetchMock: MockedFunction<typeof apiFetch>,
  status: number,
  code?: string,
): void {
  const body =
    code === undefined ? null : JSON.stringify({ error: "refused", code });
  apiFetchMock.mockResolvedValue(new Response(body, { status }));
}

/** A query client that fails a query at once instead of retrying it. */
export function stubQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** One unmet condition of each shape the held display words differently. */
export const UnmetFixtures = {
  READY_FOR_REVIEW: { kind: "ready-for-review", source: "instance" },
  CI_RUNNING: {
    kind: "ci",
    source: "repo",
    failed: [],
    running: ["build", "e2e"],
    missing: [],
    permissionMissing: false,
  },
  CI_FAILED: {
    kind: "ci",
    source: "repo",
    failed: ["test"],
    running: ["e2e"],
    missing: [],
    permissionMissing: false,
  },
  BOT_RUNNING: {
    kind: "bots",
    source: "repo",
    bot: "coderabbit",
    verdict: "finished",
    state: "running",
  },
  BOT_NOT_APPROVED: {
    kind: "bots",
    source: "repo",
    bot: "coderabbit",
    verdict: "approved",
    state: "not-approved",
  },
  SIZE_OVER: {
    kind: "size",
    source: "instance",
    count: "changed-lines",
    side: "max",
    limit: 800,
    actual: 1284,
  },
  LABELS: { kind: "labels", source: "repo", labels: ["needs-brief"] },
} as const satisfies Record<string, UnmetPlainCondition>;

/** An `any` group none of whose members passed. */
export function makeAnyGroup(
  ...conditions: UnmetPlainCondition[]
): UnmetAnyGroup {
  return { kind: "any", conditions };
}
