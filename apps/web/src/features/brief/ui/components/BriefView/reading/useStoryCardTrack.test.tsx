// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@web/components/Button";
import { readCookieValue } from "@web/utils/preference-cookie";
import {
  clearStoryCardTrack,
  LEGACY_STORY_CARD_TRACK_STORAGE_KEY,
  STORY_CARD_TRACK_COOKIE,
  writeStoryCardTrack,
} from "./story-card-track-storage";
import { useStoryCardTrack } from "./useStoryCardTrack";

afterEach(() => {
  cleanup();
  clearStoryCardTrack();
  window.localStorage.clear();
});

function readCookie(): string | undefined {
  return readCookieValue(document.cookie, STORY_CARD_TRACK_COOKIE);
}

function Harness() {
  const cardTrack = useStoryCardTrack();
  return (
    <>
      <output data-testid="track">{String(cardTrack.track)}</output>
      <Button data-testid="set" onClick={() => cardTrack.setTrack(520)}>
        set
      </Button>
      <Button data-testid="reset" onClick={cardTrack.resetTrack}>
        reset
      </Button>
    </>
  );
}

function readTrack(): string {
  return screen.getByTestId("track").textContent ?? "";
}

describe("useStoryCardTrack", () => {
  it("has no track until one is stored", () => {
    render(<Harness />);
    expect(readTrack()).toBe("undefined");
  });

  it("renders the stored track from the first render", () => {
    writeStoryCardTrack(600);
    render(<Harness />);
    expect(readTrack()).toBe("600");
  });

  it("adopts a width stored before the cookie", () => {
    window.localStorage.setItem(LEGACY_STORY_CARD_TRACK_STORAGE_KEY, "600");
    render(<Harness />);
    expect(readTrack()).toBe("600");
    expect(readCookie()).toBe("600");
  });

  it("setTrack updates state and the cookie", () => {
    render(<Harness />);
    act(() => screen.getByTestId("set").click());
    expect(readTrack()).toBe("520");
    expect(readCookie()).toBe("520");
  });

  it("resetTrack clears state and the cookie", () => {
    writeStoryCardTrack(600);
    render(<Harness />);
    act(() => screen.getByTestId("reset").click());
    expect(readTrack()).toBe("undefined");
    expect(readCookie()).toBeUndefined();
  });
});
