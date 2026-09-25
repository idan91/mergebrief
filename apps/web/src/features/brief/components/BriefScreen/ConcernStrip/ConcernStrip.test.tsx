// @vitest-environment jsdom
import { appI18n } from "../../../../../i18n/I18nProvider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ConcernRollup } from "../../../types";
import { ConcernStrip } from ".";
import { concernShares } from "./utils";

afterEach(cleanup);

const rollup: ConcernRollup[] = [
  { concern: "implementation", added: 412, deleted: 118 },
  { concern: "test", added: 186, deleted: 22 },
  { concern: "doc", added: 38, deleted: 4 },
];

describe("ConcernStrip", () => {
  it("renders nothing below two concerns", () => {
    const { container: empty } = render(<ConcernStrip rollup={[]} />);
    expect(empty.innerHTML).toBe("");
    const { container: single } = render(
      <ConcernStrip
        rollup={[{ concern: "implementation", added: 412, deleted: 118 }]}
      />,
    );
    expect(single.innerHTML).toBe("");
    const { container: residue } = render(
      <ConcernStrip
        remainder={{ added: 7, deleted: 0 }}
        rollup={[{ concern: "implementation", added: 412, deleted: 118 }]}
      />,
    );
    expect(residue.innerHTML).toBe("");
  });

  it("renders one segment per concern in vocabulary order", () => {
    render(
      <ConcernStrip
        rollup={[
          { concern: "doc", added: 38, deleted: 4 },
          { concern: "implementation", added: 412, deleted: 118 },
          { concern: "test", added: 186, deleted: 22 },
        ]}
      />,
    );
    const strip = screen.getByTestId("concern-strip");
    const segments = [...strip.querySelectorAll("[data-concern]")].map(
      (segment) => segment.getAttribute("data-concern"),
    );
    expect(segments).toEqual(["implementation", "test", "doc"]);
  });

  it("shows share percentages and LoC per concern", () => {
    render(<ConcernStrip rollup={rollup} />);
    const strip = screen.getByTestId("concern-strip");
    const implementation = strip.querySelector(
      '[data-concern="implementation"]',
    );
    // (412+118) / 780 = 67.9% → 68%
    expect(implementation?.textContent).toContain("68%");
    expect(implementation?.textContent).toContain("+412");
    expect(implementation?.textContent).toContain("−118");
    const doc = strip.querySelector('[data-concern="doc"]');
    // (38+4) / 780 = 5.4% → 5%
    expect(doc?.textContent).toContain("5%");
  });

  it("renders the remainder as a last neutral segment", () => {
    render(
      <ConcernStrip remainder={{ added: 25, deleted: 0 }} rollup={rollup} />,
    );
    const strip = screen.getByTestId("concern-strip");
    const remainder = strip.querySelector(
      '[data-kind="unattributed-remainder"]',
    );
    expect(remainder?.textContent).toContain("unattributed");
    expect(remainder?.textContent).toContain("+25");
    const segments = [...strip.querySelectorAll("[data-concern], [data-kind]")];
    expect(segments.at(-1)?.getAttribute("data-kind")).toBe(
      "unattributed-remainder",
    );
  });

  it("labels the group for assistive tech", () => {
    render(<ConcernStrip rollup={rollup} />);
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(
      appI18n.t("brief.concernStrip.ariaLabel"),
    );
  });
});

describe("concernShares", () => {
  it("computes shares of the attributed total", () => {
    const shares = concernShares(rollup);
    expect(shares.map((share) => share.percent)).toEqual([68, 27, 5]);
    expect(shares[0]).toMatchObject({
      concern: "implementation",
      added: 412,
      deleted: 118,
    });
  });

  it("accumulates duplicate concern entries instead of dropping them", () => {
    const shares = concernShares([
      { concern: "implementation", added: 10, deleted: 0 },
      { concern: "implementation", added: 90, deleted: 0 },
      { concern: "test", added: 10, deleted: 0 },
    ]);
    expect(shares).toEqual([
      {
        kind: "concern",
        concern: "implementation",
        added: 100,
        deleted: 0,
        percent: 91,
      },
      { kind: "concern", concern: "test", added: 10, deleted: 0, percent: 9 },
    ]);
  });

  it("apportions rounded percents to sum to exactly 100", () => {
    // Independently rounded this would show 49 + 22 + 30 = 101; largest
    // remainder drops test to its floor instead.
    const shares = concernShares([
      { concern: "implementation", added: 423, deleted: 0 },
      { concern: "test", added: 187, deleted: 0 },
      { concern: "doc", added: 259, deleted: 0 },
    ]);
    expect(shares.map((share) => share.percent)).toEqual([49, 21, 30]);

    const thirds = concernShares([
      { concern: "implementation", added: 1, deleted: 0 },
      { concern: "test", added: 1, deleted: 0 },
      { concern: "doc", added: 1, deleted: 0 },
    ]);
    expect(thirds.reduce((sum, share) => sum + share.percent, 0)).toBe(100);
  });

  it("survives an all-zero rollup without NaN", () => {
    const shares = concernShares([
      { concern: "implementation", added: 0, deleted: 0 },
      { concern: "test", added: 0, deleted: 0 },
    ]);
    expect(shares.map((share) => share.percent)).toEqual([0, 0]);
  });

  it("appends a last remainder segment and apportions over the whole diff", () => {
    const shares = concernShares(
      [
        { concern: "implementation", added: 50, deleted: 0 },
        { concern: "test", added: 50, deleted: 0 },
      ],
      { added: 25, deleted: 0 },
    );
    expect(shares.map((share) => share.percent)).toEqual([40, 40, 20]);
    expect(shares[2]).toEqual({
      kind: "unattributed-remainder",
      added: 25,
      deleted: 0,
      percent: 20,
    });
  });

  it("does not append a zero-line remainder", () => {
    const shares = concernShares(rollup, { added: 0, deleted: 0 });
    expect(shares).toHaveLength(3);
    expect(shares.every((share) => share.kind === "concern")).toBe(true);
  });
});
