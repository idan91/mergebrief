/**
 * OpenAI strict mode requires every object's `required` array to list every
 * key in `properties`, so optionality travels as a null-union and null reads
 * back as absent. `withAllRequired` wraps formerly-optional properties in
 * `anyOf: [original, { type: "null" }]`, never a `type: [..., "null"]`
 * widening, which would let null past an enum's closed vocabulary.
 * `stripInjectedNulls` deletes nulls only where the ORIGINAL schema made the
 * key optional. Neither mutates its input.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Does this (original) property schema already admit null? */
function allowsNull(node: Record<string, unknown>): boolean {
  const type = node["type"];
  if (type === "null") {
    return true;
  }
  if (Array.isArray(type) && type.includes("null")) {
    return true;
  }
  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    return anyOf.some((branch) => isRecord(branch) && allowsNull(branch));
  }
  const enumValues = node["enum"];
  if (Array.isArray(enumValues) && enumValues.includes(null)) {
    return true;
  }
  return node["const"] === null;
}

function transformNode(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };

  const defs = node["$defs"];
  if (isRecord(defs)) {
    out["$defs"] = Object.fromEntries(
      Object.entries(defs).map(([name, def]) => [
        name,
        isRecord(def) ? transformNode(def) : def,
      ]),
    );
  }

  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[combinator];
    if (Array.isArray(branches)) {
      out[combinator] = branches.map((branch) =>
        isRecord(branch) ? transformNode(branch) : branch,
      );
    }
  }

  const items = node["items"];
  if (isRecord(items)) {
    out["items"] = transformNode(items);
  }

  const properties = node["properties"];
  if (isRecord(properties)) {
    const required = new Set(
      Array.isArray(node["required"])
        ? node["required"].filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    out["properties"] = Object.fromEntries(
      Object.entries(properties).map(([key, prop]) => {
        if (!isRecord(prop)) {
          return [key, prop];
        }
        const transformed = transformNode(prop);
        if (required.has(key) || allowsNull(prop)) {
          return [key, transformed];
        }
        return [key, { anyOf: [transformed, { type: "null" }] }];
      }),
    );
    out["required"] = Object.keys(properties);
  }

  return out;
}

/**
 * The OpenAI-strict variant of an (already enum-preserving strict) JSON
 * schema: every object lists all properties as required, with formerly
 * optional properties widened to a null-union. Wire-only; pair with
 * `stripInjectedNulls` before domain validation.
 */
export function withAllRequired(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return transformNode(schema);
}

/** Resolve `#/$defs/name` refs against the schema root; null on anything else. */
function resolveRef(
  root: Record<string, unknown>,
  node: Record<string, unknown>,
): Record<string, unknown> | null {
  const ref = node["$ref"];
  if (typeof ref !== "string") {
    return node;
  }
  const name = /^#\/\$defs\/(.+)$/.exec(ref)?.[1];
  if (name === undefined) {
    return null;
  }
  const defs = root["$defs"];
  if (!isRecord(defs)) {
    return null;
  }
  const target = defs[name];
  return isRecord(target) ? target : null;
}

/** Is `key` required by this node or by ANY anyOf/oneOf/allOf branch? */
function requiredSomewhere(
  root: Record<string, unknown>,
  node: Record<string, unknown>,
  key: string,
): boolean {
  const required = node["required"];
  if (Array.isArray(required) && required.includes(key)) {
    return true;
  }
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[combinator];
    if (!Array.isArray(branches)) {
      continue;
    }
    for (const branch of branches) {
      if (!isRecord(branch)) {
        continue;
      }
      const resolved = resolveRef(root, branch);
      if (resolved && requiredSomewhere(root, resolved, key)) {
        return true;
      }
    }
  }
  return false;
}

/** The property schema for `key`, looking through combinator branches. */
function propertySchema(
  root: Record<string, unknown>,
  node: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const properties = node["properties"];
  if (isRecord(properties) && isRecord(properties[key])) {
    return properties[key];
  }
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[combinator];
    if (!Array.isArray(branches)) {
      continue;
    }
    for (const branch of branches) {
      if (!isRecord(branch)) {
        continue;
      }
      const resolved = resolveRef(root, branch);
      if (!resolved) {
        continue;
      }
      const found = propertySchema(root, resolved, key);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function stripNode(
  root: Record<string, unknown>,
  schema: Record<string, unknown>,
  value: unknown,
): unknown {
  const resolved = resolveRef(root, schema);
  if (!resolved) {
    return value;
  }

  if (Array.isArray(value)) {
    const items = resolved["items"];
    if (!isRecord(items)) {
      return value;
    }
    return value.map((element) => stripNode(root, items, element));
  }

  if (!isRecord(value)) {
    return value;
  }

  // Combinator-only nodes (no direct properties) still need recursion into
  // whichever branch describes this object; property lookup below handles
  // both shapes via propertySchema/requiredSomewhere.
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null && !requiredSomewhere(root, resolved, key)) {
      // Null in a formerly-optional slot = the null-union stand-in for
      // "absent". A null the original schema allows only appears under a
      // required (or null-admitting) property and is kept above.
      continue;
    }
    const propSchema = propertySchema(root, resolved, key);
    out[key] = propSchema ? stripNode(root, propSchema, entry) : entry;
  }
  return out;
}

/**
 * Remove null-valued keys that the ORIGINAL (pre-`withAllRequired`) schema
 * marks optional, recursively, so the domain Zod schema sees "absent" where
 * the wire protocol forced "null". Values are copied, never mutated; keys
 * the original schema requires, including genuinely nullable ones, pass
 * through untouched.
 */
export function stripInjectedNulls(
  schema: Record<string, unknown>,
  value: unknown,
): unknown {
  return stripNode(schema, schema, value);
}
