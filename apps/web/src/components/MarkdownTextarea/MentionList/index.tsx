import { useMergeRefs } from "@floating-ui/react";
import { useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import {
  MentionListLayouts,
  type MentionCandidate,
  type MentionListLayout,
} from "../types";
import { MentionOption } from "./MentionOption";
import styles from "./MentionList.module.scss";

export interface MentionListProps {
  listId: string;
  options: readonly MentionCandidate[];
  activeIndex: number;
  optionId: (index: number) => string;
  onSelect: (candidate: MentionCandidate) => void;
  /** The caller is still answering the query being typed. */
  pending: boolean;
  layout: MentionListLayout;
  /** The floating layout's placement ref and style; absent in flow. */
  positionRef?: ((node: HTMLElement | null) => void) | undefined;
  positionStyle?: CSSProperties | undefined;
}

/**
 * The mention popup: the listbox the textarea controls, and under it the
 * search state. The status row sits outside the listbox so its content
 * model stays options only; the live announcement rides on the editor's
 * always-mounted region, not here.
 */
export function MentionList({
  listId,
  options,
  activeIndex,
  optionId,
  onSelect,
  pending,
  layout,
  positionRef,
  positionStyle,
}: MentionListProps) {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const ref = useMergeRefs([popupRef, positionRef]);
  const layoutVariant =
    layout === MentionListLayouts.IN_FLOW ? undefined : layout;
  const activeOptionId = optionId(activeIndex);

  // A floating list capped to the room left scrolls; the active row stays in it.
  useEffect(() => {
    const popup = popupRef.current;
    const scrolls = popup !== null && popup.scrollHeight > popup.clientHeight;
    if (scrolls) {
      document
        .getElementById(activeOptionId)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOptionId]);

  return (
    <div
      className={styles["mentionPopup"]}
      data-variant={layoutVariant}
      ref={ref}
      style={positionStyle}
    >
      <div
        aria-label={t("shell.ariaLabelMentionSuggestions")}
        id={listId}
        role="listbox"
      >
        {options.map((candidate, index) => (
          <MentionOption
            active={index === activeIndex}
            candidate={candidate}
            id={optionId(index)}
            key={optionId(index)}
            layoutVariant={layoutVariant}
            onSelect={onSelect}
          />
        ))}
      </div>
      {pending ? (
        <div aria-hidden className={styles["searching"]}>
          <span className={styles["spinner"]} />
          <span>{t("shell.mentionSearching")}</span>
        </div>
      ) : null}
    </div>
  );
}
