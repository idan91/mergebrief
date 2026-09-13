import type { RowTokenLine } from "@web/utils/diffTokens/types";
import { resolveSyntaxClass } from "./utils";
import styles from "./DiffCodeText.module.scss";

export interface DiffCodeTextProps {
  content: string;
  /** Absent means the row renders plain; present, every token gets a span. */
  tokens?: RowTokenLine | undefined;
}

export function DiffCodeText({ content, tokens }: DiffCodeTextProps) {
  // The last guard before paint: tokens that do not spell the row, or none at
  // all, render the row's own text rather than a blank line.
  if (tokens === undefined || !spellsContent(tokens, content)) return content;

  return tokens.map((token, index) => (
    <span className={styles[resolveSyntaxClass(token.classId)]} key={index}>
      {token.text}
    </span>
  ));
}

function spellsContent(tokens: RowTokenLine, content: string): boolean {
  if (tokens.length === 0) return false;

  return tokens.map((token) => token.text).join("") === content;
}
