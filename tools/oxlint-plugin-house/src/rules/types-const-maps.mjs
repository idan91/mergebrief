/** @param {import("../types").RuleNode | undefined} typeAnnotation */
function isConstKeyword(typeAnnotation) {
  if (typeAnnotation === undefined) {
    return false;
  }
  if (typeAnnotation.type === "TSConstKeyword") {
    return true;
  }
  if (typeAnnotation.name === "const") {
    return true;
  }
  return (
    typeAnnotation.type === "TSTypeReference" &&
    typeAnnotation.typeName?.name === "const"
  );
}

/** @param {import("../types").RuleNode | undefined} node */
function isAsConstMap(node) {
  if (node === undefined) {
    return false;
  }
  if (node.type === "TSSatisfiesExpression") {
    return isAsConstMap(node.expression);
  }
  if (node.type !== "TSAsExpression") {
    return false;
  }
  if (!isConstKeyword(node.typeAnnotation)) {
    return false;
  }
  return node.expression?.type === "ObjectExpression";
}

/** @param {string} filename */
function isTypesSurface(filename) {
  const normalized = filename.replaceAll("\\", "/");
  return (
    normalized.includes("/packages/types/") ||
    normalized.includes("/types-const-maps/")
  );
}

/** @type {import("../types").RuleDefinition} */
export const typesConstMaps = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Runtime in packages/types is as const maps only: no functions, no classes, no other values.",
    },
    messages: {
      helper:
        "packages/types may not export functions or classes; runtime is as const maps only.",
      notMap:
        "A runtime value in packages/types must be an `as const` object map.",
    },
  },
  create(context) {
    if (!isTypesSurface(context.filename)) {
      return {};
    }
    return {
      FunctionDeclaration(node) {
        context.report({ node, messageId: "helper" });
      },
      ClassDeclaration(node) {
        context.report({ node, messageId: "helper" });
      },
      VariableDeclarator(node) {
        if (isAsConstMap(node.init ?? undefined)) {
          return;
        }
        context.report({ node, messageId: "notMap" });
      },
    };
  },
};
