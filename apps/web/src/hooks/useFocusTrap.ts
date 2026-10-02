import type { KeyboardEvent, RefObject } from "react";

// `aria-disabled` controls stay focusable so they keep announcing why they are off.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Tab half of a modal surface: focus cycles among the container's own
 * controls while it is open. Attach the returned handler to the container's
 * keydown; the container itself may hold focus (tabIndex -1) as the cycle's
 * start.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.key !== "Tab") return;

    const matches =
      containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
    // A roving group's off-stop members match the selector but are skipped by Tab.
    const nodes = [...matches].filter((node) => node.tabIndex >= 0);
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (
      event.shiftKey &&
      (active === first || active === containerRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };
}
