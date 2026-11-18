// Anchored to `^\.`: bare package names that end in a matched extension
// (`highlight.js`, `crypto-js/sha256.js`) must pass.
const RELATIVE_TS_JS_EXTENSION = String.raw`/^\..*\.[cm]?[jt]sx?$/`;

const MESSAGE =
  "Import without the file extension (`./tenant`, not `./tenant.js`); every package is bundler-resolved end to end. Extensions stay only on non-TS assets (.css, .scss, .json).";

const SELECTORS = [
  `ImportDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
  `ExportNamedDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
  `ExportAllDeclaration[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
  `ImportExpression[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
  // Type-position `typeof import("./x.js")`.
  `TSImportType[source.value=${RELATIVE_TS_JS_EXTENSION}]`,
];

/** @type {import("../types").RuleDefinition} */
export const extensionlessImport = {
  meta: {
    type: "problem",
    docs: { description: "Relative imports carry no file extension." },
    messages: { violation: MESSAGE },
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
