/** @type {import("../types").RuleDefinition} */
export const noConditionalSpread = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Conditional fields are assigned under an `if`, never spread from a conditional.",
    },
    messages: {
      violation:
        "Conditional fields are assigned, not spread: declare the object with its unconditional fields, then assign the optional one under an `if`.",
    },
  },
  create(context) {
    /** @param {import("../types").RuleNode} node */
    function reportSpread(node) {
      context.report({ node, messageId: "violation" });
    }

    return {
      "ObjectExpression > SpreadElement > ConditionalExpression": reportSpread,
      "ObjectExpression > SpreadElement > LogicalExpression": reportSpread,
    };
  },
};
