import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Concerns } from "brief-core/types";

import {
  compileStylesheet,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";

import {
  type Declarations,
  decodeChannel,
  parseColor,
  readShare,
  readTokenDeclarations,
  resolvePalette,
  resolveTokenValue,
  type Rgb,
} from "./test-utils";

// The palette's contrast lines (DESIGN.md, Contrast): words 5:1 on every
// surface and 5.5:1 on the page and the list, marks 3:1. The tokens derive
// in OKLCH from four numbers, so a hue or chroma change lands here first.

const MIXINS_URL = new URL("./_mixins.scss", import.meta.url);
const BADGE_URL = new URL(
  "../components/Badge/Badge.module.scss",
  import.meta.url,
);
const INBOX_ROW_URL = new URL(
  "../features/inbox/components/InboxList/InboxRow/InboxRow.module.scss",
  import.meta.url,
);

const WORDS_MIN = 5;
const WORDS_MIN_ON_PAGE = 5.5;
const MARKS_MIN = 3;
// The primary's label is a button label, held at AA rather than the words
// line: white on the brand is 4.51:1 by design.
const BUTTON_LABEL_MIN = 4.5;
// A badge's words sit on a tint of their own colour, held at the AA line at
// rest and under the pointer on a link badge.
const BADGE_WORDS_MIN = 4.5;
const BADGE_TINT = /var\(--badge-color\)\s+var\((--tint-[\w-]+)\)/;
const BADGE_COLOR_TOKEN = /^var\((--[\w-]+)\)$/;
const PERCENT = 100;

// A checkbox's and a field's boundary at rest, held at WCAG 1.4.11's 3:1
// against every fill a control sits on or holds, the Inbox's selected row
// included.
const CONTROL_EDGE = "--color-control-edge";
const CONTROL_SURFACES = [
  "--color-background",
  "--color-chrome",
  "--color-card",
  "--color-well",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
] as const;
const SELECTED_ROW_SURFACE = "--inbox-row-selected";
const COLOR_MIX =
  /^color-mix\(\s*in (srgb|oklch),\s*(.+?)\s+([\d.]+)%,\s*(.+?)\s*\)$/;
const OKLCH_PARTS = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/;

// A selected diff row lifts the well by the selected tint and its number
// cells by the gutter tint, both read from the tokens. Code and syntax
// colours read against the row and the numbers on text-1 against the number
// cells, all at the AA line, the exception DESIGN.md names under Contrast.
const SELECTED_ROW_TINT_TOKEN = "--diff-selected-tint";
const SELECTED_GUTTER_TINT_TOKEN = "--diff-selected-gutter-tint";
const WELL_BACKGROUND_SHARE = 0.25;
const SELECTED_ROW_MIN = 4.5;
const SELECTED_ROW_WORDS = [
  "--color-text-1",
  "--color-diff-add-text",
  "--color-diff-del-text",
  "--syn-text",
  "--syn-comment",
  "--syn-constant",
  "--syn-entity",
  "--syn-keyword",
  "--syn-string",
  "--syn-tag",
  "--syn-variable",
  "--syn-invalid",
  "--syn-regexp",
  "--syn-bracket",
  "--emphasis-comment",
  "--emphasis-keyword",
] as const;

const SURFACES = [
  "--color-background",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
] as const;
const PAGE_SURFACES = ["--color-background", "--color-surface-1"] as const;
const WORDS = [
  "--color-text-1",
  "--color-text-read",
  "--color-text-2",
  "--color-text-3",
  "--color-diff-add-text",
  "--color-diff-del-text",
] as const;
// The accent and the state colours draw marks, and they also set words:
// delta numerals, revision tags, deletion counts. So they are held at both
// lines.
const MARKS = [
  "--color-accent",
  "--color-positive",
  "--color-negative",
  "--color-warning",
  "--color-merged",
] as const;
// Derived from the vocabulary, so a new concern without a token fails here
// instead of rendering the neutral mark.
const CONCERN_MARKS = [
  ...Object.values(Concerns).map((concern) => `--color-concern-${concern}`),
  "--color-concern-unattributed",
];

function computeLuminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * decodeChannel(red / 255) +
    0.7152 * decodeChannel(green / 255) +
    0.0722 * decodeChannel(blue / 255)
  );
}

function mixSrgb(top: Rgb, bottom: Rgb, topShare: number): Rgb {
  const [topRed, topGreen, topBlue] = top;
  const [bottomRed, bottomGreen, bottomBlue] = bottom;
  const bottomShare = 1 - topShare;
  return [
    Math.round(topRed * topShare + bottomRed * bottomShare),
    Math.round(topGreen * topShare + bottomGreen * bottomShare),
    Math.round(topBlue * topShare + bottomBlue * bottomShare),
  ];
}

function parseOklchParts(value: string): [number, number, number] {
  const parts = OKLCH_PARTS.exec(value);
  if (parts === null) {
    throw new Error(`not a plain oklch literal: ${value}`);
  }
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

function resolveSurface(declarations: Declarations, name: string): Rgb {
  const value = resolveTokenValue(declarations, name);
  const mix = COLOR_MIX.exec(value);
  if (mix === null) {
    return parseColor(value);
  }

  const [, space, top = "", percent, bottom = ""] = mix;
  const share = Number(percent) / PERCENT;
  if (space === "srgb") {
    return mixSrgb(parseColor(top), parseColor(bottom), share);
  }
  const topParts = parseOklchParts(top);
  const bottomParts = parseOklchParts(bottom);
  const [lightness, chroma, hue] = topParts.map(
    (part, index) => part * share + (bottomParts[index] ?? 0) * (1 - share),
  );
  return parseColor(
    `oklch(${String(lightness)}% ${String(chroma)} ${String(hue)})`,
  );
}

function readSelectedRowFill(): string {
  const rules = parseCompiledRules(
    compileStylesheet(fileURLToPath(INBOX_ROW_URL)),
  );
  const fill = rules
    .find((rule) =>
      rule.selectors.some((selector) => selector.includes("data-selected")),
    )
    ?.declarations.get("--row-bg");
  if (fill === undefined) {
    throw new Error("no selected row fill in InboxRow");
  }
  return fill;
}

function readBadgeTint(
  rules: readonly CompiledRule[],
  declarations: Declarations,
  selector: string,
): number {
  const rule = rules.find(
    (candidate) =>
      candidate.selectors.includes(selector) &&
      candidate.declarations.has("background"),
  );
  const tint = BADGE_TINT.exec(rule?.declarations.get("background") ?? "");
  if (tint?.[1] === undefined) {
    throw new Error(`no badge tint on ${selector}`);
  }
  return readShare(declarations, tint[1]);
}

function readBadgeColors(rules: readonly CompiledRule[]): string[] {
  return rules.flatMap((rule) => {
    const token = BADGE_COLOR_TOKEN.exec(
      rule.declarations.get("--badge-color") ?? "",
    );
    return token?.[1] === undefined ? [] : [token[1]];
  });
}

function computeContrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(
    computeLuminance(foreground),
    computeLuminance(background),
  );
  const darker = Math.min(
    computeLuminance(foreground),
    computeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("palette contrast", () => {
  it("keeps every word token at 5:1 on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const word of WORDS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(word), colorOf(surface));
        if (ratio < WORDS_MIN) {
          failures.push(`${word} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every word token at 5.5:1 on the page and the list", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const word of WORDS) {
      for (const surface of PAGE_SURFACES) {
        const ratio = computeContrast(colorOf(word), colorOf(surface));
        if (ratio < WORDS_MIN_ON_PAGE) {
          failures.push(`${word} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every concern colour at 3:1 on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const mark of CONCERN_MARKS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < MARKS_MIN) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the brand mark at 3:1 on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const surface of SURFACES) {
      const ratio = computeContrast(colorOf("--color-brand"), colorOf(surface));
      if (ratio < MARKS_MIN) {
        failures.push(`--color-brand on ${surface}: ${ratio.toFixed(2)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("gives every concern a branch in the concern-color mixin", async () => {
    const mixins = await readFile(fileURLToPath(MIXINS_URL), "utf8");

    const missing = Object.values(Concerns).filter((concern) => {
      const branch = new RegExp(
        String.raw`\[data-concern="${concern}"\]\s*\{\s*--concern-color:\s*var\(--color-concern-${concern}\);`,
      );
      return !branch.test(mixins);
    });

    expect(missing).toEqual([]);
  });

  it("keeps every mark colour readable as words on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const mark of MARKS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < WORDS_MIN) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      for (const surface of PAGE_SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < WORDS_MIN_ON_PAGE) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps code and its syntax colours readable on a selected diff row", async () => {
    const colorOf = await resolvePalette();
    const declarations = await readTokenDeclarations();
    const well = mixSrgb(
      colorOf("--color-background"),
      colorOf("--color-surface-1"),
      WELL_BACKGROUND_SHARE,
    );
    const selected = mixSrgb(
      colorOf("--color-accent"),
      well,
      readShare(declarations, SELECTED_ROW_TINT_TOKEN),
    );
    const failures: string[] = [];

    for (const word of SELECTED_ROW_WORDS) {
      const ratio = computeContrast(colorOf(word), selected);
      if (ratio < SELECTED_ROW_MIN) {
        failures.push(`${word} on the selected row: ${ratio.toFixed(2)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the numbers readable on a selected row's number cells", async () => {
    const colorOf = await resolvePalette();
    const declarations = await readTokenDeclarations();
    const well = mixSrgb(
      colorOf("--color-background"),
      colorOf("--color-surface-1"),
      WELL_BACKGROUND_SHARE,
    );
    const selected = mixSrgb(
      colorOf("--color-accent"),
      well,
      readShare(declarations, SELECTED_GUTTER_TINT_TOKEN),
    );

    const ratio = computeContrast(colorOf("--color-text-1"), selected);

    expect(ratio).toBeGreaterThanOrEqual(SELECTED_ROW_MIN);
  });

  it("keeps a badge's words at 4.5:1 on its tint, at rest and hovered", async () => {
    const colorOf = await resolvePalette();
    const rules = parseCompiledRules(
      compileStylesheet(fileURLToPath(BADGE_URL)),
    );
    const declarations = await readTokenDeclarations();
    const restTint = readBadgeTint(rules, declarations, ".badge");
    const hoverRule = rules.find((rule) =>
      rule.selectors.includes("a.badge:hover"),
    );
    const hoverTint = hoverRule?.declarations.has("background")
      ? readBadgeTint(rules, declarations, "a.badge:hover")
      : restTint;
    const colors = readBadgeColors(rules);
    const tints = [restTint, hoverTint];
    const failures: string[] = [];

    for (const color of colors) {
      for (const [surface, tint] of SURFACES.flatMap((name) =>
        tints.map((share) => [name, share] as const),
      )) {
        const fill = mixSrgb(colorOf(color), colorOf(surface), tint);
        const ratio = computeContrast(colorOf(color), fill);
        if (ratio < BADGE_WORDS_MIN) {
          failures.push(
            `${color} at ${String(tint)} on ${surface}: ${ratio.toFixed(2)}`,
          );
        }
      }
    }

    expect(colors).not.toEqual([]);
    expect(failures).toEqual([]);
  });

  it("keeps the control edge at 3:1 on every surface a control sits on", async () => {
    const declarations = new Map(await readTokenDeclarations());
    declarations.set(SELECTED_ROW_SURFACE, readSelectedRowFill());
    const edge = resolveSurface(declarations, CONTROL_EDGE);
    const failures: string[] = [];

    for (const surface of [...CONTROL_SURFACES, SELECTED_ROW_SURFACE]) {
      const ratio = computeContrast(
        edge,
        resolveSurface(declarations, surface),
      );
      if (ratio < MARKS_MIN) {
        failures.push(`${CONTROL_EDGE} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the white label on the brand fill at the AA line", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const fill of ["--color-brand", "--color-brand-strong"]) {
      const ratio = computeContrast(colorOf("--color-on-brand"), colorOf(fill));
      if (ratio < BUTTON_LABEL_MIN) {
        failures.push(`--color-on-brand on ${fill}: ${ratio.toFixed(2)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
