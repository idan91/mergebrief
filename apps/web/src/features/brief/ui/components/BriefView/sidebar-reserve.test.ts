import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compileScss,
  compileStylesheet,
  normalizeMediaQuery,
  parseCompiledRules,
  readDeclarations,
  type CompiledRule,
} from "@web/test/compiled-css";
import { SIDEBAR_OVERLAY_QUERY } from "./Sidebar/consts";
import { StackedQueries } from "./StoryView/StorySplitter/types";
import { resolveStackedQuery } from "./StoryView/StorySplitter/utils";
import { SidebarLayouts, type SidebarLayout } from "./utils";

const WIDTH_CONDITION = /^width(<=|<|>=|>)(\d+)px$/;
const COVERED_WIDTH = "var(--sidebar-covered-w)";
const ROOT_FONT_PX = 16;
const EXPANDED_RESERVE = "var(--sidebar-w-expanded)";
const COLLAPSED_RESERVE = "var(--sidebar-w-collapsed)";

const columnRules = readRules("./BriefView.module.scss");
const versionRules = readRules(
  "../../../../version/components/VersionNotice/VersionNotice.module.scss",
);
const lineLinkRules = readRules("./LineLinkNotice/LineLinkNotice.module.scss");
const toastRules = readRules(
  "../../../../../components/Toast/Toast.module.scss",
);
const tokenRules = readRules("../../../../../styles/tokens.scss");
const sidebarRules = readRules("./Sidebar/Sidebar.module.scss");
const stackRules = parseCompiledRules(
  compileScss(
    '@use "layout";\n.group { @include layout.when-story-stacks { order: 1; } }',
  ),
);

function readRules(path: string): CompiledRule[] {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return parseCompiledRules(compileStylesheet(file));
}

function isConditionMatching(condition: string, width: number): boolean {
  const [, operator, limit] = WIDTH_CONDITION.exec(condition) ?? [];
  const bound = Number(limit);
  const comparisons: Record<string, boolean> = {
    "<=": width <= bound,
    "<": width < bound,
    ">=": width >= bound,
    ">": width > bound,
  };
  return operator === undefined ? false : comparisons[operator] === true;
}

/** Width-only media; a query on any other feature never sets the sidebar's widths. */
function isMediaMatching(media: string | undefined, width: number): boolean {
  if (media === undefined) {
    return true;
  }
  return normalizeMediaQuery(media).some((branch) =>
    branch
      .split("and")
      .every((condition) => isConditionMatching(condition, width)),
  );
}

function isSelectorMatching(selector: string, layout: SidebarLayout): boolean {
  const scoped = selector.startsWith(":root:has(.readingColumn[data-sidebar");
  const named = selector.includes(`[data-sidebar=${layout}])`);
  return scoped && (named || selector.endsWith("[data-sidebar])"));
}

/** What the page's root holds for `property` at this width, the last matching rule winning. */
function resolveRootProperty(
  property: string,
  width: number,
  layout: SidebarLayout,
): string | undefined {
  const matching = columnRules.filter(
    (rule) =>
      rule.declarations.has(property) &&
      isMediaMatching(rule.media, width) &&
      rule.selectors.some((selector) => isSelectorMatching(selector, layout)),
  );
  return matching.at(-1)?.declarations.get(property);
}

function readWidthPx(query: string | undefined): number {
  const [, limit] = /(\d+)px/.exec(query ?? "") ?? [];
  return Number(limit);
}

function readRemPx(token: string): number {
  const value = readDeclarations(tokenRules, ":root").get(token) ?? "";
  return Number.parseFloat(value) * ROOT_FONT_PX;
}

/** The media the expanded sidebar's full reserve sits under. */
function readFullReserveMedia(): string | undefined {
  const rule = columnRules.find(
    (candidate) =>
      candidate.declarations.get("--sidebar-w") === EXPANDED_RESERVE,
  );
  return rule?.media;
}

describe("sidebar reserve", () => {
  it.each([
    [1121, COLLAPSED_RESERVE],
    [1269, COLLAPSED_RESERVE],
    [1644, COLLAPSED_RESERVE],
    [1645, EXPANDED_RESERVE],
    [1920, EXPANDED_RESERVE],
  ])("reserves an expanded sidebar's story at %ipx", (width, reserve) => {
    const reserved = resolveRootProperty(
      "--sidebar-w",
      width,
      SidebarLayouts.EXPANDED,
    );

    expect(reserved).toBe(reserve);
  });

  it("starts the overlay where the full reserve would stack the story", () => {
    const stackPoint = readWidthPx(StackedQueries.SIDEBAR);
    const panel =
      readRemPx("--sidebar-w-expanded") - readRemPx("--sidebar-w-collapsed");

    expect(readFullReserveMedia()).toBe(
      `(width > ${String(stackPoint + panel)}px)`,
    );
  });

  it("floats the panel over the story across the same range", () => {
    const overlay = sidebarRules.find(
      (rule) =>
        rule.selectors.join(", ") === ".sidebar[data-variant=desktop]" &&
        rule.declarations.get("overflow") === "visible",
    );

    expect(overlay?.media).toBe(
      `(width <= ${String(readWidthPx(readFullReserveMedia()))}px)`,
    );
  });

  it("closes a stored open sidebar on load across the same range", () => {
    expect(SIDEBAR_OVERLAY_QUERY).toBe(
      `(width <= ${String(readWidthPx(readFullReserveMedia()))}px)`,
    );
  });

  it("stacks an expanded sidebar's story where the splitter expects", () => {
    const expanded = stackRules.find((rule) =>
      rule.selectors.some((selector) =>
        selector.includes('[data-sidebar="expanded"]'),
      ),
    );

    expect(expanded?.media).toBe(resolveStackedQuery(SidebarLayouts.EXPANDED));
  });
});

describe("sidebar covered width", () => {
  it.each([1121, 1440, 1644, 1645, 1920])(
    "covers the expanded panel's width at %ipx",
    (width) => {
      const covered = resolveRootProperty(
        "--sidebar-covered-w",
        width,
        SidebarLayouts.EXPANDED,
      );

      expect(covered).toBe("var(--sidebar-w-expanded)");
    },
  );

  it("covers the collapsed rail, and nothing below the tablet width", () => {
    const rail = resolveRootProperty(
      "--sidebar-covered-w",
      1440,
      SidebarLayouts.COLLAPSED,
    );
    const hidden = resolveRootProperty(
      "--sidebar-covered-w",
      1120,
      SidebarLayouts.EXPANDED,
    );

    expect(rail).toBe("var(--sidebar-w-collapsed)");
    expect(hidden).toBe("0px");
  });

  it("keeps every page notice and the toast clear of the covered width", () => {
    const notice = readDeclarations(versionRules, ".notice");
    const timeoutBand = readDeclarations(columnRules, ".diffTimeoutBand");
    const lineLink = readDeclarations(lineLinkRules, ".notice");
    const toast = readDeclarations(toastRules, ".toast");

    expect(notice.get("margin-inline-end")).toBe(COVERED_WIDTH);
    expect(timeoutBand.get("margin-inline-end")).toBe(COVERED_WIDTH);
    expect(lineLink.get("margin-inline")?.endsWith(COVERED_WIDTH)).toBe(true);
    expect(lineLink.get("max-inline-size")).toContain(COVERED_WIDTH);
    expect(toast.get("inset-inline-start")).toBe(
      `calc((100% - ${COVERED_WIDTH}) / 2)`,
    );
  });
});
