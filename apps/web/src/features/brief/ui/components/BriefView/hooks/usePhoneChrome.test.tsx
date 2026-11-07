// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { Ref } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import {
  LANDSCAPE_PHONE_QUERY,
  MOBILE_QUERY,
} from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import {
  usePhoneChrome,
  type PhoneChrome,
  type ShownButtonRef,
} from "./usePhoneChrome";

let chrome: PhoneChrome | undefined;

interface HarnessProps {
  briefId?: string;
}

function Harness({ briefId = "brief-a" }: HarnessProps) {
  chrome = usePhoneChrome(briefId);
  return (
    <>
      <main id="main-content" tabIndex={-1} />
      <Button ref={chrome.barControlsRef}>Bar controls</Button>
      <Button ref={chrome.barIndicatorRef}>Bar indicator</Button>
      <Button ref={chrome.rowControlsRef}>Row controls</Button>
      <Button ref={chrome.rowIndicatorRef}>Row indicator</Button>
      <Button data-terminal-slot="">Submit review</Button>
      {chrome.controlsOpen ? <Button>Collapse supporting</Button> : null}
    </>
  );
}

/** One box: the element is rendered. */
function stubShownRects(): DOMRectList {
  const rect = new DOMRect(0, 0, 44, 44);
  return {
    length: 1,
    item: () => rect,
    0: rect,
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  } as unknown as DOMRectList;
}

function stubSidewaysPhone(): void {
  setMediaQueryMatches(MOBILE_QUERY, true);
  setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
}

function openThenCloseControls(): void {
  act(() => chrome?.openControls());
  expect(chrome?.controlsOpen).toBe(true);
  act(() => chrome?.closeControls());
  expect(chrome?.controlsOpen).toBe(false);
}

describe("usePhoneChrome", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
    chrome = undefined;
    vi.restoreAllMocks();
  });

  it("hands focus back to the bar's controls on an upright phone", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    expect(chrome?.controlsOpen).toBe(false);

    openThenCloseControls();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bar controls" }),
    );
  });

  it("hands focus back to the row's controls on a sideways phone", () => {
    stubSidewaysPhone();
    render(<Harness />);

    openThenCloseControls();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Row controls" }),
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
      screen.getByRole("button", { name: "Bar controls" }),
    );
  });

  it("takes focus back from the main landmark a leaving control handed it", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const { rerender } = render(<Harness briefId="brief-a" />);
    act(() => chrome?.openControls());
    document.getElementById("main-content")?.focus();

    rerender(<Harness briefId="brief-b" />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bar controls" }),
    );
  });

  it("names the indicator on screen as the Sidebar sheet trigger", () => {
    render(<Harness />);
    const trigger = chrome?.sheetTriggerRef;

    expect(trigger?.current).toBe(
      screen.getByRole("button", { name: "Bar indicator" }),
    );
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
    expect(trigger?.current).toBe(
      screen.getByRole("button", { name: "Row indicator" }),
    );
  });

  it("names the controls button on screen as the rescue target", () => {
    render(<Harness />);
    const controls = chrome?.controlsRef;

    expect(controls?.current).toBe(
      screen.getByRole("button", { name: "Bar controls" }),
    );
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
    expect(controls?.current).toBe(
      screen.getByRole("button", { name: "Row controls" }),
    );
  });

  it("carries focus to the row's controls when the phone turns", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    screen.getByRole("button", { name: "Bar controls" }).focus();

    act(() => setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Row controls" }),
    );
  });

  it("carries focus between the indicators when the phone turns back", () => {
    stubSidewaysPhone();
    render(<Harness />);
    screen.getByRole("button", { name: "Row indicator" }).focus();

    act(() => setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, false));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bar indicator" }),
    );
  });

  it("leaves focus on a control the turn keeps on screen", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    render(<Harness />);
    const submit = screen.getByRole("button", { name: "Submit review" });
    vi.spyOn(submit, "getClientRects").mockReturnValue(stubShownRects());
    submit.focus();

    act(() => setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true));

    expect(document.activeElement).toBe(submit);
  });

  it("reads no button while none is mounted", () => {
    const { result } = renderHook(() => usePhoneChrome("brief-a"));

    expect(result.current.controlsRef.current).toBeUndefined();
    expect(result.current.sheetTriggerRef.current).toBeUndefined();
  });

  it("keeps the on-screen buttons out of ref props", () => {
    expectTypeOf<ShownButtonRef>().not.toExtend<Ref<HTMLButtonElement>>();
  });
});
