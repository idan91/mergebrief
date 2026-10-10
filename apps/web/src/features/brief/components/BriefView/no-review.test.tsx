// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefAddressPort } from "../BriefScreen/address/types";
import { buildFileAddress } from "../BriefScreen/address/utils";
import { briefFixture, briefSummaryFixture } from "../../fixtures";
import { useBriefReading } from "../../hooks/useBriefReading";
import { mountBriefHost } from "../../test-utils";
import { BriefView } from ".";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const NO_SESSION_REASON = /no review session to save work to/;

function ignoreWrite(): void {}

const IGNORED_PORT: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreWrite,
  setFocusParam: ignoreWrite,
  clearDiffParam: ignoreWrite,
  navigateSearch: ignoreWrite,
};

function ReadingOnlyHost() {
  const reading = useBriefReading({
    brief: briefFixture,
    briefId: briefSummaryFixture.id,
  });
  const address = buildFileAddress({
    port: IGNORED_PORT,
    searchParams: {},
    revisionPending: false,
  });

  return <BriefView reading={reading} address={address} />;
}

function listViewedBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox", { name: /Viewed/ })
    .filter((box): box is HTMLInputElement => box instanceof HTMLInputElement);
}

describe("a Brief with reading and address only", () => {
  it("disables every write and says there is no review session", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<ReadingOnlyHost />);

    await waitFor(() => expect(listViewedBoxes().length).toBeGreaterThan(0));
    expect(listViewedBoxes().every((box) => box.disabled)).toBe(true);

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "v" });

    expect(await screen.findAllByText(NO_SESSION_REASON)).not.toHaveLength(0);
  });
});
