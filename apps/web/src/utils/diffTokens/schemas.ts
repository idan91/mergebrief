import { z } from "zod/v4";

import { DiffLineKinds } from "types/diff-lines";
import {
  GrammarNames,
  TokenFailureReasons,
  TokenizeModes,
  TokenMessageKinds,
} from "./types";

const fileLineSchema = z.int().nonnegative();

const tokenizableRowSchema = z.object({
  kind: z.enum(DiffLineKinds),
  content: z.string(),
  oldLine: fileLineSchema.optional(),
  newLine: fileLineSchema.optional(),
});

const rowTokenSchema = z.object({
  text: z.string(),
  classId: z.int().nonnegative(),
});

// Tokens cross as `[rowIndex, tokens]` pairs rather than a Map: structured
// clone carries a Map, but a schema can only state the shape of an array.
const rowTokenEntrySchema = z.tuple([
  z.int().nonnegative(),
  z.array(rowTokenSchema),
]);

const requestIdSchema = z.int().nonnegative();

export const tokenizeRequestSchema = z.object({
  kind: z.literal(TokenMessageKinds.TOKENIZE),
  requestId: requestIdSchema,
  sourceId: z.string(),
  grammar: z.enum(GrammarNames),
  mode: z.enum(TokenizeModes),
  rows: z.array(tokenizableRowSchema),
});

export const warmRequestSchema = z.object({
  kind: z.literal(TokenMessageKinds.WARM),
  grammars: z.array(z.enum(GrammarNames)),
});

export const cancelRequestSchema = z.object({
  kind: z.literal(TokenMessageKinds.CANCEL),
  requestId: requestIdSchema,
});

export const workerRequestSchema = z.discriminatedUnion("kind", [
  tokenizeRequestSchema,
  warmRequestSchema,
  cancelRequestSchema,
]);

export const tokensReplySchema = z.object({
  kind: z.literal(TokenMessageKinds.TOKENS),
  requestId: requestIdSchema,
  sourceId: z.string(),
  tokensByRow: z.array(rowTokenEntrySchema),
  tokenizeMs: z.number().nonnegative(),
});

export const failedReplySchema = z.object({
  kind: z.literal(TokenMessageKinds.FAILED),
  requestId: requestIdSchema,
  sourceId: z.string(),
  reason: z.enum(TokenFailureReasons),
});

/** The whole reply, and the contract the suite pins. */
export const workerReplySchema = z.discriminatedUnion("kind", [
  tokensReplySchema,
  failedReplySchema,
]);

// What the main thread actually parses. Validating every token of a ten
// thousand token reply costs more than tokenizing did; the token array rides
// a structural guard instead, and this envelope carries the routing fields.
export const replyEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TokenMessageKinds.TOKENS),
    requestId: requestIdSchema,
    sourceId: z.string(),
    tokenizeMs: z.number().nonnegative(),
  }),
  failedReplySchema,
]);

/** The routing fields a request carries whatever else this build expects. */
export const unreadableRequestSchema = z.object({
  kind: z.literal(TokenMessageKinds.TOKENIZE),
  requestId: z.number().int().nonnegative(),
  sourceId: z.string(),
});
