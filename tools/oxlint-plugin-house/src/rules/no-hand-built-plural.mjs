// A conditional whose two branches are the literals "" and "s" is a plural
// built by hand; copy pluralises through `_one`/`_other` keys with `count`.
const SELECTORS = [
  'ConditionalExpression[consequent.value=""][alternate.value="s"]',
  'ConditionalExpression[consequent.value="s"][alternate.value=""]',
];

/** @type {import("../types").RuleDefinition} */
export const noHandBuiltPlural = {
  meta: {
    type: "problem",
    docs: {
      description: "Plurals go through the catalog, never a hand-built suffix.",
    },
    messages: {
      violation:
        'Hand-built plural: use an `_one`/`_other` catalog key with `count` instead of appending "s".',
    },
  },
  create(context) {
    /** @type {import("../types").RuleVisitor} */
    const visitor = {};
    for (const selector of SELECTORS) {
      visitor[selector] = (node) => {
        context.report({ node, messageId: "violation" });
      };
    }
    return visitor;
  },
};
