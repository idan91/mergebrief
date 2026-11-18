import { z } from "zod/v4";

/**
 * Enum-preserving structured-output format. The SDK's `zodOutputFormat` drops
 * `enum`/`const`, demoting closed vocabularies to description text; the platform
 * supports them and constrains decoding server-side, so this rebuilds the
 * transform carrying them through. `parse` must mirror the SDK's message shape.
 */

/** Structural stand-in for the SDK's AutoParseableOutputFormat (not publicly exported). */
export interface ParseableOutputFormat<Parsed> {
  type: "json_schema";
  schema: Record<string, unknown>;
  parse(content: string): Parsed;
}

/** String formats the platform supports (identical to the SDK's whitelist). */
const SUPPORTED_STRING_FORMATS = new Set<string>([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a key and delete it from the source (mirrors the SDK's `pop`). */
function pop(source: Record<string, unknown>, key: string): unknown {
  const value = source[key];
  delete source[key];
  return value;
}

/**
 * Rebuild one schema node into its strict form. Mirrors the SDK's
 * `_transformJSONSchema` keyword-by-keyword, plus `enum`/`const` carry-over.
 * `working` is mutated (keys are popped as they are consumed); any leftover keys
 * are demoted into `description`, matching the SDK.
 */
/** Every record-valued property transformed; non-record entries drop. */
function transformProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const strictProps: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (isRecord(propSchema)) {
      strictProps[key] = transformNode(propSchema);
    }
  }
  return strictProps;
}

function transformNode(
  working: Record<string, unknown>,
): Record<string, unknown> {
  const strict: Record<string, unknown> = {};

  const ref = pop(working, "$ref");
  if (ref !== undefined) {
    strict["$ref"] = ref;
    return strict;
  }

  const defs = pop(working, "$defs");
  if (isRecord(defs)) {
    const strictDefs: Record<string, unknown> = {};
    strict["$defs"] = strictDefs;
    for (const [name, defSchema] of Object.entries(defs)) {
      if (isRecord(defSchema)) {
        strictDefs[name] = transformNode(defSchema);
      }
    }
  }

  const type = pop(working, "type");
  const anyOf = pop(working, "anyOf");
  const oneOf = pop(working, "oneOf");
  const allOf = pop(working, "allOf");
  if (Array.isArray(anyOf)) {
    strict["anyOf"] = anyOf.filter(isRecord).map(transformNode);
  } else if (Array.isArray(oneOf)) {
    strict["anyOf"] = oneOf.filter(isRecord).map(transformNode);
  } else if (Array.isArray(allOf)) {
    strict["allOf"] = allOf.filter(isRecord).map(transformNode);
  } else {
    if (type === undefined) {
      throw new Error(
        "JSON schema must have a type defined if anyOf/oneOf/allOf are not used",
      );
    }
    strict["type"] = type;
  }

  const description = pop(working, "description");
  if (description !== undefined) {
    strict["description"] = description;
  }
  const title = pop(working, "title");
  if (title !== undefined) {
    strict["title"] = title;
  }

  // The whole point of this module: closed vocabularies survive as real
  // keywords, so the server constrains decoding instead of hoping the text is
  // read. Both `enum` (finite set) and `const` (singleton) are carried.
  const enumValues = pop(working, "enum");
  if (enumValues !== undefined) {
    strict["enum"] = enumValues;
  }
  const constValue = pop(working, "const");
  if (constValue !== undefined) {
    strict["const"] = constValue;
  }

  if (type === "object") {
    const properties = pop(working, "properties");
    strict["properties"] = isRecord(properties)
      ? transformProperties(properties)
      : {};
    pop(working, "additionalProperties");
    strict["additionalProperties"] = false;
    const required = pop(working, "required");
    if (required !== undefined) {
      strict["required"] = required;
    }
  } else if (type === "string") {
    const format = pop(working, "format");
    if (typeof format === "string" && SUPPORTED_STRING_FORMATS.has(format)) {
      strict["format"] = format;
    } else if (format !== undefined) {
      // Unsupported format: leave it in `working` so it is demoted below.
      working["format"] = format;
    }
  } else if (type === "array") {
    const items = pop(working, "items");
    if (isRecord(items)) {
      strict["items"] = transformNode(items);
    }
    const minItems = pop(working, "minItems");
    if (minItems === 0 || minItems === 1) {
      strict["minItems"] = minItems;
    } else if (minItems !== undefined) {
      working["minItems"] = minItems;
    }
  }

  // Any leftover (unsupported) keyword is demoted to text, verbatim from the
  // SDK, so the model still sees it as guidance even though it is not enforced.
  const leftovers = Object.entries(working);
  if (leftovers.length > 0) {
    const existing = strict["description"];
    const prefix =
      typeof existing === "string" && existing ? existing + "\n\n" : "";
    strict["description"] =
      prefix +
      "{" +
      leftovers
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(", ") +
      "}";
  }

  return strict;
}

const DEFS_PREFIX = "#/$defs/";
const GENERATED_DEF_ID = /^__schema\d+$/;

function countDefRefs(node: unknown, counts: Map<string, number>): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      countDefRefs(entry, counts);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const ref = node["$ref"];
  if (typeof ref === "string") {
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  for (const value of Object.values(node)) {
    countDefRefs(value, counts);
  }
}

interface DefTable {
  readonly defs: Record<string, unknown>;
  readonly counts: ReadonlyMap<string, number>;
  readonly renames: ReadonlyMap<string, string>;
}

function inlineRefs(node: unknown, table: DefTable): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => inlineRefs(entry, table));
  }
  if (!isRecord(node)) {
    return node;
  }

  const { $ref: ref, ...siblings } = node;
  const isSingleUseRef = typeof ref === "string" && table.counts.get(ref) === 1;
  if (isSingleUseRef) {
    const target = table.defs[ref.slice(DEFS_PREFIX.length)];
    if (isRecord(target)) {
      return inlineRefs({ ...target, ...siblings }, table);
    }
  }

  const inlined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    inlined[key] = inlineRefs(value, table);
  }
  if (typeof ref === "string") {
    inlined["$ref"] = table.renames.get(ref) ?? ref;
  }
  return inlined;
}

/** zod's generated ids renumbered over the kept defs; an explicit id stays. */
function renameKeptDefs(keptNames: readonly string[]): Map<string, string> {
  const renames = new Map<string, string>();
  keptNames.forEach((name, index) => {
    const renamed = GENERATED_DEF_ID.test(name) ? `__schema${index}` : name;
    renames.set(DEFS_PREFIX + name, DEFS_PREFIX + renamed);
  });
  return renames;
}

/**
 * Only a subschema referenced more than once stays in `$defs`. The strict
 * transform drops a `$ref` node's siblings, so a single-use ref would lose
 * the `description` zod writes beside it.
 */
function inlineSingleUseDefs(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const { $defs: defs, ...root } = schema;
  if (!isRecord(defs)) {
    return schema;
  }

  const counts = new Map<string, number>();
  countDefRefs(schema, counts);
  const keptNames = Object.keys(defs).filter(
    (name) => (counts.get(DEFS_PREFIX + name) ?? 0) > 1,
  );
  const renames = renameKeptDefs(keptNames);
  const table: DefTable = { defs, counts, renames };

  const inlinedRoot = inlineRefs(root, table);
  if (!isRecord(inlinedRoot)) {
    return schema;
  }
  if (keptNames.length === 0) {
    return inlinedRoot;
  }
  const keptDefs: Record<string, unknown> = {};
  for (const name of keptNames) {
    const renamed = renames.get(DEFS_PREFIX + name) ?? DEFS_PREFIX + name;
    keptDefs[renamed.slice(DEFS_PREFIX.length)] = inlineRefs(defs[name], table);
  }
  return { ...inlinedRoot, $defs: keptDefs };
}

/**
 * Rebuild a JSON schema into the platform's strict form, preserving
 * `enum`/`const`. Deep-clones the input; the original is never mutated.
 */
export function toStrictJsonSchema(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const clone: unknown = JSON.parse(JSON.stringify(input));
  if (!isRecord(clone)) {
    throw new Error("toStrictJsonSchema: input schema must be an object");
  }
  return transformNode(clone);
}

/** First few Zod issues, formatted exactly as the SDK's `zodOutputFormat` does. */
function formatIssues(error: z.ZodError): string {
  const formatted = error.issues
    .slice(0, 5)
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  const count = error.issues.length;
  const suffix = count > 5 ? `\n  ... and ${count - 5} more issue(s)` : "";
  return `Validation issues:\n${formatted}${suffix}`;
}

/**
 * Parse a raw model output against a Zod schema with the SDK's exact failure
 * message shapes ("Failed to parse structured output[ as JSON]: …"). Shared
 * by the output format's `parse` and by the schema-floor pipeline, so the
 * retry feedback a model sees is identical whichever path validated it.
 */
export function parseStructuredText<S extends z.ZodType>(
  zodSchema: S,
  content: string,
): z.infer<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse structured output as JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const output = zodSchema.safeParse(parsed);
  if (!output.success) {
    throw validationError(output.error);
  }
  return output.data;
}

/**
 * The SDK-shaped validation failure for a Zod error, one message shape
 * whether the payload arrived as text or as a transport-parsed candidate.
 */
export function validationError(error: z.ZodError): Error {
  return new Error(
    `Failed to parse structured output: ${error.message}\n${formatIssues(error)}`,
  );
}

/**
 * The enum-preserving strict JSON schema, the wire payload for Anthropic's
 * `output_config.format.schema`, claude's `--json-schema` and codex's
 * `--output-schema` alike. Bare schema, no parse callback: the SDK parses eagerly
 * at message_stop, so a `parse` member would bypass the schema-floor pipeline.
 */
export function enumPreservingJsonSchema(
  zodSchema: z.ZodType,
): Record<string, unknown> {
  const jsonSchema: unknown = z.toJSONSchema(zodSchema, { reused: "ref" });
  if (!isRecord(jsonSchema)) {
    throw new Error(
      "enumPreservingJsonSchema: z.toJSONSchema did not return an object",
    );
  }
  return toStrictJsonSchema(inlineSingleUseDefs(jsonSchema));
}

/**
 * Build an enum-preserving output format from a Zod schema, a drop-in for the
 * SDK's `zodOutputFormat`, where `parse` yields typed data or throws with the
 * SDK's exact message shape. Do not hand this to `messages.stream()`, where the
 * `parse` member triggers the SDK's eager client-side parse.
 */
export function enumPreservingOutputFormat<S extends z.ZodType>(
  zodSchema: S,
): ParseableOutputFormat<z.infer<S>> {
  return {
    type: "json_schema",
    schema: enumPreservingJsonSchema(zodSchema),
    parse: (content: string): z.infer<S> =>
      parseStructuredText(zodSchema, content),
  };
}
