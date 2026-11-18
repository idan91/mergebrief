import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

const MS_PER_SECOND = 1000;

function readLongestSeconds(list: string): number {
  const seconds = list.split(",").map((part) => Number.parseFloat(part));
  return Math.max(0, ...seconds.filter(Number.isFinite));
}

function readExitMs(element: Element): number {
  const style = window.getComputedStyle(element);
  const exitSeconds =
    readLongestSeconds(style.transitionDuration) +
    readLongestSeconds(style.transitionDelay);
  return exitSeconds * MS_PER_SECOND;
}

/**
 * The dialog's last open content while its exit runs: a close usually clears
 * the state the content reads, and the leaving box must not repaint with it.
 * The hold lasts as long as the computed exit, so a dialog with none drops it
 * before paint and its closed content renders as it always did.
 */
export function useHeldChildren(
  open: boolean,
  instant: boolean,
  modalRef: RefObject<HTMLElement | null>,
  children: ReactNode,
): ReactNode {
  const lastOpenChildren = useRef(children);
  const [wasOpen, setWasOpen] = useState(open);
  const [holding, setHolding] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setHolding(!open && !instant);
  }

  useEffect(() => {
    if (open) {
      lastOpenChildren.current = children;
    }
  });

  useLayoutEffect(() => {
    if (!holding) {
      return;
    }

    const modal = modalRef.current;
    const surfaces = modal === null ? [] : [modal, ...modal.children];
    const exitMs = Math.max(0, ...surfaces.map(readExitMs));
    if (exitMs === 0) {
      setHolding(false);
      return;
    }

    const release = window.setTimeout(() => setHolding(false), exitMs);
    return () => window.clearTimeout(release);
  }, [holding, modalRef]);

  return holding ? lastOpenChildren.current : children;
}
