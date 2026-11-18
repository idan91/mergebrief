/** @type {import("../types").RuleDefinition} */
export const noEnum = {
  meta: {
    type: "problem",
    docs: { description: "No `enum`; use an `as const` map plus `ValueOf`." },
    messages: {
      violation:
        "No `enum`: use an `as const` map with SHOUT_CASE keys and kebab-case string values, plus `ValueOf<typeof Map>` for the union type.",
    },
  },
  create(context) {
    return {
      TSEnumDeclaration(node) {
        context.report({ node, messageId: "violation" });
      },
    };
  },
};
