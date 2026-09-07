/** @type {import("../types").RuleDefinition} */
export const noRawButton = {
  meta: {
    type: "problem",
    docs: {
      description: "Raw `<button>` is banned outside the shared components.",
    },
    messages: {
      violation:
        "Raw <button> is banned: use the shared Button/IconButton/RowButton/ToolbarButton/Chip/MenuItem/LinkButton. A deliberately bespoke affordance carries an oxlint-disable-next-line with its reason.",
    },
  },
  create(context) {
    return {
      'JSXOpeningElement[name.name="button"]'(node) {
        context.report({ node, messageId: "violation" });
      },
    };
  },
};
