// @vitest-environment jsdom
import type { VersionResponse } from "contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VersionStates, type VersionState } from "./types";
import {
  deriveDismissedNotice,
  deriveReleaseNotice,
  readSeenVersion,
  readServerSeenVersion,
  subscribeSeenVersion,
  writeSeenVersion,
} from "./utils";

const AVAILABLE: VersionResponse = {
  version: "1.4.0",
  latest: "1.6.0",
  releaseNotesUrl: "https://example.test/releases/v1.6.0",
  checkedAt: "2026-10-03T10:00:00.000Z",
  breaking: false,
  security: false,
};

function makeKnown(snapshot: VersionResponse): VersionState {
  return { kind: VersionStates.KNOWN, snapshot };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("deriveDismissedNotice", () => {
  it("names the dismissed release while it is still the latest", () => {
    const notice = deriveDismissedNotice(
      makeKnown({ ...AVAILABLE, dismissedVersion: "1.6.0" }),
    );

    expect(notice).toMatchObject({ latest: "1.6.0", current: "1.4.0" });
    expect(
      deriveReleaseNotice(
        makeKnown({ ...AVAILABLE, dismissedVersion: "1.6.0" }),
      ),
    ).toBeUndefined();
  });

  it("drops the dismissal once a newer release is the latest", () => {
    const state = makeKnown({ ...AVAILABLE, dismissedVersion: "1.5.0" });

    expect(deriveDismissedNotice(state)).toBeUndefined();
    expect(deriveReleaseNotice(state)).toMatchObject({ latest: "1.6.0" });
  });

  it("never treats a security release as dismissed", () => {
    const state = makeKnown({
      ...AVAILABLE,
      security: true,
      dismissedVersion: "1.6.0",
    });

    expect(deriveDismissedNotice(state)).toBeUndefined();
    expect(deriveReleaseNotice(state)).toMatchObject({ security: true });
  });

  it("is nothing without a dismissal or on the latest release", () => {
    expect(deriveDismissedNotice(makeKnown(AVAILABLE))).toBeUndefined();
    expect(
      deriveDismissedNotice(
        makeKnown({ ...AVAILABLE, latest: "1.4.0", dismissedVersion: "1.4.0" }),
      ),
    ).toBeUndefined();
    expect(deriveDismissedNotice(undefined)).toBeUndefined();
  });
});

describe("the seen bit", () => {
  it("remembers the release the viewer opened the menu for", () => {
    expect(readSeenVersion()).toBeUndefined();

    writeSeenVersion("1.6.0");

    expect(readSeenVersion()).toBe("1.6.0");
  });

  it("tells subscribers about a write and the server renders no dot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSeenVersion(listener);

    writeSeenVersion("1.6.0");
    unsubscribe();
    writeSeenVersion("1.7.0");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(readServerSeenVersion()).toBe("unknown");
  });

  it("keeps the seen bit for the page when storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => writeSeenVersion("1.6.0")).not.toThrow();
    expect(readSeenVersion()).toBe("1.6.0");
  });
});
