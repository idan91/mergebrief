// The gateway's job is the id→anchor resolution. What it must never do is
// report a decision as saved when it had nothing sendable to send.
import { describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { createSessionWriteGateway } from "./writeGateway";
import type { SessionWrites } from "./writes";

const model = buildBriefViewModel(briefFixture);
const flagId = model.flags[0]?.id;
if (flagId === undefined) throw new Error("fixture has no risk flags");

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
});
