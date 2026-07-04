import { z } from "zod/v4";

/**
 * Enum-preserving structured-output format.
 *
 * The SDK's `zodOutputFormat` runs the JSON schema through a keyword whitelist
 * (`transformJSONSchema`) that **drops `enum`/`const`**, demoting closed
 * vocabularies to description prose the model may ignore. The Anthropic platform
 * *does* support `enum`/`const` in structured-output schemas, so decoding can be
 * constrained server-side — invalid tokens then cannot be generated at all.
 *
 * This module rebuilds the SDK transform verbatim (same keyword whitelist, same
 * `additionalProperties: false` forcing, same leftover-key demotion into
 * `description`) with one difference: `enum` and `const` are carried through.
 * The result is the same `{ type, schema, parse }` shape the SDK produces, so it
 * drops straight into `generator.ts`'s existing flow. `parse` mirrors the SDK's
 * message shape exactly — the generator's retry feedback echoes it to the model
 * and the salvage path re-parses independently, so both must stay identical.
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
function transformNode(working: Record<string, unknown>): Record<string, unknown> {
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
      if (isRecord(defSchema)) strictDefs[name] = transformNode(defSchema);
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
  if (description !== undefined) strict["description"] = description;
  const title = pop(working, "title");
  if (title !== undefined) strict["title"] = title;

  // The whole point of this module: closed vocabularies survive as real
  // keywords, so the server constrains decoding instead of hoping the prose is
  // read. Both `enum` (finite set) and `const` (singleton) are carried.
  const enumValues = pop(working, "enum");
  if (enumValues !== undefined) strict["enum"] = enumValues;
  const constValue = pop(working, "const");
  if (constValue !== undefined) strict["const"] = constValue;

  if (type === "object") {
    const properties = pop(working, "properties");
    const strictProps: Record<string, unknown> = {};
    if (isRecord(properties)) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (isRecord(propSchema)) strictProps[key] = transformNode(propSchema);
      }
    }
    strict["properties"] = strictProps;
    pop(working, "additionalProperties");
    strict["additionalProperties"] = false;
    const required = pop(working, "required");
    if (required !== undefined) strict["required"] = required;
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
    if (isRecord(items)) strict["items"] = transformNode(items);
    const minItems = pop(working, "minItems");
    if (minItems === 0 || minItems === 1) {
      strict["minItems"] = minItems;
    } else if (minItems !== undefined) {
      working["minItems"] = minItems;
    }
  }

  // Any leftover (unsupported) keyword is demoted to prose, verbatim from the
  // SDK, so the model still sees it as guidance even though it is not enforced.
  const leftovers = Object.entries(working);
  if (leftovers.length > 0) {
    const existing = strict["description"];
    const prefix = typeof existing === "string" && existing ? existing + "\n\n" : "";
    strict["description"] =
      prefix +
      "{" +
      leftovers.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ") +
      "}";
  }

  return strict;
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
 * Build an enum-preserving output format from a Zod schema. Same call shape as
 * the SDK's `zodOutputFormat`, and the returned object is a drop-in replacement:
 * `{ type: "json_schema", schema, parse }`, where `parse` yields typed data or
 * throws with the SDK's exact message shape on invalid output.
 */
export function enumPreservingOutputFormat<S extends z.ZodType>(
  zodSchema: S,
): ParseableOutputFormat<z.infer<S>> {
  const jsonSchema: unknown = z.toJSONSchema(zodSchema, { reused: "ref" });
  if (!isRecord(jsonSchema)) {
    throw new Error("enumPreservingOutputFormat: z.toJSONSchema did not return an object");
  }
  const schema = toStrictJsonSchema(jsonSchema);
  return {
    type: "json_schema",
    schema,
    parse(content: string): z.infer<S> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        throw new Error(
          `Failed to parse structured output as JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const output = zodSchema.safeParse(parsed);
      if (!output.success) {
        throw new Error(
          `Failed to parse structured output: ${output.error.message}\n${formatIssues(output.error)}`,
        );
      }
      return output.data;
    },
  };
}
