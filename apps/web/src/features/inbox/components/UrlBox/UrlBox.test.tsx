// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "../../../../test/router";
import { UrlBox } from "./UrlBox";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("UrlBox", () => {
  it("the slash key focuses the field unless the viewer is typing", async () => {
    await renderInRouter(
      <>
        <UrlBox />
        <textarea aria-label="Other" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Pull request URL" });

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(field);

    const other = screen.getByRole("textbox", { name: "Other" });
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
  });

  it("an empty field submits nothing on Enter", async () => {
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });

    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refused URL lands in the alert line and the field comes back", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "invalid-url" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });

    fireEvent.change(field, { target: { value: "https://example.com/x" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });

    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(
      screen.getByRole("textbox", { name: "Pull request URL" }),
    ).toBeTruthy();
  });
});
