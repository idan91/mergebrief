const DEFAULT_MAX_RATIO = 0.4;
const MIN_LINES = 30;

/**
 * @param {unknown} option
 * @returns {number}
 */
function readMaxRatio(option) {
  if (
    typeof option !== "object" ||
    option === null ||
    !("maxRatio" in option)
  ) {
    return DEFAULT_MAX_RATIO;
  }
  const value = option.maxRatio;
  return typeof value === "number" ? value : DEFAULT_MAX_RATIO;
}

/** @type {import("../types").RuleDefinition} */
export const commentDensity = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "A file that is mostly comment is harder to read, not easier. `comment-run` caps one block; this caps how much of the file is prose.",
    },
    schema: [
      {
        type: "object",
        properties: { maxRatio: { type: "number" } },
        additionalProperties: false,
      },
    ],
    messages: {
      dense:
        "{{percent}}% of this file is comment ({{comment}} comment lines to {{code}} code lines); the cap is {{cap}}%. Delete the comments that restate the code rather than shortening them.",
    },
  },
  create(context) {
    const cap = readMaxRatio(context.options[0]);

    return {
      Program(node) {
        const lines = context.sourceCode.lines;
        const commented = new Set();

        for (const comment of context.sourceCode.getAllComments()) {
          for (let n = comment.loc.start.line; n <= comment.loc.end.line; n++) {
            commented.add(n);
          }
        }

        let code = 0;
        for (const [index, text] of lines.entries()) {
          if (text.trim() === "" || commented.has(index + 1)) {
            continue;
          }
          code += 1;
        }

        const comment = commented.size;
        const total = comment + code;
        if (total < MIN_LINES || comment / total <= cap) {
          return;
        }

        context.report({
          node,
          messageId: "dense",
          data: {
            percent: String(Math.round((comment / total) * 100)),
            comment: String(comment),
            code: String(code),
            cap: String(Math.round(cap * 100)),
          },
        });
      },
    };
  },
};
