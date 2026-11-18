import stylelint from "stylelint";

const {
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = "house/custom-property-no-raw-value";

const OWNERS =
  "read a token from src/styles/tokens.scss, or build the shadow with functions.edge-bar, functions.ring or functions.inset-ring.";

/**
 * @param {string} holder
 * @param {string} problem
 */
function describeRawValue(holder, problem) {
  return `A module ${holder} holds ${problem}: ${OWNERS}`;
}

const messages = ruleMessages(ruleName, { rawValue: describeRawValue });

const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const HEX_COLOR = /#[0-9a-f]{3,8}(?![\w-])/i;
const LENGTH = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:px)?`;
const SHADOW_GEOMETRY = new RegExp(
  String.raw`(?:^|[\s,(])${LENGTH}(?:\s+${LENGTH}){1,3}(?=$|[\s,)])`,
  "g",
);
const NONZERO_PIXEL_LENGTH = /(?:[1-9]\d*\.?\d*|0?\.\d*[1-9]\d*)px/;
const GRADIENT_OR_URL = /(?<![\w-])(?:[\w-]*gradient|url)\(/gi;
const INTERPOLATION_START = "#{";
const SHAPE_BUILDER = /^\s*functions\.(?!to-rem\()/;
const PLACEHOLDER_LENGTH = " 1px ";
const TO_REM_CALL = /functions\.to-rem\([^()]*(?:\([^()]*\)[^()]*)*\)/g;
const SASS_VARIABLE = /(?<![\w$-])(?:[\w-]+\.)?\$[\w-]+/g;

/** The value with every gradient and url() call blanked: their stop and
 * position lengths are not shadow geometry. */
function stripGradients(value) {
  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(GRADIENT_OR_URL)) {
    if (match.index < cursor) {
      continue;
    }
    result += value.slice(cursor, match.index);
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < value.length; end += 1) {
      depth += value[end] === "(" ? 1 : 0;
      depth -= value[end] === ")" ? 1 : 0;
      if (depth === 0) {
        break;
      }
    }
    cursor = end + 1;
  }
  return result + value.slice(cursor);
}

/** The value with every `#{...}` read as a nonzero length, unless it calls a
 * shared builder (`functions.edge-bar` and kin) that owns its geometry. */
function readInterpolationsAsLengths(value) {
  let result = "";
  let cursor = 0;
  let start = value.indexOf(INTERPOLATION_START);
  while (start !== -1) {
    let depth = 0;
    let end = start + 1;
    for (; end < value.length; end += 1) {
      depth += value[end] === "{" ? 1 : 0;
      depth -= value[end] === "}" ? 1 : 0;
      if (depth === 0) {
        break;
      }
    }
    const inner = value.slice(start + INTERPOLATION_START.length, end);
    const replacement = SHAPE_BUILDER.test(inner)
      ? value.slice(start, end + 1)
      : PLACEHOLDER_LENGTH;
    result += value.slice(cursor, start) + replacement;
    cursor = end + 1;
    start = value.indexOf(INTERPOLATION_START, cursor);
  }
  return result + value.slice(cursor);
}

/** A Sass variable's value with each length Sass computes read as one. */
function readSassLengths(value) {
  return value
    .replace(TO_REM_CALL, PLACEHOLDER_LENGTH)
    .replace(SASS_VARIABLE, PLACEHOLDER_LENGTH);
}

function hasShadowGeometry(value) {
  for (const match of stripGradients(value).matchAll(SHADOW_GEOMETRY)) {
    if (NONZERO_PIXEL_LENGTH.test(match[0])) {
      return true;
    }
  }
  return false;
}

function findRawValue(declaration) {
  const isSassVariable = declaration.prop.startsWith("$");
  const holder = isSassVariable ? "Sass variable" : "custom property";
  const { value } = declaration;
  if (COLOR_FUNCTION.test(value)) {
    return messages.rawValue(holder, "a raw colour function");
  }
  if (HEX_COLOR.test(value)) {
    return messages.rawValue(holder, "a raw hex colour");
  }
  const interpolated = readInterpolationsAsLengths(value);
  const geometry = isSassVariable
    ? readSassLengths(interpolated)
    : interpolated;
  if (hasShadowGeometry(geometry)) {
    return messages.rawValue(holder, "raw shadow geometry");
  }
  return undefined;
}

/** A Sass function's locals build its return value, not a shadow. */
function isInsideSassFunction(node) {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "function") {
      return true;
    }
  }
  return false;
}

function checkCustomProperties(enabled) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: enabled })) {
      return;
    }

    root.walkDecls(/^(--|\$)/, (declaration) => {
      if (
        declaration.prop.startsWith("$") &&
        isInsideSassFunction(declaration)
      ) {
        return;
      }
      const message = findRawValue(declaration);
      if (message !== undefined) {
        report({
          message,
          node: declaration,
          result,
          ruleName,
          word: declaration.prop,
        });
      }
    });
  };
}

export const rule = Object.assign(checkCustomProperties, {
  ruleName,
  messages,
});
