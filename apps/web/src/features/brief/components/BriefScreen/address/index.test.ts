import { describe, expect, it } from "vitest";

import { DiffSides } from "types";
import type { LineSelection } from "@web/features/review/utils";
import { deriveAddress } from "./index";
import { AddressEventKinds, type AddressState } from "./types";

const SELECTION: LineSelection = {
  chunkId: "c1",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 10,
  endLine: 12,
  rowIds: [],
};
const SELECTION_LINK = "c1.R10-R12";

function makeState(overrides: Partial<AddressState> = {}): AddressState {
  return {
    lineSelection: undefined,
    focusMode: false,
    scope: "full",
    activeChunkId: undefined,
    url: { link: undefined, focus: false },
    writtenLink: undefined,
    ...overrides,
  };
}

describe("deriveAddress", () => {
  it("Lines selected", () => {
    const outcome = deriveAddress(makeState({ lineSelection: SELECTION }));

    expect(outcome.address.link).toBe(SELECTION_LINK);
    expect(outcome.writtenLink).toBe(SELECTION_LINK);
  });

  it("Selection cleared, URL holds the line link this page wrote", () => {
    const outcome = deriveAddress(
      makeState({
        url: { link: SELECTION_LINK, focus: false },
        writtenLink: SELECTION_LINK,
      }),
    );

    expect(outcome.address.link).toBeUndefined();
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("Selection cleared, URL holds a chunk link this page wrote", () => {
    const outcome = deriveAddress(
      makeState({ url: { link: "c1", focus: false }, writtenLink: "c1" }),
    );

    expect(outcome.address.link).toBe("c1");
    expect(outcome.writtenLink).toBe("c1");
  });

  it("Selection cleared, URL holds a link the page did not write", () => {
    const outcome = deriveAddress(
      makeState({ url: { link: "c2.R4", focus: false } }),
    );

    expect(outcome.address.link).toBe("c2.R4");
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("never takes back a line link an outside write replaced", () => {
    const outcome = deriveAddress(
      makeState({
        url: { link: "c2", focus: false },
        writtenLink: SELECTION_LINK,
      }),
    );

    expect(outcome.address.link).toBe("c2");
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("never rewrites a selection it already wrote over an outside write", () => {
    const outcome = deriveAddress(
      makeState({
        lineSelection: SELECTION,
        url: { link: "c2", focus: false },
        writtenLink: SELECTION_LINK,
      }),
    );

    expect(outcome.address.link).toBe("c2");
    expect(outcome.writtenLink).toBe(SELECTION_LINK);
  });

  it("writes a line selection made in Changes scope", () => {
    const outcome = deriveAddress(
      makeState({ lineSelection: SELECTION, scope: "changes" }),
    );

    expect(outcome.address.link).toBe(SELECTION_LINK);
  });

  it("Focus on, no selection, Full scope, active chunk changes", () => {
    const outcome = deriveAddress(
      makeState({
        focusMode: true,
        activeChunkId: "c2",
        url: { link: "c1", focus: true },
        writtenLink: "c1",
      }),
    );

    expect(outcome.address.link).toBe("c2");
    expect(outcome.writtenLink).toBe("c2");
  });

  it("Focus on, URL already names the active chunk", () => {
    const named = deriveAddress(
      makeState({
        focusMode: true,
        activeChunkId: "c2",
        url: { link: "c2.R10", focus: true },
      }),
    );
    const inFlight = deriveAddress(
      makeState({
        focusMode: true,
        activeChunkId: "c2",
        url: { link: "c1", focus: true },
        writtenLink: "c2",
      }),
    );

    expect(named.address.link).toBe("c2.R10");
    expect(named.writtenLink).toBeUndefined();
    expect(inFlight.address.link).toBe("c1");
    expect(inFlight.writtenLink).toBe("c2");
  });

  it("follows no chunk in Focus mode while in Changes scope", () => {
    const outcome = deriveAddress(
      makeState({
        focusMode: true,
        scope: "changes",
        activeChunkId: "c2",
        url: { link: undefined, focus: true },
      }),
    );

    expect(outcome.address.link).toBeUndefined();
  });

  it("follows no chunk in Focus mode while lines are selected", () => {
    const outcome = deriveAddress(
      makeState({
        focusMode: true,
        lineSelection: SELECTION,
        activeChunkId: "c2",
        url: { link: SELECTION_LINK, focus: true },
        writtenLink: SELECTION_LINK,
      }),
    );

    expect(outcome.address.link).toBe(SELECTION_LINK);
  });

  it("follows no chunk outside Focus mode", () => {
    const outcome = deriveAddress(makeState({ activeChunkId: "c2" }));

    expect(outcome.address.link).toBeUndefined();
  });

  it("writes the active chunk at once when a selection clears in Focus mode", () => {
    const outcome = deriveAddress(
      makeState({
        focusMode: true,
        activeChunkId: "c1",
        url: { link: SELECTION_LINK, focus: true },
        writtenLink: SELECTION_LINK,
      }),
    );

    expect(outcome.address.link).toBe("c1");
    expect(outcome.writtenLink).toBe("c1");
  });

  it("Focus mode left, page-written chunk link in URL", () => {
    const outcome = deriveAddress(
      makeState({ url: { link: "c2", focus: true }, writtenLink: "c2" }),
    );

    expect(outcome.address).toEqual({ link: undefined, focus: false });
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("keeps a chunk link it did not write when Focus mode is left", () => {
    const outcome = deriveAddress(
      makeState({ url: { link: "c2", focus: true } }),
    );

    expect(outcome.address).toEqual({ link: "c2", focus: false });
  });

  it("drops its own chunk link once Focus mode is in Changes scope", () => {
    const outcome = deriveAddress(
      makeState({
        focusMode: true,
        scope: "changes",
        activeChunkId: "c2",
        url: { link: "c2", focus: true },
        writtenLink: "c2",
      }),
    );

    expect(outcome.address.link).toBeUndefined();
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("focusMode differs from focus in URL", () => {
    const entered = deriveAddress(makeState({ focusMode: true }));
    const left = deriveAddress(
      makeState({ url: { link: undefined, focus: true } }),
    );

    expect(entered.address.focus).toBe(true);
    expect(left.address.focus).toBe(false);
  });

  it("Chunk share glyph clicked", () => {
    const selected = makeState({
      lineSelection: SELECTION,
      url: { link: SELECTION_LINK, focus: false },
      writtenLink: SELECTION_LINK,
    });
    const shared = deriveAddress(selected, {
      kind: AddressEventKinds.CHUNK_SHARED,
      chunkId: "c1",
    });
    const stoodDown = deriveAddress({
      ...selected,
      lineSelection: undefined,
      writtenLink: shared.writtenLink,
    });

    expect(shared.address.link).toBe("c1");
    expect(shared.writtenLink).toBe("c1");
    expect(stoodDown.address.link).toBe(SELECTION_LINK);
    expect(stoodDown.writtenLink).toBe("c1");
  });

  it("Line link arrives, lines not in this brief", () => {
    const outcome = deriveAddress(
      makeState({ url: { link: "c9.R4", focus: false } }),
      { kind: AddressEventKinds.LINE_LINK_MISSED },
    );

    expect(outcome.address.link).toBeUndefined();
    expect(outcome.writtenLink).toBeUndefined();
  });

  it("Line link lands", () => {
    const landed = deriveAddress(
      makeState({
        lineSelection: SELECTION,
        url: { link: SELECTION_LINK, focus: false },
      }),
    );
    const cleared = deriveAddress(
      makeState({
        url: { link: SELECTION_LINK, focus: false },
        writtenLink: landed.writtenLink,
      }),
    );

    expect(landed.address.link).toBe(SELECTION_LINK);
    expect(landed.writtenLink).toBe(SELECTION_LINK);
    expect(cleared.address.link).toBeUndefined();
  });

  it("rewrites a landed line link in its canonical spelling", () => {
    const outcome = deriveAddress(
      makeState({
        lineSelection: { ...SELECTION, endLine: 10 },
        url: { link: "c1.R10-R10", focus: false },
      }),
    );

    expect(outcome.address.link).toBe("c1.R10");
    expect(outcome.writtenLink).toBe("c1.R10");
  });

  it("Brief switches", () => {
    const arrived = deriveAddress(
      makeState({ url: { link: SELECTION_LINK, focus: false } }),
    );

    expect(arrived.address.link).toBe(SELECTION_LINK);
    expect(arrived.writtenLink).toBeUndefined();
  });

  it("neither writes nor adopts an unparseable URL link", () => {
    const kept = deriveAddress(
      makeState({ url: { link: "not a link!", focus: false } }),
    );
    const followed = deriveAddress(
      makeState({
        focusMode: true,
        activeChunkId: "c2",
        url: { link: "not a link!", focus: true },
      }),
    );

    expect(kept.address.link).toBe("not a link!");
    expect(kept.writtenLink).toBeUndefined();
    expect(followed.address.link).toBe("c2");
  });
});
