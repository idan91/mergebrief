import { Fragment } from "react";

import styles from "./InlineCodeText.module.scss";
import { splitInlineCode } from "./utils";

export interface InlineCodeTextProps {
  /** Plain model or tracker text; only backtick spans gain markup. */
  text: string;
}

/** Text with its backtick spans set as inline code, inside any text element. */
export function InlineCodeText({ text }: InlineCodeTextProps) {
  const segments = splitInlineCode(text);
  return (
    <>
      {segments.map((segment) =>
        segment.code ? (
          <code className={styles["code"]} key={segment.offset}>
            {segment.text}
          </code>
        ) : (
          <Fragment key={segment.offset}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
