import type { OpenChangeReason } from "@floating-ui/react";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";

import { Button } from "@web/components/Button";
import { Callout } from "@web/components/Callout";
import { CALLOUT_ROOT_SELECTOR } from "@web/components/Callout/consts";
import { isInsideCallout } from "@web/components/Callout/utils";
import { LocSign, LocSigns } from "@web/components/LocSign";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import { resolveGroupName } from "../../../../model/utils/resolve-group-name";
import type { UnattributedRemainderGroupView } from "../../../../model/utils/view-model";
import styles from "./UnattributedDisclosure.module.scss";

export interface UnattributedDisclosureProps {
  /** The hydrated remainder group (the cell only mounts when this exists). */
  group: UnattributedRemainderGroupView;
  jumpToGroup: (groupId: string) => void;
  jumpToGroupHeading: (groupId: string) => void;
  /** Styles the trigger button; the header owns the stat cell look. */
  triggerClassName?: string | undefined;
}

/**
 * The header's "unattributed" stat + Jump callout, in the
 * CoreLinesDisclosure grammar: hover previews (mouse only), click is
 * canonical for touch, keyboard focus opens, the Callout's Escape dismisses,
 * scroll closes.
 */
export function UnattributedDisclosure({
  group,
  jumpToGroup,
  jumpToGroupHeading,
  triggerClassName,
}: UnattributedDisclosureProps) {
  const { t } = useTranslation();

  const [anchor, setAnchor] = useState<Element | null>(null);

  // Hover-open must anchor the BUTTON: in the header stats grid the wrapper
  // span is display:contents (no box), so its rect would place the callout
  // at the viewport origin.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const ignoreFocusOpenRef = useRef(false);
  const detailId = useId();

  // Close on scroll: the portal'd panel repositions a frame late (stutter).
  useEffect(() => {
    if (anchor === null) {
      return;
    }
    const close = (event: Event) => {
      if (!isInsideCallout(event.target)) {
        setAnchor(null);
      }
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [anchor]);

  const closeUnlessInside = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && isInsideDisclosure(next)) {
      return;
    }
    setAnchor(null);
  };

  const isInsideDisclosure = (node: Node) => {
    if (triggerRef.current?.contains(node)) {
      return true;
    }
    if (panelRef.current?.closest(CALLOUT_ROOT_SELECTOR)?.contains(node)) {
      return true;
    }
    return (
      node instanceof Element &&
      node.hasAttribute("data-floating-ui-focus-guard")
    );
  };

  const closeFromCallout = (reason?: OpenChangeReason) => {
    const active = document.activeElement;
    const callout = panelRef.current?.closest(CALLOUT_ROOT_SELECTOR);
    const heldInPanel =
      active instanceof Node && (callout?.contains(active) ?? false);
    setAnchor(null);
    if (reason !== "escape-key" || !heldInPanel) {
      return;
    }
    ignoreFocusOpenRef.current = true;
    triggerRef.current?.focus();
  };

  const jumpFromCallout = (event: MouseEvent<HTMLButtonElement>) => {
    setAnchor(null);
    if (event.detail !== 0) {
      jumpToGroup(GroupViewKinds.UNATTRIBUTED_REMAINDER);
      return;
    }
    jumpToGroupHeading(GroupViewKinds.UNATTRIBUTED_REMAINDER);
  };

  return (
    // Hover EXIT is owned by Callout's safePolygon (its onClose): closing on
    // this span's mouseleave would kill the portal'd callout before the
    // pointer can travel into it.
    <span
      onPointerEnter={(event) => {
        // Touch browsers synthesize mouseenter before click: hover preview
        // is a MOUSE affordance; touch/pen go through click.
        if (event.pointerType === "mouse") {
          setAnchor(triggerRef.current);
        }
      }}
    >
      {/* oxlint-disable-next-line house/no-raw-button -- headless zero-specificity trigger wrapper: the stat cell carries the visuals */}
      <button
        ref={triggerRef}
        aria-controls={anchor ? detailId : undefined}
        aria-expanded={anchor !== null}
        className={
          triggerClassName
            ? `${styles["trigger"]} ${triggerClassName}`
            : styles["trigger"]
        }
        data-state={anchor !== null ? "open" : "closed"}
        data-testid="unattributed-disclosure"
        type="button"
        onClick={(event) =>
          setAnchor(anchor === null ? event.currentTarget : null)
        }
        // Keyboard-only open: a mouse click focuses the button in some
        // browsers, and a plain focus-open would fight the click toggle.
        onFocus={(event) => {
          if (ignoreFocusOpenRef.current) {
            ignoreFocusOpenRef.current = false;
            return;
          }
          if (event.currentTarget.matches(":focus-visible")) {
            setAnchor(event.currentTarget);
          }
        }}
        onBlur={closeUnlessInside}
      >
        <span className={styles["labelCell"]}>
          {t("brief.unattributed.label")}
          <span aria-hidden="true" className={styles["warnDot"]} />
        </span>

        <b>
          <LocSign sign={LocSigns.ADD} count={group.added} />{" "}
          <span className="faint">/</span>{" "}
          <LocSign sign={LocSigns.DEL} count={group.deleted} />
        </b>
      </button>
      {anchor ? (
        // Downwards: upwards lands under the sticky toolbar's controls.
        <Callout
          anchor={anchor}
          fit
          interactive
          placement="bottom"
          onClose={closeFromCallout}
        >
          <span
            className={styles["panel"]}
            id={detailId}
            onBlur={closeUnlessInside}
            ref={panelRef}
          >
            <span className={styles["title"]}>
              {resolveGroupName(t, group)}
            </span>
            <span className={styles["note"]}>
              {t("brief.unattributed.remainderSummary")}
            </span>
            <span className={styles["note"]}>
              {t("brief.unattributed.calloutNote")}
            </span>
            <Button
              className={styles["jump"]}
              size="sm"
              type="button"
              onClick={jumpFromCallout}
            >
              {t("brief.unattributed.jumpToGroup")}
            </Button>
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
