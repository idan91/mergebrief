const DEFAULT_MAX_CONTENT_LINES = 4;

/**
 * @param {unknown} option
 * @returns {number}
 */
function readMaxContentLines(option) {
  if (
    typeof option !== "object" ||
    option === null ||
    !("maxContentLines" in option)
  ) {
    return DEFAULT_MAX_CONTENT_LINES;
  }
  const value = option.maxContentLines;
  return typeof value === "number" ? value : DEFAULT_MAX_CONTENT_LINES;
}

/**
 * Content lines of a block comment: lines with text beyond the frame
 * characters (`/**`, `*`, `*\/`).
 * @param {string} value
 * @returns {number}
 */
function countBlockContentLines(value) {
  let count = 0;
  for (const raw of value.split("\n")) {
    const line = raw.trim().replace(/^\*+/, "").trim();
    if (line.length > 0) {
      count += 1;
    }
  }
  return count;
}

/** @type {import("../types").RuleDefinition} */
export const commentRun = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A comment run of five or more content lines is a defect.",
    },
    schema: [
      {
        type: "object",
        properties: { maxContentLines: { type: "integer" } },
        additionalProperties: false,
      },
    ],
    messages: {
      run: "Comment run of {{lines}} lines; the cap is {{max}}. State the one constraint the code cannot show.",
    },
  },
  create(context) {
    const max = readMaxContentLines(context.options[0]);
    const lines = context.sourceCode.lines;

    /** @param {import("../types").RuleComment} comment */
    function ownsItsLine(comment) {
      const text = lines[comment.loc.start.line - 1] ?? "";
      return text.trimStart().startsWith("//");
    }

    return {
      Program() {
        const comments = context.sourceCode.getAllComments();
        /** @type {import("../types").RuleComment[]} */
        let run = [];
        const flushRun = () => {
          const contentLines = run.filter(
            (comment) => comment.value.trim().length > 0,
          ).length;
          if (run.length > 0 && contentLines > max) {
            const first = run[0];
            const last = run[run.length - 1];
            if (first !== undefined && last !== undefined) {
              context.report({
                loc: { start: first.loc.start, end: last.loc.end },
                messageId: "run",
                data: { lines: String(contentLines), max: String(max) },
              });
            }
          }
          run = [];
        };

        for (const comment of comments) {
          if (comment.type === "Block") {
            flushRun();
            const contentLines = countBlockContentLines(comment.value);
            if (contentLines > max) {
              context.report({
                loc: comment.loc,
                messageId: "run",
                data: { lines: String(contentLines), max: String(max) },
              });
            }
            continue;
          }
          if (comment.type !== "Line" || !ownsItsLine(comment)) {
            flushRun();
            continue;
          }
          const previous = run[run.length - 1];
          if (
            previous !== undefined &&
            comment.loc.start.line !== previous.loc.end.line + 1
          ) {
            flushRun();
          }
          run.push(comment);
        }
        flushRun();
      },
    };
  },
};
