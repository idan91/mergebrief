// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GenerationStatus, PrState } from "types";

import { MarkLoaderTones } from "@web/components/MarkLoader/types";
import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { RowEnd } from ".";

const AT = "2026-09-20T10:00:00Z";

function readGlyph(status: GenerationStatus, state: PrState = "open") {
  const view = render(
    <I18nProvider>
      <RowEnd
        draft={false}
        generation={{ status, updatedAt: AT }}
        state={state}
      />
    </I18nProvider>,
  );
  const glyph = view.container
    .querySelector("[data-generation] [data-icon]")
    ?.getAttribute("data-icon");
  cleanup();
  return glyph;
}

afterEach(cleanup);

describe("RowEnd", () => {
  it("draws an awaiting head with the cursor-click glyph and its label", () => {
    const view = render(
      <I18nProvider>
        <RowEnd
          draft={false}
          generation={{ status: "awaiting-trigger", updatedAt: AT }}
          state="open"
        />
      </I18nProvider>,
    );

    const signal = view.container.querySelector(
      '[data-generation="awaiting-trigger"]',
    );
    expect(
      signal?.querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("cursor-click");
    expect(signal?.textContent).toBe("On demand");
  });

  it("leads a running row with the muted mark loader", () => {
    const view = render(
      <I18nProvider>
        <RowEnd
          draft={false}
          generation={{ status: "running", updatedAt: AT }}
          state="open"
        />
      </I18nProvider>,
    );

    const loader = view.container.querySelector(
      '[data-generation="running"] [data-tone]',
    );
    expect(loader?.getAttribute("data-tone")).toBe(MarkLoaderTones.MUTED);
  });

  it("draws held and waiting heads with their own glyph and a word", () => {
    const view = render(
      <I18nProvider>
        <RowEnd
          draft={false}
          generation={{
            status: "held",
            updatedAt: AT,
            unmetConditions: [{ kind: "labels", setBy: "repo", labels: ["x"] }],
          }}
          state="open"
        />
        <RowEnd
          draft={false}
          generation={{
            status: "held",
            updatedAt: AT,
            unmetConditions: [
              {
                kind: "bots",
                setBy: "repo",
                bot: "coderabbit",
                verdict: "finished",
                state: "running",
              },
            ],
          }}
          state="open"
        />
      </I18nProvider>,
    );

    const held = view.container.querySelector('[data-generation="held"]');
    const waiting = view.container.querySelector('[data-generation="waiting"]');
    expect(held?.textContent).toBe("Held");
    expect(held?.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe(
      "hand-palm",
    );
    expect(waiting?.textContent).toBe("Waiting");
    expect(
      waiting?.querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("hourglass-medium");
  });

  it("gives no other row signal the awaiting head's glyph", () => {
    const others = (["pending", "failed", "capped"] as const).map((status) =>
      readGlyph(status),
    );
    const view = render(
      <I18nProvider>
        <RowEnd draft generation={undefined} state="merged" />
        <RowEnd draft generation={undefined} state="closed" />
        <RowEnd draft generation={undefined} state="open" />
      </I18nProvider>,
    );
    const statuses = [...view.container.querySelectorAll("[data-icon]")].map(
      (icon) => icon.getAttribute("data-icon"),
    );

    expect([...others, ...statuses]).not.toContain("cursor-click");
  });
});
