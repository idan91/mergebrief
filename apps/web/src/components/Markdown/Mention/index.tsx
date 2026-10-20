import { useEffect, type ReactNode } from "react";

import type { MentionCandidateKind } from "@web/components/MarkdownTextarea/types";
import { useMentionTargets } from "../context";
import { buildMentionHref, readMentionVariant } from "./utils";
import styles from "./Mention.module.scss";

export interface MentionProps {
  /** `login` or `org/slug`, as written after the `@`. */
  target: string;
  kind: MentionCandidateKind;
  children: ReactNode;
}

/**
 * A mention in rendered text: the text that was typed, a link once GitHub
 * shows the viewer its target. Both shapes set the same text, so the swap
 * never moves a line.
 */
export function Mention({ target, kind, children }: MentionProps) {
  const targets = useMentionTargets();
  const requestTarget = targets?.requestTarget;
  useEffect(() => {
    requestTarget?.(target);
  }, [requestTarget, target]);

  const variant = readMentionVariant(target, kind, targets?.viewerLogin);
  const shown = targets?.isTargetShown(target) === true;
  if (!shown) {
    return (
      <span
        className={styles["mention"]}
        data-testid="mention"
        data-variant={variant}
      >
        {children}
      </span>
    );
  }

  const href = buildMentionHref(target, kind);
  return (
    <a
      className={styles["mention"]}
      data-testid="mention"
      data-variant={variant}
      href={href}
    >
      {children}
    </a>
  );
}
