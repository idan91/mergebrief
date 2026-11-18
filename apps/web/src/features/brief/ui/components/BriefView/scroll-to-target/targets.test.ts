// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { readScrollState, readUnderStackTop } from "./targets";
import { ScrollTargetKinds } from "./types";

const root = document.documentElement;

function stubGaps(scrollGap: string, chunkHeadGap: string): void {
  root.style.setProperty("--sticky-stack-h", "44px");
  root.style.setProperty("--chunk-scroll-gap", scrollGap);
  root.style.setProperty("--chunk-head-gap", chunkHeadGap);
}

describe("the gap a scroll to target reads", () => {
  afterEach(() => {
    root.removeAttribute("style");
  });

  it("keeps a group clear of the row while chunk heads sit behind it", () => {
    stubGaps("40px", "-44px");

    const group = readScrollState(undefined, ScrollTargetKinds.GROUP);
    const chunk = readScrollState(undefined, ScrollTargetKinds.CHUNK);

    expect(group.scrollGap).toBe(40);
    expect(chunk.scrollGap).toBe(-44);
  });

  it("puts the reading line where a chunk head is placed", () => {
    stubGaps("40px", "-44px");

    expect(readUnderStackTop()).toBe(0);
  });
});
