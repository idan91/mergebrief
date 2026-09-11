import { z } from "zod/v4";

export const PrStackMemberSchema = z.object({
  number: z.number().int(),
  title: z.string(),
});

export const LinearPrStackSchema = z
  .object({
    members: z.array(PrStackMemberSchema).min(2),
    index: z.number().int().positive(),
  })
  .refine((stack) => stack.index <= stack.members.length);

export const ForkPrStackSchema = z.object({
  parent: PrStackMemberSchema.optional(),
  children: z.array(PrStackMemberSchema).min(2),
});

export const PrStackSchema = z.union([LinearPrStackSchema, ForkPrStackSchema]);
