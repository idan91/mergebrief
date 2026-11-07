// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@web/components/Button";
import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { usePhoneChrome, type PhoneChrome } from "./usePhoneChrome";

let chrome: PhoneChrome | undefined;

interface HarnessProps {
  briefId?: string;
}

function Harness({ briefId = "brief-a" }: HarnessProps) {
  chrome = usePhoneChrome(briefId);
  return (
    <>
      <main id="main-content" tabIndex={-1} />
      <Button ref={chrome.controlsRef}>Brief controls</Button>
      <Button data-terminal-slot="">Submit review</Button>
      {chrome.controlsOpen ? <Button>Collapse supporting</Button> : null}
    </>
  );
}

describe("usePhoneChrome", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
    chrome = undefined;
  });

  it("opens the controls and hands focus back to the button on close", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    expect(chrome?.controlsOpen).toBe(false);

    act(() => chrome?.openControls());
    expect(chrome?.controlsOpen).toBe(true);

    act(() => chrome?.closeControls());
    expect(chrome?.controlsOpen).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Brief controls" }),
    );
  });

  it("closes the controls once the viewport stops being a phone", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    act(() => chrome?.openControls());
    expect(chrome?.controlsOpen).toBe(true);

    act(() => setMediaQueryMatches(MOBILE_QUERY, false));
    expect(chrome?.controlsOpen).toBe(false);

    act(() => setMediaQueryMatches(MOBILE_QUERY, true));
    expect(chrome?.controlsOpen).toBe(false);
  });

  it("lands the sheet's focus on the terminal action when it closes", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    act(() => chrome?.openControls());
    screen.getByRole("button", { name: "Collapse supporting" }).focus();

    act(() => setMediaQueryMatches(MOBILE_QUERY, false));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Submit review" }),
    );
  });

  it("closes the controls when the brief changes under them", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const { rerender } = render(<Harness briefId="brief-a" />);
    act(() => chrome?.openControls());
    screen.getByRole("button", { name: "Collapse supporting" }).focus();

    rerender(<Harness briefId="brief-b" />);

    expect(chrome?.controlsOpen).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Brief controls" }),
    );
  });

  it("takes focus back from the main landmark a leaving control handed it", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const { rerender } = render(<Harness briefId="brief-a" />);
    act(() => chrome?.openControls());
    document.getElementById("main-content")?.focus();

    rerender(<Harness briefId="brief-b" />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Brief controls" }),
    );
  });
});
