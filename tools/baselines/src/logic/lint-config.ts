/**
 * Which baseline rules the lint configuration still turns ON. A rule that is
 * present but set to `"off"`, or one that survives only inside a comment, is
 * NOT configured: removing its suppressions is a policy retirement, not a
 * fixed violation, and that is the whole distinction this gate reports.
 */

/** `.oxlintrc.json` is JSONC. Strings are respected, so a `//` inside one stays. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      index += 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** oxlint severities: a string, a number, or `[severity, options]`. */
function isSeverityOn(value: unknown): boolean {
  if (Array.isArray(value)) return isSeverityOn(value[0]);
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "off";
  return false;
}

function readRuleBlock(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const rules = Reflect.get(value, "rules");
  if (typeof rules !== "object" || rules === null) return {};
  return { ...rules };
}

/** Every rule block in the config: the root one, plus each override's. */
function listRuleBlocks(config: unknown): Record<string, unknown>[] {
  const blocks = [readRuleBlock(config)];
  if (typeof config === "object" && config !== null) {
    const overrides = Reflect.get(config, "overrides");
    if (Array.isArray(overrides)) {
      for (const override of overrides) blocks.push(readRuleBlock(override));
    }
  }
  return blocks;
}

export function listConfiguredRules(
  configText: string,
  rules: Iterable<string>,
): ReadonlySet<string> {
  let config: unknown;
  try {
    config = JSON.parse(stripJsonComments(configText));
  } catch {
    // An unreadable config cannot prove a rule is on, and claiming every
    // removal is a fix would be the wrong way to be wrong.
    return new Set<string>();
  }
  const blocks = listRuleBlocks(config);
  const configured = new Set<string>();
  for (const rule of rules) {
    if (blocks.some((block) => isSeverityOn(block[rule]))) configured.add(rule);
  }
  return configured;
}
