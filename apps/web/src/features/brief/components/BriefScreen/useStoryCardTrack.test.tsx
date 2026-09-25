// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@web/components/Button";
import { STORY_CARD_TRACK_STORAGE_KEY } from "./storyCardTrackStorage";
import { useStoryCardTrack } from "./useStoryCardTrack";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

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
  it("has no track until storage holds one", () => {
    render(<Harness />);
    expect(readTrack()).toBe("undefined");
  });

  it("restores the stored track on mount", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "600");
    render(<Harness />);
    expect(readTrack()).toBe("600");
  });

  it("setTrack updates state and storage", () => {
    render(<Harness />);
    act(() => screen.getByTestId("set").click());
    expect(readTrack()).toBe("520");
    expect(window.localStorage.getItem(STORY_CARD_TRACK_STORAGE_KEY)).toBe(
      "520",
    );
  });

  it("resetTrack clears state and storage", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "600");
    render(<Harness />);
    act(() => screen.getByTestId("reset").click());
    expect(readTrack()).toBe("undefined");
    expect(window.localStorage.getItem(STORY_CARD_TRACK_STORAGE_KEY)).toBe(
      null,
    );
  });
});
