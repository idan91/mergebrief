import type { ReactNode } from "react";

import type { RowTokenLine } from "@web/utils/diffTokens/types";
import { resolveSyntaxClass } from "./utils";
import rowStyles from "../DiffRows.module.scss";
import styles from "./DiffCodeText.module.scss";
import type { CharRange } from "../types";

export interface DiffCodeTextProps {
  content: string;
  /** Absent means the row renders plain; present, every token gets a span. */
  tokens?: RowTokenLine | undefined;
  /** Character runs that changed against the paired line, in order. */
  emphasis?: readonly CharRange[] | undefined;
}

/** A slice of the row: plain, or one emphasised run holding its token slices. */
interface Segment {
  from: number;
  to: number;
  emphasised: boolean;
}

const NO_EMPHASIS: readonly CharRange[] = [];

export function DiffCodeText({ content, tokens, emphasis }: DiffCodeTextProps) {
  const ranges = emphasis ?? NO_EMPHASIS;
  // The last guard before paint: tokens that do not spell the row render the
  // row's own text rather than a blank line.
  const spelled =
    tokens !== undefined && spellsContent(tokens, content) ? tokens : undefined;
  if (ranges.length === 0) {
    return (
      <TokenSlices
        content={content}
        from={0}
        to={content.length}
        tokens={spelled}
      />
    );
  }

  return sliceSegments(content.length, ranges).map((segment) => {
    const inner = (
      <TokenSlices
        content={content}
        from={segment.from}
        key={segment.from}
        to={segment.to}
        tokens={spelled}
      />
    );
    if (!segment.emphasised) return inner;

    return (
      <mark className={rowStyles["emphasis"]} key={segment.from}>
        {inner}
      </mark>
    );
  });
}

/** Plain and emphasised slices in row order, covering the whole text. */
function sliceSegments(
  length: number,
  ranges: readonly CharRange[],
): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    const from = Math.max(range.from, cursor);
    const to = Math.min(range.to, length);
    if (to <= from) continue;
    if (from > cursor)
      segments.push({ from: cursor, to: from, emphasised: false });
    segments.push({ from, to, emphasised: true });
    cursor = to;
  }
  if (cursor < length)
    segments.push({ from: cursor, to: length, emphasised: false });

  return segments;
}

interface TokenSlicesProps {
  content: string;
  tokens: RowTokenLine | undefined;
  from: number;
  to: number;
}

/** The tokens overlapping `[from, to)`, each clipped to it; plain text without tokens. */
function TokenSlices({
  content,
  tokens,
  from,
  to,
}: TokenSlicesProps): ReactNode {
  if (tokens === undefined) return content.slice(from, to);

  const spans: ReactNode[] = [];
  let offset = 0;
  tokens.forEach((token, index) => {
    const start = offset;
    offset += token.text.length;
    const sliceFrom = Math.max(start, from);
    const sliceTo = Math.min(offset, to);
    if (sliceTo <= sliceFrom) return;
    spans.push(
      <span className={styles[resolveSyntaxClass(token.classId)]} key={index}>
        {token.text.slice(sliceFrom - start, sliceTo - start)}
      </span>,
    );
  });

  return spans;
}

function spellsContent(tokens: RowTokenLine, content: string): boolean {
  if (tokens.length === 0) return false;

  return tokens.map((token) => token.text).join("") === content;
}
