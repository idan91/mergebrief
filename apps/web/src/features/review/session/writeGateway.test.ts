// The gateway's job is the id→anchor resolution. What it must never do is
// report a decision as saved when it had nothing sendable to send.
import { RequestBounds } from "contract";
import { describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "@web/features/brief/model";
import { createSessionWriteGateway } from "./writeGateway";
import type { SessionWrites } from "./writes";
import { CommentAnchorKinds, DraftCommentStatuses } from "types/comments";

const model = buildBriefViewModel(briefFixture);
const flagId = model.flags[0]?.id;
if (flagId === undefined) {
  throw new Error("fixture has no risk flags");
}

const OK = { ok: true as const, value: undefined };

function writesMock(): SessionWrites {
  return {
    setRead: vi.fn(() => Promise.resolve(OK)),
    reclassify: vi.fn(() => Promise.resolve(OK)),
    createDraft: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: "1" }),
    ),
    updateDraft: vi.fn(() => Promise.resolve(OK)),
    reanchorDraft: vi.fn(() => Promise.resolve(OK)),
    deleteDraft: vi.fn(() => Promise.resolve(OK)),
    dismissRisks: vi.fn(() => Promise.resolve(OK)),
    addressRisks: vi.fn(() => Promise.resolve(OK)),
    reopenRisks: vi.fn(() => Promise.resolve(OK)),
    setOutcome: vi.fn(() => Promise.resolve(OK)),
  };
}

describe("createSessionWriteGateway", () => {
  it("sends a resolvable dismissal as one call", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    await expect(
      gateway.dispose([flagId], { kind: "dismissed", reason: "not here" }),
    ).resolves.toEqual(OK);
    expect(writes.dismissRisks).toHaveBeenCalledTimes(1);
  });

  it("fails rather than claiming success when a flag resolves to no anchor", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    const result = await gateway.dispose([flagId, "ghost-flag"], {
      kind: "open",
    });
    expect(result.ok).toBe(false);
    expect(writes.reopenRisks).not.toHaveBeenCalled();
  });

  it("fails rather than dropping an evidence claim with nothing behind it", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    const result = await gateway.address(
      new Map([[flagId, { kind: "manual-note" as const }]]),
    );
    expect(result.ok).toBe(false);
    expect(writes.addressRisks).not.toHaveBeenCalled();
  });

  it("refuses a decision over the flags-per-call bound with its own copy", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    const ids = Array.from(
      { length: RequestBounds.FLAGS_PER_CALL + 1 },
      (_, index) => `flag-${String(index)}`,
    );
    const tooMany = {
      ok: false,
      failure: { frozen: false, copy: "review.writeError.tooManyFlags" },
    };

    await expect(
      gateway.dispose(ids, { kind: "dismissed", reason: "not here" }),
    ).resolves.toEqual(tooMany);
    await expect(gateway.dispose(ids, { kind: "open" })).resolves.toEqual(
      tooMany,
    );
    await expect(
      gateway.address(
        new Map(
          ids.map((id) => [id, { kind: "manual-note" as const, note: "ok" }]),
        ),
      ),
    ).resolves.toEqual(tooMany);
    expect(writes.dismissRisks).not.toHaveBeenCalled();
    expect(writes.reopenRisks).not.toHaveBeenCalled();
    expect(writes.addressRisks).not.toHaveBeenCalled();
  });

  it("refuses a dismiss reason or evidence note over the body bound", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    const long = "x".repeat(RequestBounds.BODY_LENGTH + 1);
    const tooLong = {
      ok: false,
      failure: { frozen: false, copy: "review.writeError.textTooLong" },
    };

    await expect(
      gateway.dispose([flagId], { kind: "dismissed", reason: long }),
    ).resolves.toEqual(tooLong);
    await expect(
      gateway.address(
        new Map([[flagId, { kind: "manual-note" as const, note: long }]]),
      ),
    ).resolves.toEqual(tooLong);
    expect(writes.dismissRisks).not.toHaveBeenCalled();
    expect(writes.addressRisks).not.toHaveBeenCalled();
  });

  it("posts a file comment as kind file with no line fields", async () => {
    const writes = writesMock();
    const gateway = createSessionWriteGateway(model, writes);
    await gateway.createComment({
      anchor: { kind: CommentAnchorKinds.FILE, file: "src/leak.ts" },
      body: "on the file",
      status: DraftCommentStatuses.DRAFT,
      collapsed: false,
    });
    expect(writes.createDraft).toHaveBeenCalledWith({
      kind: CommentAnchorKinds.FILE,
      filePath: "src/leak.ts",
      body: "on the file",
    });
  });
});
