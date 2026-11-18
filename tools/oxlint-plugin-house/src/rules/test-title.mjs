import { readTestTitle } from "./test-titles.mjs";

const DEFAULT_MAX_LENGTH = 70;

/**
 * @param {unknown} option
 * @returns {number}
 */
function readMaxLength(option) {
  if (
    typeof option !== "object" ||
    option === null ||
    !("maxLength" in option)
  ) {
    return DEFAULT_MAX_LENGTH;
  }
  const value = option.maxLength;
  return typeof value === "number" ? value : DEFAULT_MAX_LENGTH;
}

/** @type {import("../types").RuleDefinition} */
export const testTitle = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "A test title names the behaviour in at most 70 characters, with no parenthetical.",
    },
    schema: [
      {
        type: "object",
        properties: { maxLength: { type: "integer" } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        "Test title is {{length}} characters; the cap is {{max}}. Name the behaviour, not the setup.",
      parenthetical:
        "Test title carries a parenthetical; say it in the sentence or drop it.",
    },
  },
  create(context) {
    const maxLength = readMaxLength(context.options[0]);
    return {
      CallExpression(node) {
        const found = readTestTitle(node);
        if (found === undefined) {
          return;
        }
        if (found.title.length > maxLength) {
          context.report({
            node: found.node,
            messageId: "tooLong",
            data: {
              length: String(found.title.length),
              max: String(maxLength),
            },
          });
        }
        if (found.title.includes("(")) {
          context.report({ node: found.node, messageId: "parenthetical" });
        }
      },
    };
  },
};
