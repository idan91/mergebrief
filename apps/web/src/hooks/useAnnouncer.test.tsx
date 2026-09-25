// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../components/Button";
import { useAnnouncer } from "./useAnnouncer";

afterEach(cleanup);

function Harness() {
  const { text, announce } = useAnnouncer();
  return (
    <>
      <output>{text}</output>
      <Button type="button" onClick={() => announce("Link copied")}>
        say
      </Button>
    </>
  );
}

function readText(): string {
  return screen.getByRole("status").textContent ?? "";
}

async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
  });
}

describe("useAnnouncer", () => {
  it("empties the region first, then lands the words on the next frame", async () => {
    render(<Harness />);
    const say = screen.getByRole("button");

    act(() => say.click());
    expect(readText()).toBe("");
    await nextFrame();
    expect(readText()).toBe("Link copied");

    act(() => say.click());
    expect(readText()).toBe("");
    await nextFrame();
    expect(readText()).toBe("Link copied");
  });
});
