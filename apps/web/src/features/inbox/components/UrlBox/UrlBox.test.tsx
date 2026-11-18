// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { RequestBounds } from "contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeSingleKeyShortcutsOn } from "@web/utils/single-key-shortcuts";
import { renderInRouter } from "../../../../test/router";
import { UrlBox } from ".";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  writeSingleKeyShortcutsOn(true);
});

describe("UrlBox", () => {
  it("the U key focuses the field unless the viewer is typing", async () => {
    await renderInRouter(
      <>
        <UrlBox />
        <textarea aria-label="Other" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Pull request URL" });

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).not.toBe(field);
    fireEvent.keyDown(window, { key: "u" });
    expect(document.activeElement).toBe(field);

    const other = screen.getByRole("textbox", { name: "Other" });
    other.focus();
    fireEvent.keyDown(other, { key: "u" });
    expect(document.activeElement).toBe(other);
  });

  it("leaves the U key alone with single-key shortcuts off", async () => {
    writeSingleKeyShortcutsOn(false);
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });

    fireEvent.keyDown(window, { key: "u" });

    expect(document.activeElement).not.toBe(field);
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
    expect((field as HTMLInputElement).readOnly).toBe(false);
    expect((field as HTMLInputElement).value).toBe("https://example.com/x");
    expect(document.activeElement).toBe(field);
  });

  it("ties a refusal to the field it is about", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "invalid-url" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.getAttribute("aria-describedby")).toBeNull();

    fireEvent.change(field, { target: { value: "https://example.com/x" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });

    const alert = screen.getByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.id).not.toBe("");
  });

  it("drops the refusal's tie to the field once a new submit starts", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "invalid-url" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });
    fireEvent.change(field, { target: { value: "https://example.com/x" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });
    expect(field.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(field, {
      target: { value: "https://github.com/o/r/pull/7" },
    });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.getAttribute("aria-describedby")).toBeNull();
  });

  it("refuses a URL past the server's bound before sending it", async () => {
    await renderInRouter(<UrlBox />);
    const field = screen.getByRole("textbox", { name: "Pull request URL" });
    const padding = "x".repeat(RequestBounds.GENERATE_URL_LENGTH);

    fireEvent.change(field, {
      target: { value: `https://github.com/o/r/pull/7?${padding}` },
    });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "That URL is too long to be a pull request link. Paste the link from the pull request page.",
    );
    expect(document.activeElement).toBe(field);
  });
});
