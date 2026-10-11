import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { PrStack } from "../../../../model/types";
import { StackChipOpeners, type StackChipOpener } from "./types";
import { isLinearPrStack } from "./utils";

export interface StackChipFacadeParams {
  stack: PrStack;
}

export function useStackChipFacade({ stack }: StackChipFacadeParams) {
  const { t } = useTranslation();
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const openerRef = useRef<StackChipOpener | null>(null);
  const landedRef = useRef(false);
  const panelRef = useRef<HTMLSpanElement | null>(null);

  const linear = isLinearPrStack(stack);
  const visibleLabel = linear
    ? `${String(stack.index)}/${String(stack.members.length)}`
    : t("brief.header.stacked");
  const chipLabel = linear
    ? t("brief.header.stackIndexAria", {
        index: stack.index,
        total: stack.members.length,
      })
    : visibleLabel;
  const controlsId = open ? detailId : undefined;
  const panelAriaLabel = linear
    ? undefined
    : t("brief.header.stackDisclosureAria");

  const close = useCallback(() => {
    const panelEl = document.getElementById(detailId);
    const focusWasInside = panelEl?.contains(document.activeElement) ?? false;
    setOpen(false);
    landedRef.current = false;
    openerRef.current = null;
    if (focusWasInside) {
      triggerEl?.focus();
    }
  }, [detailId, triggerEl]);

  const openPreview = () => {
    openerRef.current = StackChipOpeners.HOVER;
    setOpen(true);
  };

  const openCanonical = () => {
    openerRef.current = StackChipOpeners.CLICK;
    setOpen(true);
    const node = panelRef.current;
    if (node) {
      landedRef.current = true;
      node.focus();
    } else {
      landedRef.current = false;
    }
  };

  const handleTriggerClick = () => {
    if (open && openerRef.current === StackChipOpeners.CLICK) {
      close();
      return;
    }
    openCanonical();
  };

  const handlePointerEnter = (pointerType: string) => {
    if (pointerType === "mouse" && !open) {
      openPreview();
    }
  };

  const landOnPanel = (node: HTMLSpanElement | null) => {
    panelRef.current = node;
    if (
      node &&
      openerRef.current === StackChipOpeners.CLICK &&
      !landedRef.current
    ) {
      landedRef.current = true;
      node.focus();
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  return {
    chipLabel,
    close,
    controlsId,
    detailId,
    handlePointerEnter,
    handleTriggerClick,
    landOnPanel,
    open,
    panelAriaLabel,
    setTriggerEl,
    triggerEl,
    visibleLabel,
  };
}
