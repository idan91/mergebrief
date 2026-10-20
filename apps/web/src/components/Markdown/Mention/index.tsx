import type { ReactNode } from "react";

import type { MentionCandidateKind } from "@web/components/MarkdownTextarea/types";

export interface MentionProps {
  /** `login` or `org/slug`, as written after the `@`. */
  target: string;
  kind: MentionCandidateKind;
  children: ReactNode;
}

/** A mention in rendered text; it reads as the text that was typed. */
export function Mention({ children }: MentionProps) {
  return <span data-testid="mention">{children}</span>;
}
