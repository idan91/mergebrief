// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { WaitReasons } from "contract";
import { PrStates } from "types";
import { I18nProvider } from "../../../../../i18n/I18nProvider";

import type { RerunNoteInput } from "../failed-head";
import { WaitCard } from ".";

const OPEN_INSTALLED: RerunNoteInput = {
  prState: PrStates.OPEN,
  appInstalled: true,
};
const STALLED_LINE =
  "Generation for this push stopped: its queued job used every attempt.";

describe("WaitCard on a stalled head", () => {
  it("names no brief coming and shows no loader", () => {
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          span={undefined}
          rerun={OPEN_INSTALLED}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading").textContent).toBe(STALLED_LINE);
    expect(
      screen.getByText(/^No brief is on the way for this push\. A new push/),
    ).toBeTruthy();
    expect(screen.queryByTestId("empty-block-loader")).toBeNull();
  });

  it("points a stalled url row at a paste", () => {
    const urlRow = { ...OPEN_INSTALLED, appInstalled: false };
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          rerun={urlRow}
          span={undefined}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Paste this pull request's URL on the home page/),
    ).toBeTruthy();
  });
});

describe("WaitCard on a running multi-call run", () => {
  it("reads the parts done and the start time in a polite region", () => {
    render(
      <I18nProvider>
        <WaitCard
          parts={{ done: 23, total: 57 }}
          phase="generating"
          prNumber={7}
          repoId="42"
          rerun={OPEN_INSTALLED}
          span={undefined}
          startedAt="2026-10-28T09:12:00.000Z"
          status="running"
        />
      </I18nProvider>,
    );

    const note = screen.getByText(
      /^Part 23 of 57 done\. Started \d{1,2}:\d{2}/,
    );
    expect(note.getAttribute("aria-live")).toBe("polite");
    expect(note.getAttribute("aria-atomic")).toBe("true");
    expect(screen.getByRole("heading").textContent).toBe(
      "Generating the brief…",
    );
  });

  it("names the parts planned before any landed and none while pending", () => {
    const { rerender } = render(
      <I18nProvider>
        <WaitCard
          parts={{ done: 0, total: 57 }}
          phase="generating"
          prNumber={7}
          repoId="42"
          rerun={OPEN_INSTALLED}
          span={undefined}
          status="running"
        />
      </I18nProvider>,
    );
    expect(screen.getByText("Generating in 57 parts.")).toBeTruthy();

    rerender(
      <I18nProvider>
        <WaitCard
          parts={{ done: 0, total: 57 }}
          phase={undefined}
          prNumber={7}
          repoId="42"
          rerun={OPEN_INSTALLED}
          span={undefined}
          status="pending"
        />
      </I18nProvider>,
    );
    expect(screen.queryByText(/parts/)).toBeNull();
  });
});

describe("WaitCard hydrated in another time zone than the server's", () => {
  const serverZone = process.env["TZ"];

  afterEach(() => {
    process.env["TZ"] = serverZone;
  });

  it("renders the start time in the viewer's zone with no hydration error", async () => {
    const card = (
      <I18nProvider>
        <WaitCard
          phase="generating"
          prNumber={7}
          repoId="42"
          rerun={OPEN_INSTALLED}
          span={undefined}
          startedAt="2026-10-28T09:12:00.000Z"
          status="running"
        />
      </I18nProvider>
    );
    process.env["TZ"] = "UTC";
    const container = document.createElement("div");
    container.innerHTML = renderToString(card);
    document.body.append(container);
    process.env["TZ"] = "Asia/Kolkata";
    const recoverableErrors: unknown[] = [];

    await act(async () => {
      hydrateRoot(container, card, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.textContent).toContain("Started 2:42");
    container.remove();
  });
});
