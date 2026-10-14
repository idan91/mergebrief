import { z } from "zod/v4";

import { isRecord } from "./typeGuards";

/** An array or a class instance passes through untouched for the object schema to judge. */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function omitKeys(
  value: unknown,
  keys: readonly string[],
  shouldOmit: (key: string, entry: unknown) => boolean,
): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  const kept: Record<string, unknown> = { ...value };
  for (const key of keys) {
    const omitted = Object.hasOwn(kept, key) && shouldOmit(key, kept[key]);
    if (omitted) {
      delete kept[key];
    }
  }
  return kept;
}

/** A plain object schema, or one the other helper already wraps, so the two nest. */
type ObjectLikeSchema = z.ZodObject | z.ZodPreprocess<z.ZodObject>;

function readObjectSchema(schema: ObjectLikeSchema): z.ZodObject {
  const objectSchema = schema instanceof z.ZodObject ? schema : schema.out;
  return objectSchema;
}

/**
 * The object schema with each listed key's wire `null` read as absent, so the
 * field stays `.exactOptional()`. A `null` on any other key still fails.
 */
export function dropNullKeys<Schema extends ObjectLikeSchema>(
  schema: Schema,
  keys: readonly (keyof z.output<Schema> & string)[],
): z.ZodPreprocess<Schema> {
  return z.preprocess(
    (value) => omitKeys(value, keys, (_key, entry) => entry === null),
    schema,
  );
}

/**
 * The object schema with each listed key dropped when its own field schema
 * rejects the value, so a bad optional field never fails its object. Any
 * other key still fails as usual.
 */
export function dropInvalidKeys<Schema extends ObjectLikeSchema>(
  schema: Schema,
  keys: readonly (keyof z.output<Schema> & string)[],
): z.ZodPreprocess<Schema> {
  const shape: Readonly<Record<string, z.core.$ZodType>> =
    readObjectSchema(schema).shape;
  function isRejected(key: string, entry: unknown): boolean {
    const field = shape[key];
    if (field === undefined) {
      return false;
    }
    return !z.safeParse(field, entry).success;
  }
  return z.preprocess((value) => omitKeys(value, keys, isRejected), schema);
}
