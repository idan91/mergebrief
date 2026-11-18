// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefAddressPort } from "./address/types";
import { buildFileAddress } from "./address/utils";
import {
  briefFixture,
  briefSummaryFixture,
  mountBriefHost,
} from "@web/features/brief/test-utils";
import { useBriefReading } from "../../hooks/useBriefReading";
import { BriefView } from ".";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function ignoreWrite(): void {}

const IGNORED_PORT: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreWrite,
  setFocusParam: ignoreWrite,
  clearDiffParam: ignoreWrite,
  navigateSearch: ignoreWrite,
};

function WideViewportHost() {
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

describe("the phone bar before the viewport is read", () => {
  it("is in the markup a wide read renders, for CSS to show on phones", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<WideViewportHost />);

    await waitFor(() => expect(screen.getByTestId("phone-bar")).toBeTruthy());
    expect(document.querySelector("[data-phone-bar]")).not.toBeNull();
  });
});
