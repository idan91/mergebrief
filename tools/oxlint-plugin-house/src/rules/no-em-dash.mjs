import { readTestTitle } from "./test-titles.mjs";

const EM_DASH = "—";

/** @type {import("../types").RuleDefinition} */
export const noEmDash = {
  meta: {
    type: "suggestion",
    docs: { description: "Comments and test titles carry no em-dash." },
    messages: {
      comment: "Em-dash in a comment; end the sentence or use a comma.",
      title: "Em-dash in a test title; end the sentence or use a comma.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.value.includes(EM_DASH)) {
            context.report({ loc: comment.loc, messageId: "comment" });
          }
        }
      },
      CallExpression(node) {
        const found = readTestTitle(node);
        if (found !== undefined && found.title.includes(EM_DASH)) {
          context.report({ node: found.node, messageId: "title" });
        }
      },
    };
  },
};
