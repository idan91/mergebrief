import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LANDSCAPE_PHONE_QUERY } from "@web/hooks/useMobileViewport";
import {
  compileStylesheet,
  normalizeMediaQuery,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";
import { derivePhoneCardBox } from "./reading/chunk-height-model";
import { CARD_BLEED_QUERY } from "./reading/useWrapColumns";

const ROOT_FONT_PX = 16;
const FULL_PERCENT = 100;
const SIDEWAYS_WIDTHS = [750, 844, 932];
const NOTCH_INSET_PX = 59;
const SYMMETRIC_INSET_PX = 47;

interface Cell {
  width: number;
  left: number;
  right: number;
}

const NOTCHES = [
  { left: NOTCH_INSET_PX, right: 0 },
  { left: 0, right: NOTCH_INSET_PX },
  { left: SYMMETRIC_INSET_PX, right: SYMMETRIC_INSET_PX },
];

const [SIDEWAYS_BRANCH] = normalizeMediaQuery(LANDSCAPE_PHONE_QUERY);
const WIDTH_CONDITION = /^width(<=|<|>=|>)(\d+)px$/;
const CHUNK_SELECTOR = ":global(.main) .chunk";
const FOOTER_SELECTOR = "[data-zen=on] .footer";

const tokenRules = [
  ...readRules("../../../../../styles/tokens.scss"),
  ...readRules("../../../../../styles/base.scss"),
];
const headerRules = readRules("./Header/Header.module.scss");
const rowRules = readRules("./LandscapeRow/LandscapeRow.module.scss");
const columnRules = readRules("./BriefView.module.scss");
const groupRules = readRules("./StoryView/StoryView.module.scss");
const footerRules = readRules(
  "./StoryView/ChunkFooter/ChunkFooter.module.scss",
);
const cardRules = readRules("./StoryView/ChunkCard/ChunkCard.module.scss");
const panelRules = readRules("./FocusPanel/FocusPanel.module.scss");
const reanchorRules = readRules("./ReanchorBanner/ReanchorBanner.module.scss");
const lineLinkRules = readRules("./LineLinkNotice/LineLinkNotice.module.scss");
const versionRules = readRules(
  "../../../../version/components/VersionNotice/VersionNotice.module.scss",
);

interface PropertyScope {
  rules: CompiledRule[];
  selector: string;
}

/** Where the stylesheets under test declare the custom properties they read. */
const PROPERTY_SCOPES: PropertyScope[] = [
  { rules: tokenRules, selector: ":root" },
  { rules: tokenRules, selector: ".main" },
  { rules: cardRules, selector: CHUNK_SELECTOR },
  { rules: footerRules, selector: FOOTER_SELECTOR },
];

const VERSION_PAGE_SCOPES: PropertyScope[] = [
  { rules: versionRules, selector: ".notice" },
  ...PROPERTY_SCOPES,
];
const VERSION_BRIEF_SCOPES: PropertyScope[] = [
  { rules: versionRules, selector: ".notice[data-surface=brief]" },
  ...VERSION_PAGE_SCOPES,
];

function readRules(path: string): CompiledRule[] {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return parseCompiledRules(compileStylesheet(file));
}

function isBranchMatching(branch: string, width: number): boolean {
  if (branch === SIDEWAYS_BRANCH) {
    return true;
  }
  const [, operator, limit] = WIDTH_CONDITION.exec(branch) ?? [];
  const bound = Number(limit);
  const comparisons: Record<string, boolean> = {
    "<=": width <= bound,
    "<": width < bound,
    ">=": width >= bound,
    ">": width > bound,
  };
  return operator === undefined ? false : comparisons[operator] === true;
}

/** Whether a media query matches a phone held sideways at this width. */
function isMediaMatching(media: string | undefined, width: number): boolean {
  if (media === undefined) {
    return true;
  }
  const branches = normalizeMediaQuery(media);
  return branches.some((branch) => isBranchMatching(branch, width));
}

/** The value the cascade's last matching rule gives, among rules for one selector. */
function readDeclaration(
  rules: CompiledRule[],
  selector: string,
  property: string,
  width: number,
): string | undefined {
  const matching = rules.filter(
    (rule) =>
      rule.selectors.includes(selector) &&
      rule.declarations.has(property) &&
      isMediaMatching(rule.media, width),
  );
  return matching.at(-1)?.declarations.get(property);
}

function readPropertyPx(
  name: string,
  cell: Cell,
  scopes: PropertyScope[],
): number {
  for (const scope of scopes) {
    const value = readDeclaration(
      scope.rules,
      scope.selector,
      name,
      cell.width,
    );
    if (value !== undefined) {
      const [px = Number.NaN] = resolveLengths(value, cell, scopes);
      return px;
    }
  }
  throw new Error(`no declaration for ${name}`);
}

function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of text) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    const splits = depth === 0 && separator.test(char);
    if (splits && part !== "") {
      parts.push(part);
      part = "";
    } else if (!splits) {
      part += char;
    }
  }
  return part === "" ? parts : [...parts, part];
}

/** A product of terms joined by * and /, in order. */
function evaluateProduct(tokens: string[]): number {
  let total = evaluateTerm(tokens[0] ?? "");
  for (let index = 1; index < tokens.length; index += 2) {
    const operand = evaluateTerm(tokens[index + 1] ?? "");
    total = tokens[index] === "/" ? total / operand : total * operand;
  }
  return total;
}

/** A calc() sum: products joined by + and -. */
function evaluateSum(expression: string): number {
  const tokens = splitTopLevel(expression, /\s/);
  let total = 0;
  let sign = 1;
  let product: string[] = [];
  for (const token of [...tokens, "+"]) {
    const additive = token === "+" || token === "-";
    if (additive && product.length > 0) {
      total += sign * evaluateProduct(product);
      sign = token === "-" ? -1 : 1;
      product = [];
    } else {
      product.push(token);
    }
  }
  return total;
}

function evaluateTerm(term: string): number {
  const call = /^(max|min|clamp|calc)?\((.*)\)$/.exec(term);
  if (call === null) {
    return Number.parseFloat(term);
  }
  const [, name, inner = ""] = call;
  const values = splitTopLevel(inner, /,/).map(evaluateSum);
  if (name === "max") {
    return Math.max(...values);
  }
  if (name === "clamp") {
    const [lower = Number.NaN, preferred = lower, upper = preferred] = values;
    return Math.max(lower, Math.min(preferred, upper));
  }
  if (name === "min") {
    return Math.min(...values);
  }
  return values[0] ?? Number.NaN;
}

/** Each space-separated length in a declaration, in px, at one cell; 100% is a band as wide as the screen. */
function resolveLengths(
  value: string,
  cell: Cell,
  scopes = PROPERTY_SCOPES,
): number[] {
  const resolved = value
    .replaceAll("env(safe-area-inset-left)", `${cell.left}px`)
    .replaceAll("env(safe-area-inset-right)", `${cell.right}px`)
    .replace(/var\((--[\w-]+)\)/g, (_var, name: string) => {
      return `${readPropertyPx(name, cell, scopes)}px`;
    })
    .replace(/(-?[\d.]+)rem/g, (_rem, size: string) => {
      return `${Number(size) * ROOT_FONT_PX}px`;
    })
    .replace(/(-?[\d.]+)vw/g, (_vw, size: string) => {
      return `${(Number(size) * cell.width) / FULL_PERCENT}px`;
    })
    .replaceAll("100%", `${cell.width}px`)
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
  return splitTopLevel(resolved, /\s/).map(evaluateTerm);
}

function readInlinePadding(
  rules: CompiledRule[],
  selector: string,
  cell: Cell,
  scopes = PROPERTY_SCOPES,
): number[] {
  const value = readDeclaration(rules, selector, "padding-inline", cell.width);
  const [start = Number.NaN, end = start] = resolveLengths(
    value ?? "",
    cell,
    scopes,
  );
  return [start, end];
}

function readChunkBleed(cell: Cell): number {
  const value = readDeclaration(
    cardRules,
    CHUNK_SELECTOR,
    "--chunk-bleed",
    cell.width,
  );
  const [bleed = 0] = value === undefined ? [] : resolveLengths(value, cell);
  return bleed;
}

function readTabEnd(cell: Cell): number {
  const selector = ".tab[data-layout=sheet]";
  const value = readDeclaration(
    panelRules,
    selector,
    "inset-inline-end",
    cell.width,
  );
  const [end = Number.NaN] = resolveLengths(value ?? "", cell);
  return end;
}

function expectClearOfNotch(edges: number[], cell: Cell): void {
  const [start = Number.NaN, end = Number.NaN] = edges;
  expect(start).toBeGreaterThanOrEqual(cell.left);
  expect(end).toBeGreaterThanOrEqual(cell.right);
}

function makeCells(width: number): Cell[] {
  return NOTCHES.map((notch) => ({ width, ...notch }));
}

describe.each(SIDEWAYS_WIDTHS)("a phone held sideways at %ipx", (width) => {
  const flat: Cell = { width, left: 0, right: 0 };
  const focusGutter = readPropertyPx("--focus-gutter", flat, PROPERTY_SCOPES);
  const mainGutter = readPropertyPx("--main-gutter", flat, PROPERTY_SCOPES);
  const pageGutter = readPropertyPx("--page-gutter", flat, PROPERTY_SCOPES);

  it("pads the focus mode header row clear of the notch", () => {
    for (const cell of makeCells(width)) {
      expectClearOfNotch(
        readInlinePadding(headerRules, ".identityRow", cell),
        cell,
      );
    }
    expect(readInlinePadding(headerRules, ".identityRow", flat)).toEqual([
      0,
      ROOT_FONT_PX,
    ]);
  });

  it("pads the sideways row clear of the notch", () => {
    for (const cell of makeCells(width)) {
      expectClearOfNotch(readInlinePadding(rowRules, ".row", cell), cell);
    }
    expect(readInlinePadding(rowRules, ".row", flat)).toEqual([0, 0]);
  });

  it("insets the reading column clear of the notch", () => {
    for (const cell of makeCells(width)) {
      expectClearOfNotch(
        readInlinePadding(columnRules, ".readingColumn", cell),
        cell,
      );
    }
    expect(readInlinePadding(columnRules, ".readingColumn", flat)).toEqual([
      mainGutter,
      mainGutter,
    ]);
  });

  it("insets the focus mode group and footer clear of the notch", () => {
    const group = "[data-zen=on] .group";
    for (const cell of makeCells(width)) {
      expectClearOfNotch(readInlinePadding(groupRules, group, cell), cell);
      expectClearOfNotch(
        readInlinePadding(footerRules, FOOTER_SELECTOR, cell),
        cell,
      );
    }
    const unchanged = [focusGutter, focusGutter];
    expect(readInlinePadding(groupRules, group, flat)).toEqual(unchanged);
    expect(readInlinePadding(footerRules, FOOTER_SELECTOR, flat)).toEqual(
      unchanged,
    );
  });

  it("keeps the chunk card's edges clear of the notch", () => {
    for (const cell of makeCells(width)) {
      const bleed = readChunkBleed(cell);
      const column = readInlinePadding(columnRules, ".readingColumn", cell);
      const group = readInlinePadding(groupRules, "[data-zen=on] .group", cell);
      expectClearOfNotch(
        column.map((edge) => edge - bleed),
        cell,
      );
      expectClearOfNotch(
        group.map((edge) => edge - bleed),
        cell,
      );
    }
  });

  it("keeps the focus panel sheet and its tab clear of the notch", () => {
    const sheet = ".panel[data-variant=sheet]";
    for (const cell of makeCells(width)) {
      expectClearOfNotch(readInlinePadding(panelRules, sheet, cell), cell);
      expect(readTabEnd(cell)).toBeGreaterThanOrEqual(cell.right);
    }
    expect(readInlinePadding(panelRules, sheet, flat)).toEqual([0, 0]);
    expect(readTabEnd(flat)).toBe(ROOT_FONT_PX);
  });
  it("pads the bands above the reading column clear of the notch", () => {
    const bands = [
      { rules: reanchorRules, selector: ".reanchorBannerWrap", flatPx: 20 },
      { rules: lineLinkRules, selector: ".notice", flatPx: 18 },
      { rules: columnRules, selector: ".diffTimeoutBand", flatPx: pageGutter },
    ];
    for (const band of bands) {
      for (const cell of makeCells(width)) {
        expectClearOfNotch(
          readInlinePadding(band.rules, band.selector, cell),
          cell,
        );
      }
      expect(readInlinePadding(band.rules, band.selector, flat)).toEqual([
        band.flatPx,
        band.flatPx,
      ]);
    }
  });

  it("pads the version notice clear of the notch on both surfaces", () => {
    const surfaces = [VERSION_BRIEF_SCOPES, VERSION_PAGE_SCOPES];
    for (const scopes of surfaces) {
      for (const cell of makeCells(width)) {
        const edges = readInlinePadding(versionRules, ".notice", cell, scopes);
        expectClearOfNotch(edges, cell);
      }
    }
    const briefGutter = readPropertyPx(
      "--notice-gutter",
      flat,
      VERSION_BRIEF_SCOPES,
    );
    expect(
      readInlinePadding(versionRules, ".notice", flat, VERSION_BRIEF_SCOPES),
    ).toEqual([briefGutter, briefGutter]);
    expect(
      readInlinePadding(versionRules, ".notice", flat, VERSION_PAGE_SCOPES),
    ).toEqual([pageGutter, pageGutter]);
  });

  it("sizes the height model's card box to the CSS card box", () => {
    const cardBleeds = isMediaMatching(CARD_BLEED_QUERY, width);
    for (const cell of [flat, ...makeCells(width)]) {
      const insets = { leftPx: cell.left, rightPx: cell.right };
      const box = derivePhoneCardBox({ widthPx: width, cardBleeds, insets });
      const [start = 0, end = 0] = readInlinePadding(
        columnRules,
        ".readingColumn",
        cell,
      );

      expect(box.listPx).toBe(width - start - end);
      expect(box.bleedPx).toBe(readChunkBleed(cell));
    }
  });
});
