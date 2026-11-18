import { posix } from "node:path";

const BARREL_NAMES = new Set(["index.ts", "index.tsx"]);
const SELF_EXTENSIONS = new Set(["", ".ts", ".tsx"]);
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/**
 * @typedef {object} ImportBinding
 * @property {string} source
 * @property {boolean} namespace
 */
/** @typedef {ReadonlyMap<string, ImportBinding>} Bindings */
/**
 * @typedef {object} LocalAlias
 * @property {string} local
 * @property {(bindings: Bindings) => ImportBinding | undefined} resolve
 */
/** @typedef {import("../types").RuleNode} RuleNode */

/** @param {string} filename */
function isBarrel(filename) {
  const normalized = filename.replaceAll("\\", "/");
  const basename = posix.basename(normalized);
  return BARREL_NAMES.has(basename);
}

/** @param {string} normalized */
function isOwnBarrel(normalized) {
  const parsed = posix.parse(normalized);
  const atFolderLevel = parsed.dir === "" && parsed.name === "index";
  const selfExtension = SELF_EXTENSIONS.has(parsed.ext);
  const ownBarrel = atFolderLevel && selfExtension;
  return ownBarrel;
}

/** @param {string} source */
function staysInsideFolder(source) {
  const slashed = source.replaceAll("\\", "/");
  const relative = slashed.startsWith("./");
  if (!relative) {
    return false;
  }

  const normalized = posix.normalize(slashed);
  const climbsOut = normalized.startsWith("../");
  const climbs = normalized === ".." || climbsOut;
  const self = normalized === "." || normalized === "./";
  const ownBarrel = isOwnBarrel(normalized);
  const inside = !climbs && !self && !ownBarrel;
  return inside;
}

/**
 * @param {RuleNode["body"]} body
 * @returns {body is readonly RuleNode[]}
 */
function isStatementList(body) {
  return Array.isArray(body);
}

/**
 * @param {RuleNode["body"]} body
 * @returns {readonly RuleNode[] | undefined}
 */
function readStatementList(body) {
  const statementList = isStatementList(body);
  return statementList ? body : undefined;
}

/**
 * @param {RuleNode["body"]} body
 * @returns {RuleNode | undefined}
 */
function readBlock(body) {
  const statementList = isStatementList(body);
  return statementList ? undefined : body;
}

/**
 * @param {RuleNode | null | undefined} node
 * @returns {string | undefined}
 */
function readStringValue(node) {
  const value = node?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * @param {RuleNode} node
 * @returns {string | undefined}
 */
function readSource(node) {
  return readStringValue(node.source);
}

/**
 * @param {string | undefined} name
 * @param {Bindings} bindings
 * @returns {ImportBinding | undefined}
 */
function lookupBinding(name, bindings) {
  return name === undefined ? undefined : bindings.get(name);
}

/**
 * @param {RuleNode | null | undefined} node
 * @returns {RuleNode | undefined}
 */
function unwrapTypeWrappers(node) {
  let expression = node ?? undefined;
  while (expression !== undefined) {
    const wrapped = TYPE_WRAPPERS.has(expression.type);
    if (!wrapped) {
      return expression;
    }
    expression = expression.expression;
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {value is RuleNode}
 */
function isRuleNode(value) {
  const isObject = typeof value === "object" && value !== null;
  const typed = isObject && "type" in value && typeof value.type === "string";
  return typed;
}

/**
 * @param {RuleNode | undefined} value
 * @returns {RuleNode | undefined}
 */
function unwrapDefault(value) {
  return value?.type === "AssignmentPattern" ? value.left : value;
}

/**
 * The names an object pattern binds straight off a member. A default fills in
 * only when the member is undefined, so it still binds one; a rest element
 * builds a new object and a nested pattern reads a member of a member, so
 * neither does.
 * @param {RuleNode} pattern
 * @returns {string[]}
 */
function readPatternLocals(pattern) {
  /** @type {string[]} */
  const locals = [];
  for (const property of pattern.properties ?? []) {
    const value = property.type === "Property" ? property.value : undefined;
    const node = isRuleNode(value) ? value : undefined;
    const local = unwrapDefault(node);
    if (local?.type === "Identifier" && local.name !== undefined) {
      locals.push(local.name);
    }
  }
  return locals;
}

/**
 * Destructuring reads members, so only a namespace binds through it.
 * @param {RuleNode} init
 * @param {Bindings} bindings
 * @returns {ImportBinding | undefined}
 */
function readDestructuredBinding(init, bindings) {
  const binding = readExpressionBinding(init, bindings);
  return binding?.namespace
    ? { source: binding.source, namespace: false }
    : undefined;
}

/**
 * @param {RuleNode} declarator
 * @returns {LocalAlias[]}
 */
function readDeclaratorAliases(declarator) {
  const id = declarator.id;
  const init = declarator.init ?? undefined;
  if (init === undefined) {
    return [];
  }

  const name = id?.type === "Identifier" ? id.name : undefined;
  if (name !== undefined) {
    return [
      {
        local: name,
        resolve: (bindings) => readExpressionBinding(init, bindings),
      },
    ];
  }
  if (id?.type !== "ObjectPattern") {
    return [];
  }
  return readPatternLocals(id).map((local) => ({
    local,
    resolve: (bindings) => readDestructuredBinding(init, bindings),
  }));
}

/**
 * @param {RuleNode} statement
 * @returns {LocalAlias[]}
 */
function readVariableAliases(statement) {
  if (statement.type !== "VariableDeclaration") {
    return [];
  }
  return (statement.declarations ?? []).flatMap(readDeclaratorAliases);
}

/**
 * @param {RuleNode} statement
 * @returns {LocalAlias[]}
 */
function readTypeAliases(statement) {
  const local = statement.id?.name;
  const namedTypeAlias =
    statement.type === "TSTypeAliasDeclaration" && local !== undefined;
  if (!namedTypeAlias) {
    return [];
  }
  return [
    {
      local,
      resolve: (bindings) => readTypeAliasBinding(statement, bindings),
    },
  ];
}

/**
 * @param {RuleNode} statement
 * @param {Map<string, ImportBinding>} bindings
 */
function collectImportBindings(statement, bindings) {
  const source = readSource(statement);
  if (source === undefined) {
    return;
  }
  for (const specifier of statement.specifiers ?? []) {
    const name = specifier.local?.name;
    if (name !== undefined) {
      const namespace = specifier.type === "ImportNamespaceSpecifier";
      bindings.set(name, { source, namespace });
    }
  }
}

/**
 * `import X = require("mod")` binds the whole module; `import X = ns.Y` binds
 * one member of a binding that must already be known.
 * @param {RuleNode} statement
 * @param {Map<string, ImportBinding>} bindings
 */
function collectImportEqualsBinding(statement, bindings) {
  const name = statement.id?.name;
  const reference = statement.moduleReference;
  const source = readModuleReferenceSource(reference, bindings);
  const unresolved = name === undefined || source === undefined;
  if (unresolved) {
    return;
  }
  const namespace = reference?.type === "TSExternalModuleReference";
  bindings.set(name, { source, namespace });
}

/**
 * @param {LocalAlias} alias
 * @param {Map<string, ImportBinding>} bindings
 * @returns {boolean}
 */
function bindAlias(alias, bindings) {
  const binding = alias.resolve(bindings);
  if (binding === undefined) {
    return false;
  }
  bindings.set(alias.local, binding);
  return true;
}

/**
 * A type alias may name one declared after it, so type aliases resolve in
 * passes until a pass binds nothing new. A cycle never binds.
 * @param {readonly LocalAlias[]} aliases
 * @param {Map<string, ImportBinding>} bindings
 */
function bindTypeAliases(aliases, bindings) {
  let pending = aliases;
  let boundAny = true;
  while (boundAny) {
    const unbound = pending.filter((alias) => !bindAlias(alias, bindings));
    boundAny = unbound.length < pending.length;
    pending = unbound;
  }
}

/**
 * Every local name bound to an import, mapped to the module it names: the
 * import's own bindings plus every top-level variable and `type` alias over
 * them. ES imports are hoisted, so they resolve before any `import =` that
 * names one of them. Variables cannot be read before their declaration, so
 * they resolve in source order through the earlier links.
 * @param {readonly RuleNode[]} body
 * @returns {Bindings}
 */
function collectBindings(body) {
  /** @type {Map<string, ImportBinding>} */
  const bindings = new Map();
  /** @type {RuleNode[]} */
  const importEquals = [];
  /** @type {LocalAlias[]} */
  const variableAliases = [];
  /** @type {LocalAlias[]} */
  const typeAliases = [];

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      collectImportBindings(statement, bindings);
    }
    if (statement.type === "TSImportEqualsDeclaration") {
      importEquals.push(statement);
    }
    variableAliases.push(...readVariableAliases(statement));
    typeAliases.push(...readTypeAliases(statement));
  }

  for (const statement of importEquals) {
    collectImportEqualsBinding(statement, bindings);
  }
  for (const alias of variableAliases) {
    bindAlias(alias, bindings);
  }
  bindTypeAliases(typeAliases, bindings);
  return bindings;
}

/**
 * The import behind a value expression that is an imported name once type
 * wrappers are stripped, or a member read off a namespace import, which binds
 * one member rather than the namespace.
 * @param {RuleNode | null | undefined} node
 * @param {Bindings} bindings
 * @returns {ImportBinding | undefined}
 */
function readExpressionBinding(node, bindings) {
  const expression = unwrapTypeWrappers(node);
  if (expression?.type === "Identifier") {
    return lookupBinding(expression.name, bindings);
  }
  if (expression?.type !== "MemberExpression") {
    return undefined;
  }
  const source = readNamespaceMemberSource(expression.object, bindings);
  return source === undefined ? undefined : { source, namespace: false };
}

/**
 * @param {RuleNode | null | undefined} node
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readExpressionSource(node, bindings) {
  return readExpressionBinding(node, bindings)?.source;
}

/**
 * @param {RuleNode | undefined} object
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readNamespaceMemberSource(object, bindings) {
  if (object?.type !== "Identifier") {
    return undefined;
  }
  const binding = lookupBinding(object.name, bindings);
  return binding?.namespace ? binding.source : undefined;
}

/**
 * The source behind an entity name (`Imported` or `ns.Imported.Deeper`)
 * whose leftmost identifier an import binds.
 * @param {RuleNode | undefined} name
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readEntityNameSource(name, bindings) {
  let leftmost = name;
  while (leftmost?.type === "TSQualifiedName") {
    leftmost = leftmost.left;
  }
  if (leftmost?.type !== "Identifier") {
    return undefined;
  }
  return lookupBinding(leftmost.name, bindings)?.source;
}

/**
 * @param {RuleNode | undefined} type
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readTypeSource(type, bindings) {
  if (type?.typeArguments) {
    return undefined;
  }
  if (type?.type === "TSImportType") {
    return readSource(type);
  }
  if (type?.type === "TSTypeReference") {
    return readEntityNameSource(type.typeName, bindings);
  }
  return undefined;
}

/**
 * The source an alias forwards when it is `type U = T` or `type U =
 * import("mod").T` and nothing more: a type parameter or a type argument makes
 * it a new type rather than a re-export.
 * @param {RuleNode} declaration
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readTypeAliasSource(declaration, bindings) {
  if (declaration.typeParameters) {
    return undefined;
  }
  return readTypeSource(declaration.typeAnnotation, bindings);
}

/**
 * @param {RuleNode} declaration
 * @param {Bindings} bindings
 * @returns {ImportBinding | undefined}
 */
function readTypeAliasBinding(declaration, bindings) {
  const source = readTypeAliasSource(declaration, bindings);
  return source === undefined ? undefined : { source, namespace: false };
}

/**
 * @param {RuleNode | undefined} reference
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readModuleReferenceSource(reference, bindings) {
  if (reference?.type === "TSExternalModuleReference") {
    return readStringValue(reference.expression);
  }
  return readEntityNameSource(reference, bindings);
}

/**
 * An empty interface with one plain heritage clause renames the parent and
 * nothing more.
 * @param {RuleNode} declaration
 * @param {Bindings} bindings
 * @returns {string | undefined}
 */
function readInterfaceAliasSource(declaration, bindings) {
  const members = readStatementList(readBlock(declaration.body)?.body);
  const heritage = declaration.extends ?? [];
  const [clause] = heritage;
  const isRename =
    members?.length === 0 && heritage.length === 1 && !clause?.typeArguments;
  if (!isRename) {
    return undefined;
  }
  return readExpressionSource(clause?.expression, bindings);
}

/**
 * @param {RuleNode | null | undefined} declaration
 * @param {Bindings} bindings
 * @returns {string[]}
 */
function readDeclarationSources(declaration, bindings) {
  /** @type {string[]} */
  const sources = [];
  /** @param {string | undefined} source */
  function collect(source) {
    if (source !== undefined) {
      sources.push(source);
    }
  }

  if (declaration?.type === "VariableDeclaration") {
    for (const alias of readVariableAliases(declaration)) {
      collect(alias.resolve(bindings)?.source);
    }
  }
  if (declaration?.type === "TSTypeAliasDeclaration") {
    collect(readTypeAliasSource(declaration, bindings));
  }
  if (declaration?.type === "TSImportEqualsDeclaration") {
    collect(readModuleReferenceSource(declaration.moduleReference, bindings));
  }
  if (declaration?.type === "TSInterfaceDeclaration") {
    collect(readInterfaceAliasSource(declaration, bindings));
  }
  return sources;
}

/**
 * The modules a source-less `export` statement hands on: the imports behind
 * `export { a }` and behind the declaration it exports.
 * @param {RuleNode} statement
 * @param {Bindings} bindings
 * @returns {string[]}
 */
function readNamedExportSources(statement, bindings) {
  const sources = readDeclarationSources(statement.declaration, bindings);
  for (const specifier of statement.specifiers ?? []) {
    const binding = lookupBinding(specifier.local?.name, bindings);
    if (binding !== undefined) {
      sources.push(binding.source);
    }
  }
  return sources;
}

/**
 * @param {string | undefined} source
 * @returns {string[]}
 */
function listSource(source) {
  return source === undefined ? [] : [source];
}

/**
 * The modules a top-level statement re-exports, empty for a statement that
 * exports nothing or only its own declarations.
 * @param {RuleNode} statement
 * @param {Bindings} bindings
 * @returns {string[]}
 */
function readForwardedSources(statement, bindings) {
  if (statement.type === "ExportAllDeclaration") {
    return listSource(readSource(statement));
  }
  if (statement.type === "ExportNamedDeclaration") {
    const source = readSource(statement);
    return source === undefined
      ? readNamedExportSources(statement, bindings)
      : [source];
  }
  if (statement.type === "ExportDefaultDeclaration") {
    return listSource(readExpressionSource(statement.declaration, bindings));
  }
  if (statement.type === "TSExportAssignment") {
    return listSource(readExpressionSource(statement.expression, bindings));
  }
  return [];
}

/** @type {import("../types").RuleDefinition} */
export const noReExport = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Re-export only from a barrel: an `index.ts` or `index.tsx` may re-export files inside its own folder. Everywhere else, import from the owner. Covers `export ... from`, exported aliases of an imported name or type (`as`, `satisfies`, `!`, `<T>` assertions and chained `const`, `let`, `var` and `type` aliases included), namespace member reads and destructuring, `import("mod")` types without type arguments, `export import`, `export =`, `export default` and an empty interface extending an import.',
    },
    messages: {
      violation:
        "Only a barrel (`index.ts` or `index.tsx`) re-exports, and only files inside its own folder; import the name from the module that owns it instead.",
    },
  },
  create(context) {
    const barrel = isBarrel(context.filename);
    /** @param {string} source */
    function isAllowed(source) {
      const inside = staysInsideFolder(source);
      const allowed = barrel && inside;
      return allowed;
    }

    return {
      Program(node) {
        const body = readStatementList(node.body) ?? [];
        const bindings = collectBindings(body);

        for (const statement of body) {
          const sources = readForwardedSources(statement, bindings);
          const forwardsOutside = sources.some(
            (candidate) => !isAllowed(candidate),
          );
          if (forwardsOutside) {
            context.report({ node: statement, messageId: "violation" });
          }
        }
      },
    };
  },
};
