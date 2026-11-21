import { z } from "zod/v4";

/** An array schema that reads each entry through `ItemSchema` and keeps what parses. */
export type TolerantListSchema<ItemSchema extends z.ZodType> = z.ZodReadonly<
  z.ZodPipe<
    z.ZodArray<z.ZodUnknown>,
    z.ZodTransform<z.output<ItemSchema>[], unknown[]>
  >
>;

/** Each item its schema rejects is dropped, so one bad row never fails the list. */
export function buildTolerantListSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
): TolerantListSchema<ItemSchema> {
  return z
    .array(z.unknown())
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = z.safeParse(itemSchema, entry);
        if (!parsed.success) {
          return [];
        }
        return [parsed.data];
      }),
    )
    .readonly();
}
