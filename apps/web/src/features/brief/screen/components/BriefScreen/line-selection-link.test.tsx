// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { Button } from "@web/components/Button";

import { FixtureBriefView, mountBriefHost } from "../../../test-utils";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(cleanup);

/**
 * The router's part: the link the page writes comes back as the `link`
 * prop, an outside write replaces it, and a brief switch drops it.
 */
function Host({
  navigateLink,
  initialLink,
}: {
  navigateLink: (link: string | undefined) => void;
  initialLink?: string | undefined;
}) {
  const [link, setLink] = useState<string | undefined>(initialLink);
  const [briefId, setBriefId] = useState("fixture-brief");
  const write = useCallback(
    (next: string | undefined) => {
      navigateLink(next);
      setLink(next);
    },
    [navigateLink],
  );
  const switchBrief = () => {
    setBriefId("fixture-brief-2");
    setLink(undefined);
  };
  return (
    <>
      <Button onClick={() => setLink("chunk-a")}>outside write</Button>
      <Button onClick={switchBrief}>switch brief</Button>
      <FixtureBriefView
        briefId={briefId}
        link={link}
        navigateLink={write}
        searchParams={{ view: "full", compare: "off" }}
      />
    </>
  );
}

function findNumberCell(line: string): HTMLElement {
  const cell = document.querySelector(
    `td[data-select-anchor][data-line-new="${line}"]`,
  );
  if (!(cell instanceof HTMLElement)) {
    throw new Error("expected a number cell");
  }
  return cell;
}

describe("line selection link", () => {
  it("writes the selection to the link param and drops it on Escape", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }

    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line 10 selected.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith(undefined),
    );
    expect(navigateLink).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line selection cleared.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });

  it("the chunk glyph writes the chunk link and stands the selection down", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    const [glyph] = screen.getAllByRole("button", {
      name: /copy link to this chunk/i,
    });
    if (glyph === undefined) {
      throw new Error("expected a chunk glyph");
    }
    fireEvent.click(glyph);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a"),
    );
    expect(document.querySelector("tr[data-selected]")).toBeNull();
    expect(navigateLink).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line selection cleared.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });

  it("never drops a link it did not write", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(
      <Host initialLink="chunk-a" navigateLink={navigateLink} />,
    );
    await waitFor(() => findNumberCell("10"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigateLink).not.toHaveBeenCalled();
  });

  it("never drops a link an outside write replaced", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    fireEvent.click(screen.getByRole("button", { name: "outside write" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(document.querySelector("tr[data-selected]")).toBeNull(),
    );
    expect(navigateLink).not.toHaveBeenCalledWith(undefined);
    expect(navigateLink).toHaveBeenCalledTimes(1);
  });

  it("writes the same lines again after a brief switch", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    fireEvent.click(screen.getByRole("button", { name: "switch brief" }));
    await waitFor(() =>
      expect(document.querySelector("tr[data-selected]")).toBeNull(),
    );
    const again = await waitFor(() => findNumberCell("10"));
    const againRow = again.closest("tr");
    if (againRow === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(again);
    fireEvent.mouseUp(againRow);

    await waitFor(() => expect(navigateLink).toHaveBeenCalledTimes(2));
    expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10");
  });
});
