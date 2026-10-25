import { DiffSides } from "types";

import type { LineCommentAnchor } from "../../utils/comments";

/** The diff side a line comment starts on, as the collapsed row's `+` or `-`. */
export function readSideSign(anchor: LineCommentAnchor): "+" | "-" {
  const side = anchor.startSide ?? anchor.side;
  if (side === DiffSides.NEW) {
    return "+";
  }
  return "-";
}
