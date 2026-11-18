import { z } from "zod/v4";

const markSchema = z.object({ type: z.string() });

/** One node, read loosely: a field of the wrong shape reads as absent, and the children stay unread. */
const nodeSchema = z.object({
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).catch({}),
  content: z.array(z.unknown()).optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  marks: z.array(z.unknown()).catch([]),
});
export type AdfNode = z.infer<typeof nodeSchema>;

/** The node `raw` is; undefined for anything that is not an object with a string `type`. */
export function parseNode(raw: unknown): AdfNode | undefined {
  const parsed = nodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function hasMark(node: AdfNode, markType: string): boolean {
  return node.marks.some(
    (mark) => markSchema.safeParse(mark).data?.type === markType,
  );
}
