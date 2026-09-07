// Shared reader for the rules that look at vitest titles.
const TEST_CALLEES = new Set(["it", "test", "describe"]);
const MODIFIERS = new Set([
  "skip",
  "only",
  "todo",
  "concurrent",
  "sequential",
  "fails",
]);

/**
 * @param {import("../types").RuleNode} node
 * @returns {boolean}
 */
function namesTestCallee(node) {
  return node.type === "Identifier" && TEST_CALLEES.has(node.name ?? "");
}

/**
 * True for `it`, `it.skip`, `it.only`, `it.todo`, `it.each(table)`, and the
 * `test` and `describe` forms of the same.
 * @param {import("../types").RuleNode} callee
 * @returns {boolean}
 */
function isTestCallee(callee) {
  if (namesTestCallee(callee)) return true;
  if (callee.type === "MemberExpression" && callee.object !== undefined) {
    const propertyName = callee.property?.name ?? "";
    const knownForm = MODIFIERS.has(propertyName) || propertyName === "each";
    return knownForm && isTestCallee(callee.object);
  }
  if (callee.type === "CallExpression" && callee.callee !== undefined) {
    const inner = callee.callee;
    const isEach =
      inner.type === "MemberExpression" && inner.property?.name === "each";
    return isEach && inner.object !== undefined && isTestCallee(inner.object);
  }
  return false;
}

/**
 * The static title of a test call, or undefined when the first argument is
 * not a plain string or an expression-free template literal.
 * @param {import("../types").RuleNode} node
 * @returns {{ title: string, node: import("../types").RuleNode } | undefined}
 */
export function readTestTitle(node) {
  if (node.type !== "CallExpression" || node.callee === undefined)
    return undefined;
  if (!isTestCallee(node.callee)) return undefined;
  const first = node.arguments?.[0];
  if (first === undefined) return undefined;

  if (first.type === "Literal" && typeof first.value === "string") {
    return { title: first.value, node: first };
  }
  if (first.type === "TemplateLiteral" && first.expressions?.length === 0) {
    const cooked = first.quasis?.[0]?.value.cooked;
    if (typeof cooked === "string") return { title: cooked, node: first };
  }
  return undefined;
}
