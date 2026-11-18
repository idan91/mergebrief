import { z } from "zod/v4";
import { UnknownValues, type UnknownValue } from "./types";

type Vocabulary = Readonly<Record<string, string>>;

export type OpenEnumSchema<Members extends Vocabulary> = z.ZodPreprocess<
  z.ZodUnion<readonly [z.ZodEnum<Members>, z.ZodLiteral<UnknownValue>]>
>;

function readVocabularyMember(
  members: ReadonlySet<string>,
  value: unknown,
): unknown {
  const readsAsItself = typeof value !== "string" || members.has(value);
  if (readsAsItself) {
    return value;
  }
  return UnknownValues.UNKNOWN;
}

/**
 * An open enum over a closed vocabulary: a member reads as itself and any other
 * string reads as `unknown`. A non-string or absent value still fails, so a
 * wrong type stays a malformed read and a required field stays required. For an
 * optional field use `dropInvalidKeys`, unless its absence carries a default
 * meaning: dropping would let that default stand in for the unknown value.
 */
export function buildOpenEnumSchema<const Members extends Vocabulary>(
  vocabulary: Members,
): OpenEnumSchema<Members> {
  const members: ReadonlySet<string> = new Set(Object.values(vocabulary));
  const memberOrUnknown = z.union([
    z.enum(vocabulary),
    z.literal(UnknownValues.UNKNOWN),
  ]);
  return z.preprocess(
    (value) => readVocabularyMember(members, value),
    memberOrUnknown,
  );
}
