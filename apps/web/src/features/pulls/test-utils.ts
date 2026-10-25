import type { MockedFunction } from "vitest";

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
