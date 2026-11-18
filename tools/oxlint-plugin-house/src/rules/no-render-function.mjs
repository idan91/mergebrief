/** @type {import("../types").RuleDefinition} */
export const noRenderFunction = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A render-prefixed function is a sub-component in disguise.",
    },
    messages: {
      violation:
        "A `render*` function outside tests is a sub-component: give it a PascalCase name and render it as an element.",
    },
  },
  create(context) {
    return {
      "FunctionDeclaration > Identifier.id[name=/^render[A-Z]/]"(node) {
        context.report({ node, messageId: "violation" });
      },
      "VariableDeclarator > Identifier.id[name=/^render[A-Z]/]"(node) {
        context.report({ node, messageId: "violation" });
      },
    };
  },
};
