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
import { DiffSides } from "types/comments";

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
  apiFetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

function respondEmpty(): void {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
}

function listRequests(): readonly [string, string | undefined][] {
  return apiFetchMock.mock.calls.map((call) => [call[0], call[1]?.method]);
}

const FLAG = {
  filePath: "a.ts",
  attribute: "risk",
  regionStart: 1,
  regionEnd: 9,
};

describe("createSessionWrites", () => {
  it("marks a chunk read and unread through the POST verb pair", async () => {
    const base = "/api/repos/424242/pulls/7/session";
    respondEmpty();
    await expect(writes.setRead("chunk/a", true)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(writes.setRead("chunk/a", false)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(listRequests()).toEqual([
      [`${base}/chunks/chunk%2Fa/read?${SPAN}`, "POST"],
      [`${base}/chunks/chunk%2Fa/unread?${SPAN}`, "POST"],
    ]);
    expect(apiFetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("builds every write from its operation row", async () => {
    const base = "/api/repos/424242/pulls/7/session";
    respondEmpty();
    await writes.updateDraft("41", "edited");
    await writes.reanchorDraft("41", { kind: "file", filePath: "a.ts" });
    await writes.deleteDraft("41");
    await writes.reclassify("g/1", "bugfix");
    expect(listRequests()).toEqual([
      [`${base}/comments/41?${SPAN}`, "PATCH"],
      [`${base}/comments/41/anchor?${SPAN}`, "PUT"],
      [`${base}/comments/41?${SPAN}`, "DELETE"],
      [`${base}/groups/g%2F1/classification?${SPAN}`, "PUT"],
    ]);

    respond(200, { count: 1 });
    await writes.dismissRisks([FLAG], "covered");
    await writes.addressRisks([
      { ...FLAG, evidence: { kind: "manual-note", ref: "checked" } },
    ]);
    await writes.reopenRisks([FLAG]);
    expect(listRequests()).toEqual([
      [`${base}/risks/dismiss?${SPAN}`, "POST"],
      [`${base}/risks/address?${SPAN}`, "POST"],
      [`${base}/risks/reopen?${SPAN}`, "POST"],
    ]);

    respond(200, { outcome: "approve" });
    await writes.setOutcome("approve");
    expect(listRequests()).toEqual([[`${base}/outcome?${SPAN}`, "PUT"]]);

    respond(201, { draftId: "9" });
    await writes.createDraft({ kind: "file", filePath: "a.ts", body: "x" });
    expect(listRequests()).toEqual([[`${base}/comments?${SPAN}`, "POST"]]);
  });

  it("reads a 204 as success without parsing a body", async () => {
    respondEmpty();
    await expect(writes.updateDraft("41", "edited")).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      writes.reanchorDraft("41", { kind: "file", filePath: "a.ts" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(writes.deleteDraft("41")).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(writes.reclassify("g1", "bugfix")).resolves.toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("sends a bulk dismissal as ONE call carrying the array", async () => {
    respond(200, { count: 2 });
    const flags = [FLAG, { ...FLAG, filePath: "b.ts" }];
    await expect(writes.dismissRisks(flags, "not applicable")).resolves.toEqual(
      { ok: true, value: undefined },
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ flags, reason: "not applicable" }),
    );
  });

  it("reports a risk answer with no count as indeterminate", async () => {
    respond(200, { flags: 2 });
    await expect(writes.reopenRisks([FLAG])).resolves.toEqual({
      ok: false,
      failure: { frozen: false, copy: "review.writeError.failed" },
    });
  });

  it("returns the server draft id that post-now addresses", async () => {
    respond(201, { draftId: "9001" });
    await expect(
      writes.createDraft({
        filePath: "a.ts",
        side: DiffSides.NEW,
        startLine: 3,
        endLine: 3,
        body: "look here",
      }),
    ).resolves.toEqual({ ok: true, value: "9001" });
  });

  it("keeps a landed draft whose answer carries no id", async () => {
    respond(201, {});
    await expect(
      writes.createDraft({ kind: "file", filePath: "a.ts", body: "x" }),
    ).resolves.toEqual({ ok: true, value: "" });
  });

  it("treats a 409 frozen session as terminal, not a per-action failure", async () => {
    for (const code of ["pr-changed-since-read", "pr-rewritten-since-read"]) {
      respond(409, { error: "conflict", code });
      const frozen = {
        ok: false,
        failure: { frozen: true, copy: "review.writeError.frozen" },
      };
      await expect(writes.setRead("chunk-a", true)).resolves.toEqual(frozen);
      await expect(writes.deleteDraft("41")).resolves.toEqual(frozen);
    }
  });

  it("maps each newly reachable wire code to its own copy", async () => {
    for (const [status, code, copy] of [
      [409, "draft-limit-reached", "review.writeError.draftLimit"],
      [409, "session-record-limit-reached", "review.writeError.recordLimit"],
      [409, "draft-already-published", "review.writeError.alreadyPublished"],
      [409, "draft-publish-pending", "review.writeError.publishPending"],
      [409, "draft-publish-in-doubt", "review.writeError.publishInDoubt"],
      [403, "human-only", "review.writeError.humanOnly"],
      [401, "unauthorized", "review.writeError.unauthorized"],
      [401, "signed-out", "review.writeError.unauthorized"],
      [400, "bad-request", "review.writeError.failed"],
    ] as const) {
      respond(status, { error: "no", code });
      const failure = { ok: false, failure: { frozen: false, copy } };
      await expect(writes.setOutcome("comment")).resolves.toEqual(failure);
      await expect(writes.setRead("chunk-a", true)).resolves.toEqual(failure);
    }
  });

  it("reports a thrown request as indeterminate, not as nothing happened", async () => {
    apiFetchMock.mockReset();
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const indeterminate = {
      ok: false,
      failure: { frozen: false, copy: "review.writeError.failed" },
    };
    await expect(writes.setRead("chunk-a", false)).resolves.toEqual(
      indeterminate,
    );
    await expect(writes.updateDraft("41", "x")).resolves.toEqual(indeterminate);
  });

  it("reports a gateway timeout as indeterminate", async () => {
    respond(504, "upstream timed out");
    await expect(writes.deleteDraft("41")).resolves.toEqual({
      ok: false,
      failure: { frozen: false, copy: "review.writeError.failed" },
    });
  });
});
