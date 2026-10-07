// The session write transport: ONE request per action, each naming its Brief,
// and every wire code the session routes can return mapped to copy that tells
// the reviewer the truth.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { createSessionWrites } from "./writes";
import { CommentSides } from "../utils/comments";

const apiFetchMock = vi.mocked(apiFetch);
const TARGET = {
  repoId: "424242",
  prNumber: 7,
  base: "b".repeat(40),
  head: "a".repeat(40),
};
const SPAN = `base=${TARGET.base}&head=${TARGET.head}`;
const writes = createSessionWrites(TARGET);

function respond(status: number, body: unknown = {}): void {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
}

describe("createSessionWrites", () => {
  it("sends exactly one request per action, each naming its Brief", async () => {
    respond(200);
    await writes.setRead("chunk-a", true);
    await writes.reclassify("g1", "bugfix");
    await writes.setOutcome("approve");
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    expect(apiFetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/api/repos/424242/pulls/7/session/chunks/chunk-a/read?${SPAN}`,
      `/api/repos/424242/pulls/7/session/groups/g1/classification?${SPAN}`,
      `/api/repos/424242/pulls/7/session/outcome?${SPAN}`,
    ]);
  });

  it("sends a bulk dismissal as ONE call carrying the array", async () => {
    respond(200, { flags: 2 });
    const flags = [
      { filePath: "a.ts", attribute: "risk", regionStart: 1, regionEnd: 9 },
      { filePath: "b.ts", attribute: "risk", regionStart: 2, regionEnd: 4 },
    ];
    await writes.dismissRisks(flags, "not applicable");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ flags, reason: "not applicable" }),
    );
  });

  it("returns the server draft id that post-now addresses", async () => {
    respond(201, { draftId: "9001" });
    await expect(
      writes.createDraft({
        filePath: "a.ts",
        side: CommentSides.NEW,
        startLine: 3,
        endLine: 3,
        body: "look here",
      }),
    ).resolves.toEqual({ ok: true, value: "9001" });
  });

  it("treats a 409 frozen session as terminal, not a per-action failure", async () => {
    for (const code of ["pr-changed-since-read", "pr-rewritten-since-read"]) {
      respond(409, { error: "conflict", code });
      await expect(writes.setRead("chunk-a", true)).resolves.toEqual({
        ok: false,
        failure: { frozen: true, copy: "review.writeError.frozen" },
      });
    }
  });

  it("maps each newly reachable wire code to its own copy", async () => {
    for (const [status, code, copy] of [
      [409, "draft-limit-reached", "review.writeError.draftLimit"],
      [409, "session-record-limit-reached", "review.writeError.recordLimit"],
      [409, "draft-already-published", "review.writeError.alreadyPublished"],
      [403, "human-only", "review.writeError.humanOnly"],
      [401, "unauthorized", "review.writeError.unauthorized"],
    ] as const) {
      respond(status, { error: "no", code });
      await expect(writes.setOutcome("comment")).resolves.toEqual({
        ok: false,
        failure: { frozen: false, copy },
      });
    }
  });

  it("reports a thrown request as indeterminate, not as nothing happened", async () => {
    apiFetchMock.mockReset();
    apiFetchMock.mockRejectedValue(new Error("offline"));
    await expect(writes.setRead("chunk-a", false)).resolves.toEqual({
      ok: false,
      failure: { frozen: false, copy: "review.writeError.failed" },
    });
  });
});
