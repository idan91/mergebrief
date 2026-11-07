import { useTranslation } from "react-i18next";
import type { Ref } from "react";

import { Button } from "@web/components/Button";
import type { OwnDraftHeaderProps } from "../types";

export interface MarkReadyCtaProps {
  ownDraft: OwnDraftHeaderProps;
  /** The caller's placement for the button. */
  className?: string | undefined;
  slotRef?: Ref<HTMLButtonElement> | undefined;
  onBlur?: (() => void) | undefined;
  onFocus?: (() => void) | undefined;
}

/**
 * The own-draft terminal action. Caller-owned aria-disabled, not the
 * `disabled` prop: the click stays live so an unavailable or pending press
 * announces its reason, and the mark-ready flow's in-flight guard no-ops
 * repeats.
 */
export function MarkReadyCta({
  ownDraft,
  className,
  slotRef,
  onBlur,
  onFocus,
}: MarkReadyCtaProps) {
  const { t } = useTranslation();
  const label = ownDraft.pending
    ? t("brief.header.markingReady")
    : t("brief.header.markReady");
  const markReadyBlocked = ownDraft.pending || ownDraft.unavailable === true;

  return (
    <Button
      aria-busy={ownDraft.pending || undefined}
      aria-disabled={markReadyBlocked}
      className={className}
      data-terminal-slot=""
      ref={slotRef}
      variant="accent"
      onBlur={onBlur}
      onClick={ownDraft.markReady}
      onFocus={onFocus}
    >
      {label}
    </Button>
  );
}
