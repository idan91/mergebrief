import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { categoryLabel } from "../../viewModel";
import type { GroupView } from "../../viewModel";
import styles from "./GroupTocBar.module.scss";

export interface GroupTocBarProps {
  groups: GroupView[];
  activeGroupId: string | null;
  jumpToGroup: (groupId: string) => void;
}

interface CalloutState {
  groupId: string;
  top: number;
  right: number;
}

// Feathered magnification, macOS-dock style: a line's scale falls off with its
// vertical distance from the pointer. ~36px ≈ a couple of neighbours at the
// current line spacing. Returned scale is in [0, 1].
const MAG_SIGMA = 24;

function magnitudeAt(distance: number): number {
  return Math.exp(-((distance / MAG_SIGMA) ** 2));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Right-edge table-of-contents bar for the Story view: one line per
 * Change-group. The active (in-viewport) group stays lit; hovering feathers the
 * nearby lines and surfaces the group's name in a callout. Navigation only —
 * line length is uniform and encodes nothing (see plan: no LoC-as-verdict).
 */
export function GroupTocBar({
  groups,
  activeGroupId,
  jumpToGroup,
}: GroupTocBarProps) {
  const navRef = useRef<HTMLElement>(null);
  const lineRefs = useRef(new Map<string, HTMLButtonElement>());
  const frameRef = useRef<number | null>(null);
  const [callout, setCallout] = useState<CalloutState | null>(null);

  const setMagFromPointer = (pointerY: number | null) => {
    const lines = [...lineRefs.current.values()];
    if (pointerY === null) {
      for (const line of lines) line.style.setProperty("--mag", "0");
      return;
    }
    // Batch all layout reads, then all writes — writing --mag changes
    // inline-size, so interleaving would force a reflow before each read.
    const centers = lines.map((line) => {
      const rect = line.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    lines.forEach((line, index) => {
      const center = centers[index] ?? 0;
      line.style.setProperty(
        "--mag",
        magnitudeAt(Math.abs(center - pointerY)).toFixed(3),
      );
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return;
    const pointerY = event.clientY;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setMagFromPointer(pointerY);
    });
  };

  const handlePointerLeave = () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setMagFromPointer(null);
    setCallout(null);
  };

  const showCallout = (groupId: string, line: HTMLElement) => {
    const rect = line.getBoundingClientRect();
    setCallout({
      groupId,
      top: rect.top + rect.height / 2,
      right: window.innerWidth - rect.left + 12,
    });
  };

  useEffect(() => {
    return () => {
      if (frameRef.current !== null)
        window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const calloutGroup = callout
    ? groups.find((group) => group.id === callout.groupId)
    : undefined;

  return (
    <nav
      ref={navRef}
      aria-label="Change groups"
      className={styles["bar"]}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
    >
      {groups.map((group) => {
        const name = group.group.title || group.group.summary;
        return (
          <button
            key={group.id}
            ref={(node) => {
              if (node) lineRefs.current.set(group.id, node);
              else lineRefs.current.delete(group.id);
            }}
            aria-current={group.id === activeGroupId ? "true" : undefined}
            aria-label={name}
            className={styles["line"]}
            data-active={group.id === activeGroupId ? "true" : undefined}
            title={name}
            type="button"
            onBlur={() => setCallout(null)}
            onClick={() => jumpToGroup(group.id)}
            onFocus={(event) => showCallout(group.id, event.currentTarget)}
            onPointerEnter={(event) =>
              showCallout(group.id, event.currentTarget)
            }
          />
        );
      })}
      {callout && calloutGroup
        ? createPortal(
            <span
              className={styles["callout"]}
              role="tooltip"
              style={{ top: callout.top, right: callout.right }}
            >
              <span className={styles["calloutEyebrow"]}>
                {categoryLabel(calloutGroup.group.dominantCategory)}
              </span>
              <span className={styles["calloutName"]}>
                {calloutGroup.group.title || calloutGroup.group.summary}
              </span>
            </span>,
            document.body,
          )
        : null}
    </nav>
  );
}
