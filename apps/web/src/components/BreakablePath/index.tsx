import { Fragment } from "react";

import { splitPathSegments } from "./utils";

export interface BreakablePathProps {
  path: string;
}

/**
 * A file path that wraps after a slash. Pair it with `overflow-wrap: anywhere`,
 * which then only cuts a segment too long for the line on its own.
 */
export function BreakablePath({ path }: BreakablePathProps) {
  return splitPathSegments(path).map((segment) => (
    <Fragment key={segment.key}>
      {segment.text}
      <wbr />
    </Fragment>
  ));
}
