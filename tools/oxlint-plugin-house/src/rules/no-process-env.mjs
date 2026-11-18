// The selectors below cover every way source can reach `process.env`.
const MEMBER_SELECTORS = [
  'MemberExpression[object.name="process"][property.name="env"]',
  'MemberExpression[object.name="process"][property.value="env"]',
  'MemberExpression[object.property.name="process"][property.name="env"]',
  'MemberExpression[object.property.name="process"][property.value="env"]',
  'MemberExpression[object.property.value="process"][property.name="env"]',
  'MemberExpression[object.property.value="process"][property.value="env"]',
  'VariableDeclarator[id.type="ObjectPattern"][init.name="process"]',
  'VariableDeclarator[id.type="ObjectPattern"][init.property.name="process"]',
  'VariableDeclarator[id.type="ObjectPattern"][init.property.value="process"]',
];

const IMPORT_SELECTORS = [
  'ImportDeclaration[source.value="process"]',
  'ImportDeclaration[source.value="node:process"]',
];

/** @type {import("../types").RuleDefinition} */
export const noProcessEnv = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Read environment variables in one place. Only a file listed as a composition root may use `process.env`; every other file takes the value it needs as a parameter.",
    },
    messages: {
      member:
        "Only a composition root reads `process.env`, however it is reached; take the value as a parameter or through injected deps.",
      import:
        "Importing `process` dodges the env rule; use the global in a composition root or take the value as a parameter.",
    },
  },
  create(context) {
    /** @type {import("../types").RuleVisitor} */
    const visitor = {};
    for (const selector of MEMBER_SELECTORS) {
      visitor[selector] = (node) => {
        context.report({ node, messageId: "member" });
      };
    }
    for (const selector of IMPORT_SELECTORS) {
      visitor[selector] = (node) => {
        context.report({ node, messageId: "import" });
      };
    }
    return visitor;
  },
};
