// `product-diff <n>`: the brief's Product diff alone. `--json` is one of the
// CLI-synthesized shapes: the brief body's `productDiff` value under its own
// key, the key absent when the brief has none. The value is never validated,
// a shape this CLI does not know still belongs to the consumer. The TTY block
// reads only the fields it prints.
import { formatDisplayText } from "brief-core/hidden-chars";
import { ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import type { BriefSpan, CommandIo } from "../../types";
import { buildSkewError, isRecord } from "../../utils";
import { buildRequestPath } from "../request-path";

const productChangeSchema = z.object({
  when: z.string(),
  before: z.string().optional(),
  after: z.string(),
  affects: z.string(),
  beforeSource: z.string(),
  groupIds: z.array(z.string()),
});

const productDiffSchema = z.object({
  availability: z.string(),
  changes: z.array(productChangeSchema),
  hasMore: z.boolean(),
});

type ProductChangeView = z.infer<typeof productChangeSchema>;

const ABSENT_BEFORE = "-";

/** The `availability` of a section a call read. It tracks brief-core's vocabulary, which this bundle may not import. */
const READ_AVAILABILITY = "available";

/** The brief body's `productDiff` value as stored; undefined when the brief has none. */
function readProductDiffValue(bodyText: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed)) {
    throw buildSkewError("brief");
  }

  return parsed["productDiff"];
}

function formatChange(change: ProductChangeView): string {
  const before =
    change.before === undefined
      ? ABSENT_BEFORE
      : formatDisplayText(change.before);
  const groups = change.groupIds.map(formatDisplayText).join(", ");
  const lines = [
    `${formatDisplayText(change.affects)}\t${formatDisplayText(change.when)}`,
    `  before (${formatDisplayText(change.beforeSource)})\t${before}`,
    `  after\t${formatDisplayText(change.after)}`,
    `  groups\t${groups}`,
  ];

  return `${lines.join("\n")}\n`;
}

/** An empty list means none found only in a section a call read; any other section was never read. */
function formatChangeCount(availability: string, count: number): string {
  if (count === 0) {
    return availability === READ_AVAILABILITY ? "none found" : "nothing listed";
  }
  return count === 1 ? "1 change" : `${count} changes`;
}

/**
 * The terminal block: one head line, then four lines per change. Every
 * server string is escaped, because a PR author's text reaches it. A value
 * this CLI cannot read prints as its escaped JSON.
 */
function formatProductDiff(prNumber: number, value: unknown): string {
  if (value === undefined) {
    return `PR ${prNumber} · this brief has no Product diff\n`;
  }

  const view = productDiffSchema.safeParse(value);
  if (!view.success) {
    return `${formatDisplayText(JSON.stringify(value))}\n`;
  }

  const { availability, changes, hasMore } = view.data;
  const head = [
    `PR ${prNumber}`,
    "Product diff",
    formatDisplayText(availability),
    formatChangeCount(availability, changes.length),
  ];
  if (hasMore) {
    head.push("more not listed");
  }

  return `${head.join(" · ")}\n${changes.map(formatChange).join("")}`;
}

export async function runProductDiff(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  io: CommandIo,
): Promise<void> {
  const brief = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_BRIEF,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
  });
  const productDiff = readProductDiffValue(brief.bodyText);

  if (io.json) {
    // An undefined value leaves the key out, so a brief with none prints `{}`.
    io.stdout(`${JSON.stringify({ productDiff })}\n`);
    return;
  }
  io.stdout(formatProductDiff(prNumber, productDiff));
}
