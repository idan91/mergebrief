/** @type {import("../types").RuleDefinition} */
export const noBlankTarget = {
  meta: {
    type: "problem",
    docs: { description: 'No `target="_blank"` on a raw `<a>`.' },
    messages: {
      violation:
        'target="_blank" on a raw <a> is banned: use AccessibleLink, which defaults rel and announces the new tab.',
    },
  },
  create(context) {
    return {
      'JSXOpeningElement[name.name="a"] > JSXAttribute[name.name="target"][value.value="_blank"]'(
        node,
      ) {
        context.report({ node, messageId: "violation" });
      },
    };
  },
};
