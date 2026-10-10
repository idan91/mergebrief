import { describe, expect, it, vi } from "vitest";

import type { BriefAddressPort } from "./types";
import { buildFileAddress } from "./utils";

function stubPort(): BriefAddressPort {
  return {
    link: "chunk-a",
    navigateLink: vi.fn(),
    setFocusParam: vi.fn(),
    clearDiffParam: vi.fn(),
    navigateSearch: vi.fn(),
  };
}

describe("buildFileAddress", () => {
  it("carries the port's link and writes with the route's posture", () => {
    const port = stubPort();

    const address = buildFileAddress({
      port,
      searchParams: { view: "changes" },
      revisionPending: true,
    });

    expect(address.link).toBe("chunk-a");
    expect(address.navigateLink).toBe(port.navigateLink);
    expect(address.setFocusParam).toBe(port.setFocusParam);
    expect(address.clearDiffParam).toBe(port.clearDiffParam);
    expect(address.searchParams).toEqual({ view: "changes" });
    expect(address.revisionPending).toBe(true);
  });

  it("leaves Changes for full, keeping Compare and diff as the URL has them", () => {
    const port = stubPort();
    const address = buildFileAddress({
      port,
      searchParams: {
        view: "changes",
        compare: "previous-brief",
        diff: "split",
      },
      revisionPending: false,
    });

    address.exitChangesScope({ replace: true });

    expect(port.navigateSearch).toHaveBeenCalledWith(
      { view: "full", compare: "previous-brief", diff: "split" },
      { replace: true },
    );
  });
});
