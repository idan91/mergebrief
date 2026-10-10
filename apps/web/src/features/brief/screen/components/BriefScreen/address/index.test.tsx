// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useState } from "react";
import { Button } from "@web/components/Button";

import type { BriefSearchParams } from "../../../../model/comparison/compareState";
import { briefFixture } from "../../../../fixtures";
import { FixtureBriefView, mountBriefHost } from "../../../../test-utils";
import type { ComparisonMarks } from "../../../../model/types";
import type { BriefComparisonPlan } from "../../../../model/comparison/types";

const lastReviewMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};
const comparisonPlan: BriefComparisonPlan = {
  lastReview: {
    marks: {
      queryKey: ["test-address-marks"],
      queryFn: () => Promise.resolve(lastReviewMarks),
    },
  },
};
const FULL_SCOPE: BriefSearchParams = { view: "full", compare: "off" };
const CHANGES_SCOPE: BriefSearchParams = {
  view: "changes",
  compare: "last-review",
};

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(cleanup);

type Write = ["link", string | undefined] | ["focus", boolean];

interface AddressHostProps {
  writes: Write[];
  initialLink?: string | undefined;
  /** False: the focus param never answers a write. */
  echoFocus?: boolean;
}

/**
 * The router's part: every write lands in the URL and comes back as props,
 * and a brief switch keeps the link. The writers stay stable across renders,
 * as the routes keep them, so a render alone never re-derives the Address.
 */
function AddressHost({
  writes,
  initialLink,
  echoFocus = true,
}: AddressHostProps) {
  const [link, setLink] = useState(initialLink);
  const [focus, setFocus] = useState(false);
  const [briefId, setBriefId] = useState("fixture-brief");
  const [scope, setScope] = useState(FULL_SCOPE);
  const searchParams: BriefSearchParams = { ...scope };
  if (focus) {
    searchParams.focus = true;
  }
  const navigateLink = useCallback(
    (next: string | undefined) => {
      writes.push(["link", next]);
      setLink(next);
    },
    [writes],
  );
  const setFocusParam = useCallback(
    (next: boolean) => {
      writes.push(["focus", next]);
      if (echoFocus) {
        setFocus(next);
      }
    },
    [writes, echoFocus],
  );

  return (
    <>
      <Button onClick={() => setBriefId("fixture-brief-2")}>
        switch brief
      </Button>
      <Button onClick={() => setScope(CHANGES_SCOPE)}>show changes</Button>
      <FixtureBriefView
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        link={link}
        navigateLink={navigateLink}
        searchParams={searchParams}
        setFocusParam={setFocusParam}
      />
    </>
  );
}

async function toggleFocusMode(shown: boolean): Promise<void> {
  fireEvent.keyDown(window, { key: "z" });
  await waitFor(() =>
    expect(screen.queryByTestId("focus-indicator") !== null).toBe(shown),
  );
}

async function selectLineTen(): Promise<void> {
  const cell = await waitFor(() => {
    const found = document.querySelector(
      'td[data-select-anchor][data-line-new="10"]',
    );
    if (!(found instanceof HTMLElement)) {
      throw new Error("expected a number cell");
    }
    return found;
  });
  const row = cell.closest("tr");
  if (row === null) {
    throw new Error("expected a row");
  }
  fireEvent.mouseDown(cell);
  fireEvent.mouseUp(row);
}

/** Lets any effect a write set off run, so a second write would show. */
async function settleWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("useAddress", () => {
  it("writes the focus param and the active chunk once each", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);

    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toContainEqual(["link", "chunk-a"]));
    await settleWrites();

    expect(writes).toContainEqual(["focus", true]);
    expect(writes).toHaveLength(2);
  });

  it("sends no write again while the URL has not answered it", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost echoFocus={false} writes={writes} />);
    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toContainEqual(["link", "chunk-a"]));

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(writes.at(-1)).toEqual(["link", "chunk-b"]));

    const focusWrites = writes.filter(([field]) => field === "focus");
    expect(focusWrites).toEqual([["focus", true]]);
  });

  it("follows the active chunk in Focus mode", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);
    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toContainEqual(["link", "chunk-a"]));

    fireEvent.keyDown(window, { key: "j" });

    await waitFor(() => expect(writes.at(-1)).toEqual(["link", "chunk-b"]));
  });

  it("drops its own chunk link on leaving Focus mode in Full scope", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);
    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toContainEqual(["link", "chunk-a"]));
    writes.length = 0;

    await toggleFocusMode(false);

    await waitFor(() => expect(writes).toContainEqual(["link", undefined]));
    expect(writes).toContainEqual(["focus", false]);
    expect(writes).toHaveLength(2);
  });

  it("drops its own chunk link when Focus mode enters Changes scope", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);
    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toContainEqual(["link", "chunk-a"]));
    writes.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "show changes" }));

    await waitFor(() => expect(writes).toEqual([["link", undefined]]));
    await settleWrites();
    expect(writes).toHaveLength(1);
  });

  it("keeps a chunk link it did not write on leaving Focus mode", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost initialLink="chunk-a" writes={writes} />);
    await toggleFocusMode(true);
    await waitFor(() => expect(writes).toEqual([["focus", true]]));

    await toggleFocusMode(false);
    await settleWrites();

    expect(writes).toEqual([
      ["focus", true],
      ["focus", false],
    ]);
  });

  it("a shared chunk link outlives the selection it stands down", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);
    await selectLineTen();
    await waitFor(() => expect(writes).toEqual([["link", "chunk-a.R10"]]));

    const [glyph] = screen.getAllByRole("button", {
      name: /copy link to this chunk/i,
    });
    if (glyph === undefined) {
      throw new Error("expected a chunk glyph");
    }
    fireEvent.click(glyph);
    await waitFor(() => expect(writes.at(-1)).toEqual(["link", "chunk-a"]));
    await settleWrites();

    expect(writes).toHaveLength(2);
    expect(document.querySelector("tr[data-selected]")).toBeNull();
  });

  it("drops a line link that misses, once", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost initialLink="nope.R1" writes={writes} />);

    await waitFor(() =>
      expect(screen.getByTestId("line-link-notice")).toBeTruthy(),
    );
    await settleWrites();

    expect(writes).toEqual([["link", undefined]]);
  });

  it("drops a link that does not parse, once", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost initialLink="c1 R12" writes={writes} />);

    await waitFor(() => expect(writes).toEqual([["link", undefined]]));
    await settleWrites();

    expect(writes).toHaveLength(1);
  });

  it("lands its own last-Brief link as the next Brief's arrival", async () => {
    const writes: Write[] = [];
    await mountBriefHost(<AddressHost writes={writes} />);
    await selectLineTen();
    await waitFor(() => expect(writes).toEqual([["link", "chunk-a.R10"]]));

    fireEvent.click(screen.getByRole("button", { name: "switch brief" }));

    await waitFor(() =>
      expect(document.querySelector("tr[data-selected]")).not.toBeNull(),
    );
    await settleWrites();
    expect(writes).toHaveLength(1);
  });
});
