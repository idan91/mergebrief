import type { Result } from "types/utils";
import { matchesGlob } from "../../path-matching";
import {
  GitAttributesRefusals,
  type GitAttributesRefusal,
  type LinguistAttributeLookup,
  type LinguistAttributes,
  type LinguistRule,
} from "./types";

const GENERATED = "linguist-generated";
const VENDORED = "linguist-vendored";
/** Comments and the negated patterns git itself ignores. */
const IGNORED_PATTERN_STARTS = ["#", "!"];
/** Macro definitions and quoted patterns, which this reader does not apply. */
const UNAPPLIED_PATTERN_STARTS = ["[attr]", '"'];
/** Bracket classes and escapes, which git reads and `matchesGlob` takes literally. */
const UNAPPLIED_PATTERN_CHARS = /[[\\]/;
/** Star runs git reads as `*` and `matchesGlob` as `**`: inside a segment, or three or more stars. */
const UNAPPLIED_STAR_RUN = /\*{3,}|[^/]\*\*|\*\*[^/]/;
const MAX_RULES = 200;
const MAX_PATTERN_CHARS = 256;
const MAX_TOTAL_PATTERN_CHARS = 4096;
/**
 * `matchesGlob` costs pattern x path steps and both are untrusted. Sized for
 * 3000 paths of 200 characters each paying a few general rules; directory
 * rules and literal misses cost no steps. Paths left when either budget runs
 * out read as neither attribute, so they are read in full.
 */
const MAX_MATCH_STEPS = 20_000_000;
/** The string checks before the glob scan the path once per rule: 200 rules over 3000 paths of 200 characters fit. */
const MAX_SCAN_CHARS = 200_000_000;
const MAX_TEXT_CHARS = 65_536;
/** Git separates and trims attribute lines on ASCII blanks only, never other Unicode spaces. */
const BLANKS = /[ \t\r]+/;
const WILDCARD = /[*?]/;
const WILDCARD_RUN = /[*?]+/;
/** `**\/` matches zero or more whole directories. */
const ANY_DEPTH = "**/";
/** `/**` matches anything below a directory. */
const ANY_BELOW = "/**";

interface MatchBudget {
  steps: number;
  scanChars: number;
}

interface CompiledRule {
  rule: LinguistRule;
  /** Decides the match with string checks alone; absent when the glob must run. */
  matchLiterally?: (path: string) => boolean;
  /** What any matching path must start with, hold in order, and end with. */
  literalPrefix: string;
  literalInfixes: string[];
  literalSuffix: string;
}

/** `true` set, `false` unset or unspecified, absent when the token names another attribute. */
function readSetting(token: string, attribute: string): boolean | undefined {
  if (token === attribute || token === `${attribute}=true`) {
    return true;
  }
  const unsets = [`-${attribute}`, `!${attribute}`, `${attribute}=false`];
  return unsets.includes(token) ? false : undefined;
}

/**
 * The root-anchored glob for a `.gitattributes` pattern: a pattern with no
 * slash matches a file name at any depth, any other is relative to the root.
 * A directory pattern (trailing slash) never matches a file in git.
 */
function toRootGlob(pattern: string): string | undefined {
  if (pattern.endsWith("/")) {
    return undefined;
  }
  if (pattern.startsWith("/")) {
    return pattern.slice(1);
  }
  return pattern.includes("/") ? pattern : `**/${pattern}`;
}

function readLinguistSettings(pattern: string, tokens: string[]): LinguistRule {
  const rule: LinguistRule = { pattern };
  for (const token of tokens) {
    const generated = readSetting(token, GENERATED);
    const vendored = readSetting(token, VENDORED);
    if (generated !== undefined) {
      rule.generated = generated;
    }
    if (vendored !== undefined) {
      rule.vendored = vendored;
    }
  }
  return rule;
}

/** The line's rule; a refusal when it unsets an attribute this reader cannot apply. */
function parseLine(
  line: string,
): LinguistRule | GitAttributesRefusal | undefined {
  const [pattern = "", ...tokens] = line
    .split(BLANKS)
    .filter((token) => token !== "");
  const ignored =
    pattern === "" ||
    IGNORED_PATTERN_STARTS.some((start) => pattern.startsWith(start));
  const rule = readLinguistSettings(pattern, tokens);
  const setsLinguist =
    rule.generated !== undefined || rule.vendored !== undefined;
  if (ignored || !setsLinguist) {
    return undefined;
  }

  const unapplied =
    pattern.length > MAX_PATTERN_CHARS ||
    UNAPPLIED_PATTERN_CHARS.test(pattern) ||
    UNAPPLIED_STAR_RUN.test(pattern) ||
    UNAPPLIED_PATTERN_STARTS.some((start) => pattern.startsWith(start));
  if (unapplied) {
    // A skipped set leaves its files read in full; a skipped unset could shorten hand-written code.
    const unsets = rule.generated === false || rule.vendored === false;
    return unsets ? GitAttributesRefusals.UNAPPLIED_UNSET : undefined;
  }
  const glob = toRootGlob(pattern);
  if (glob === undefined) {
    return undefined;
  }
  rule.pattern = glob;
  return rule;
}

/**
 * The `linguist-generated` and `linguist-vendored` rules of a root
 * `.gitattributes`, in file order. A rule this reader cannot apply as git
 * would is skipped. Past a size cap, or beside an unset it cannot apply,
 * a refusal, and every file reads in full instead.
 */
export function parseGitAttributes(
  text: string,
): Result<LinguistRule[], GitAttributesRefusal> {
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, error: GitAttributesRefusals.TOO_LARGE };
  }
  const rules: LinguistRule[] = [];
  let patternChars = 0;
  for (const line of text.split("\n")) {
    const rule = parseLine(line);
    if (typeof rule === "string") {
      return { ok: false, error: rule };
    }
    if (rule === undefined) {
      continue;
    }
    patternChars += rule.pattern.length;
    const overBudget =
      rules.length >= MAX_RULES || patternChars > MAX_TOTAL_PATTERN_CHARS;
    if (overBudget) {
      return { ok: false, error: GitAttributesRefusals.OVER_RULE_BUDGET };
    }
    rules.push(rule);
  }
  return { ok: true, value: rules };
}

/**
 * The exact matcher for a pattern with no wildcard, or one whose only
 * wildcards are a leading `**\/` and a trailing `/**` around a literal: the
 * directory shapes `.gitattributes` uses most, which then cost no glob steps.
 */
function compileLiteralMatch(
  pattern: string,
): ((path: string) => boolean) | undefined {
  const anyDepth = pattern.startsWith(ANY_DEPTH);
  const anyBelow = pattern.endsWith(ANY_BELOW);
  const start = anyDepth ? ANY_DEPTH.length : 0;
  const end = anyBelow ? pattern.length - ANY_BELOW.length : pattern.length;
  const literal = pattern.slice(start, end);
  if (literal === "" || WILDCARD.test(literal)) {
    return undefined;
  }

  if (anyDepth && anyBelow) {
    return (path) =>
      path.startsWith(`${literal}/`) || path.includes(`/${literal}/`);
  }
  if (anyDepth) {
    return (path) => path === literal || path.endsWith(`/${literal}`);
  }
  if (anyBelow) {
    return (path) => path.startsWith(`${literal}/`);
  }
  return (path) => path === literal;
}

/** `**\/` can match no directory at all, so a run's leading slash may be absent from the path. */
function dropLeadingSlash(run: string): string {
  return run.startsWith("/") ? run.slice(1) : run;
}

function compileRule(rule: LinguistRule): CompiledRule {
  const { pattern } = rule;
  const matchLiterally = compileLiteralMatch(pattern);
  if (matchLiterally !== undefined) {
    return {
      rule,
      matchLiterally,
      literalPrefix: "",
      literalInfixes: [],
      literalSuffix: "",
    };
  }

  const [literalPrefix = "", ...runs] = pattern.split(WILDCARD_RUN);
  const literalSuffix = dropLeadingSlash(runs.pop() ?? "");
  const literalInfixes = runs
    .map(dropLeadingSlash)
    .filter((infix) => infix !== "");
  return { rule, literalPrefix, literalInfixes, literalSuffix };
}

/** Whether `path` holds the rule's literal runs in order: a match always does. */
function holdsLiteralRuns(compiled: CompiledRule, path: string): boolean {
  const anchorsFit =
    path.startsWith(compiled.literalPrefix) &&
    path.endsWith(compiled.literalSuffix);
  if (!anchorsFit) {
    return false;
  }
  let searchFrom = compiled.literalPrefix.length;
  for (const infix of compiled.literalInfixes) {
    const found = path.indexOf(infix, searchFrom);
    if (found === -1) {
      return false;
    }
    searchFrom = found + infix.length;
  }
  return path.length - compiled.literalSuffix.length >= searchFrom;
}

/** Whether `rule` matches `path`, or `undefined` when matching would overrun `budget`. */
function matchRule(
  compiled: CompiledRule,
  path: string,
  budget: MatchBudget,
): boolean | undefined {
  budget.scanChars -= path.length + 1;
  if (budget.scanChars < 0) {
    return undefined;
  }
  if (compiled.matchLiterally !== undefined) {
    return compiled.matchLiterally(path);
  }
  if (!holdsLiteralRuns(compiled, path)) {
    return false;
  }

  budget.steps -= compiled.rule.pattern.length * (path.length + 1);
  if (budget.steps < 0) {
    return undefined;
  }
  return matchesGlob(compiled.rule.pattern, path);
}

/**
 * Takes the rules last to first, as the last rule that sets an attribute
 * wins, and stops once both are settled. `undefined` when the budget ran out.
 */
function resolvePath(
  path: string,
  lastRuleFirst: readonly CompiledRule[],
  budget: MatchBudget,
): LinguistAttributes | undefined {
  let generated: boolean | undefined;
  let vendored: boolean | undefined;
  for (const candidate of lastRuleFirst) {
    const { rule } = candidate;
    const settled = generated !== undefined && vendored !== undefined;
    const setsOpenAttribute =
      (generated === undefined && rule.generated !== undefined) ||
      (vendored === undefined && rule.vendored !== undefined);
    if (settled || !setsOpenAttribute) {
      continue;
    }
    const matched = matchRule(candidate, path, budget);
    if (matched === undefined) {
      return undefined;
    }
    if (matched) {
      generated ??= rule.generated;
      vendored ??= rule.vendored;
    }
  }
  return { generated: generated ?? false, vendored: vendored ?? false };
}

/**
 * Each path's linguist attributes under `rules`, in one run-wide match
 * budget. A path the budget never reached is absent and counted.
 */
export function readLinguistAttributesByPath(
  paths: readonly string[],
  rules: readonly LinguistRule[],
): LinguistAttributeLookup {
  const lastRuleFirst = rules.map(compileRule).toReversed();
  const budget = { steps: MAX_MATCH_STEPS, scanChars: MAX_SCAN_CHARS };
  const byPath = new Map<string, LinguistAttributes>();
  for (const [index, path] of paths.entries()) {
    const attributes = resolvePath(path, lastRuleFirst, budget);
    if (attributes === undefined) {
      return { byPath, unresolvedPathCount: paths.length - index };
    }
    byPath.set(path, attributes);
  }
  return { byPath, unresolvedPathCount: 0 };
}
