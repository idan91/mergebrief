import githubDark from "shiki/themes/github-dark.mjs";
import type { ThemeRegistrationRaw } from "shiki/core";

export const MERGEBRIEF_THEME_NAME = "mergebrief-dark";

const CONSTANT_BLUE = "#79b8ff";
const ENTITY_GREEN = "#85e89d";
const DEFAULT_TEXT = "#e1e4e8";

// github-dark's comment grey reads 3.91:1 on the diff row ground
// (--color-surface-1, #111114). Its successor grey clears AA at 6.13:1
// and is the only colour here that github-dark does not already ship.
const RECOLOURED: Record<string, string> = {
  "#6a737d": "#8b949e",
};

type ThemeRule = NonNullable<ThemeRegistrationRaw["tokenColors"]>[number];

/**
 * Scopes github-dark leaves at the default foreground, which a reviewer reads
 * as structure rather than identifiers. Each scope is verified against a
 * tokenized sample in the suite beside this file.
 */
const OVERRIDE_RULES: ThemeRule[] = [
  {
    scope: ["meta.object-literal.key"],
    settings: { foreground: CONSTANT_BLUE },
  },
  {
    scope: ["meta.object-literal.key punctuation.separator.key-value"],
    settings: { foreground: DEFAULT_TEXT },
  },
  {
    scope: [
      "meta.import variable.other.readwrite.alias",
      "meta.export variable.other.readwrite.alias",
    ],
    settings: { foreground: CONSTANT_BLUE },
  },
  {
    scope: ["entity.other.attribute-name"],
    settings: { foreground: ENTITY_GREEN },
  },
];

export function buildMergebriefTheme(): ThemeRegistrationRaw {
  const base = (githubDark.tokenColors ?? []).map(recolourRule);

  return {
    ...githubDark,
    name: MERGEBRIEF_THEME_NAME,
    tokenColors: [...base, ...OVERRIDE_RULES],
  };
}

export const MERGEBRIEF_DARK: ThemeRegistrationRaw = buildMergebriefTheme();

function recolourRule(rule: ThemeRule): ThemeRule {
  const foreground = rule.settings?.foreground;
  if (foreground === undefined) return rule;

  const replacement = RECOLOURED[foreground.toLowerCase()];
  if (replacement === undefined) return rule;

  return { ...rule, settings: { ...rule.settings, foreground: replacement } };
}

/** Every foreground the theme can emit, lowercased, in rule order. */
export function listThemeForegrounds(theme: ThemeRegistrationRaw): string[] {
  const seen = new Set<string>();

  for (const rule of theme.tokenColors ?? []) {
    const foreground = rule.settings?.foreground;
    if (foreground !== undefined) seen.add(foreground.toLowerCase());
  }

  return [...seen];
}
