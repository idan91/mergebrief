// eslint-plugin-i18next skips every string under a SHOUT_CASE const by design
// (`const A_B = "test"`), function bodies, call arguments and JSX included.
// This rule walks the same subtree with i18next's own exemptions (callees,
// attributes, comparisons, default params, member keys, case labels) and
// reports what i18next would have called copy: Capitalised, or two words.
const SHOUT_CASE = /^[A-Z_-]+$/;
const CAPITALISED = /^[A-Z][a-z]/;
const TWO_WORDS = /[A-Za-z] [A-Za-z(]/;
const VALUE_TS_NODES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
]);
const SKIPPED_FIELDS = new Set(["parent", "loc", "range", "key", "type"]);

/** @param {string} text */
function isCopyShaped(text) {
  const trimmed = text.trim();
  const copyShaped = CAPITALISED.test(trimmed) || TWO_WORDS.test(trimmed);
  return copyShaped;
}

/**
 * @param {unknown} value
 * @returns {value is import("../types").RuleNode}
 */
function isRuleNode(value) {
  const typedObject =
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "type") === "string";
  return typedObject;
}

/**
 * @param {unknown} option
 * @param {string} field
 * @returns {readonly string[]}
 */
function readStringList(option, field) {
  if (typeof option !== "object" || option === null) {
    return [];
  }
  const list = Reflect.get(option, field);
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry) => typeof entry === "string");
}

/**
 * i18next's matching: a pattern may follow any dotted prefix and must reach
 * the end of the name.
 * @param {readonly string[]} patterns
 * @returns {readonly RegExp[]}
 */
function compileNamePatterns(patterns) {
  return patterns.map((pattern) => {
    const ending = pattern.endsWith("$") ? "" : "$";
    return new RegExp(`^(?:.*\\.)?${pattern}${ending}`);
  });
}

/**
 * @param {readonly RegExp[]} patterns
 * @param {string | undefined} name
 */
function matchesAny(patterns, name) {
  if (name === undefined) {
    return false;
  }
  const matched = patterns.some((pattern) => pattern.test(name));
  return matched;
}

/** @param {import("../types").RuleNode | undefined} key */
function readKeyName(key) {
  if (key?.type === "Identifier") {
    return key.name;
  }
  if (key?.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }
  return undefined;
}

/**
 * The dotted path a callee is written as (`deps.logger.warn`).
 * @param {import("../types").RuleNode | undefined} callee
 * @returns {string | undefined}
 */
function readCalleePath(callee) {
  if (callee?.type === "Identifier") {
    return callee.name;
  }
  if (callee?.type === "ThisExpression") {
    return "this";
  }
  if (callee?.type !== "MemberExpression") {
    return undefined;
  }
  const object = readCalleePath(callee.object);
  const property = callee.property?.name;
  const unnamed = object === undefined || property === undefined;
  if (unnamed) {
    return undefined;
  }
  return `${object}.${property}`;
}

/** @param {import("../types").RuleNode} attribute */
function readAttributeName(attribute) {
  const name = Reflect.get(attribute, "name");
  if (!isRuleNode(name)) {
    return undefined;
  }
  const text = Reflect.get(name, "name");
  return typeof text === "string" ? text : undefined;
}

/**
 * @param {import("../types").RuleNode} node
 * @returns {import("../types").RuleNode[]}
 */
function collectFields(node) {
  const children = [];
  for (const [field, value] of Object.entries(node)) {
    if (SKIPPED_FIELDS.has(field)) {
      continue;
    }
    if (isRuleNode(value)) {
      children.push(value);
    } else if (Array.isArray(value)) {
      children.push(...value.filter((entry) => isRuleNode(entry)));
    }
  }
  return children;
}

/**
 * i18next exempts a comparison's operands, a default parameter, a literal
 * member key and a literal case label.
 * @param {import("../types").RuleNode} node
 * @returns {import("../types").RuleNode[]}
 */
function collectChildren(node) {
  const isComparison =
    node.type === "BinaryExpression" && Reflect.get(node, "operator") !== "+";
  if (isComparison || node.type === "AssignmentPattern") {
    return [];
  }
  const children = collectFields(node);
  if (node.type === "MemberExpression") {
    return children.filter((child) => child.type !== "Literal");
  }
  if (node.type === "SwitchCase") {
    const test = Reflect.get(node, "test");
    return children.filter((child) => {
      const literalLabel = child === test && child.type === "Literal";
      return !literalLabel;
    });
  }
  return children;
}

/**
 * @param {import("../types").RuleNode} node
 * @returns {boolean}
 */
function carriesCopy(node) {
  if (node.type === "Literal" || node.type === "JSXText") {
    if (typeof node.value !== "string") {
      return false;
    }
    return isCopyShaped(node.value);
  }
  if (node.type === "TemplateLiteral") {
    return (node.quasis ?? []).some((quasi) =>
      isCopyShaped(quasi.value.cooked ?? ""),
    );
  }
  return false;
}

/** @type {import("../types").RuleDefinition} */
export const noShoutCaseCopy = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Copy behind a SHOUT_CASE const still goes through the i18n catalog.",
    },
    schema: [
      {
        type: "object",
        properties: {
          ignoreKeys: { type: "array", items: { type: "string" } },
          ignoreCallees: { type: "array", items: { type: "string" } },
          ignoreAttributes: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      violation:
        "Copy behind the SHOUT_CASE const `{{name}}`: move it to the i18n catalog.",
    },
  },
  create(context) {
    const options = context.options[0];
    const ignoreKeys = new Set(readStringList(options, "ignoreKeys"));
    const ignoreCallees = compileNamePatterns(
      readStringList(options, "ignoreCallees"),
    );
    const ignoreAttributes = compileNamePatterns(
      readStringList(options, "ignoreAttributes"),
    );

    /** @param {import("../types").RuleNode} node */
    function isSkipped(node) {
      const typeOnly =
        node.type.startsWith("TS") && !VALUE_TS_NODES.has(node.type);
      if (typeOnly) {
        return true;
      }
      switch (node.type) {
        case "JSXAttribute":
          return matchesAny(ignoreAttributes, readAttributeName(node));
        case "Property":
          return ignoreKeys.has(readKeyName(node.key) ?? "");
        case "CallExpression":
        case "NewExpression":
          return matchesAny(ignoreCallees, readCalleePath(node.callee));
        case "TaggedTemplateExpression": {
          const tag = Reflect.get(node, "tag");
          if (!isRuleNode(tag)) {
            return false;
          }
          return matchesAny(ignoreCallees, readCalleePath(tag));
        }
        default:
          return false;
      }
    }

    return {
      VariableDeclarator(node) {
        const name = node.id?.type === "Identifier" ? node.id.name : undefined;
        const shoutCaseCopy =
          name !== undefined && SHOUT_CASE.test(name) && node.init;
        if (!shoutCaseCopy) {
          return;
        }
        const pending = [node.init];
        while (pending.length > 0) {
          const current = pending.pop();
          if (current === undefined) {
            break;
          }
          if (isSkipped(current)) {
            continue;
          }
          if (carriesCopy(current)) {
            context.report({
              node: current,
              messageId: "violation",
              data: { name },
            });
          }
          pending.push(...collectChildren(current));
        }
      },
    };
  },
};
