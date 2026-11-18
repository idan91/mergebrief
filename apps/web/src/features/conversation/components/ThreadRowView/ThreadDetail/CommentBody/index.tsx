import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button, ButtonSizes, ButtonVariants } from "@web/components/Button";
import { COMMENT_CLAMP_PX } from "./consts";
import { CommentBodyStates } from "./types";
import { deriveCommentBodyState } from "./utils";
import styles from "./CommentBody.module.scss";

export interface CommentBodyProps {
  children: ReactNode;
}

/** A comment's rendered body, clamped behind Show full comment when tall. */
export function CommentBody({ children }: CommentBodyProps) {
  const { t } = useTranslation();
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Images and late-highlighted code change the height after mount.
  useEffect(() => {
    const element = bodyRef.current;
    if (element === null) {
      return;
    }
    const measure = () => {
      setOverflowing(element.scrollHeight > COMMENT_CLAMP_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const state = deriveCommentBodyState(overflowing, expanded);
  const toggleLabel = expanded
    ? t("conversation.showLess")
    : t("conversation.showFullComment");
  // A link clipped below the clamp would take focus out of sight.
  const expandOnFocus = () => {
    if (state === CommentBodyStates.CLAMPED) {
      setExpanded(true);
    }
  };

  return (
    <>
      <div
        className={styles["body"]}
        data-state={state}
        data-testid="comment-body"
        id={bodyId}
        ref={bodyRef}
        onFocus={expandOnFocus}
      >
        {children}
      </div>
      {state === CommentBodyStates.WHOLE ? null : (
        <Button
          aria-controls={bodyId}
          aria-expanded={expanded}
          className={styles["toggle"]}
          size={ButtonSizes.SM}
          variant={ButtonVariants.QUIET}
          onClick={() => setExpanded((current) => !current)}
        >
          {toggleLabel}
        </Button>
      )}
    </>
  );
}
