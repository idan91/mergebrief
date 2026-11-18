import { useEffect, useRef, useState, type RefObject } from "react";

import type { UnresolvedItem } from "../../utils/state";
import type { SubmitView } from "./types";
import { pickEntryView } from "./utils";

/** The state one opening of the Submit modal owns; each open starts it over. */
export interface PerOpenState {
  view: SubmitView;
  setView: (view: SubmitView) => void;
  advisoryItems: UnresolvedItem[];
  ackStale: boolean;
  setAckStale: (acked: boolean) => void;
  submitTried: boolean;
  setSubmitTried: (tried: boolean) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export function usePerOpenState(
  open: boolean,
  unresolvedItems: UnresolvedItem[],
  staleHead: boolean,
): PerOpenState {
  // Lazy initializers also cover mounting open, without an open transition.
  const [view, setView] = useState<SubmitView>(() =>
    open ? pickEntryView(unresolvedItems) : "verdict",
  );
  const [ackStale, setAckStale] = useState(false);
  // Why Submit is off shows once someone tries it, from either view; until
  // then it is only the button's description.
  const [submitTried, setSubmitTried] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [wasStale, setWasStale] = useState(staleHead);
  // Advisory items are CAPTURED at open: a live list would let a mid-flow
  // refetch reshuffle the view under the reviewer.
  const [advisoryItems, setAdvisoryItems] = useState<UnresolvedItem[]>(() =>
    open ? unresolvedItems : [],
  );
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prevViewRef = useRef(view);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const entryView = pickEntryView(unresolvedItems);
      setView(entryView);
      setAdvisoryItems(unresolvedItems);
      setAckStale(false);
      setSubmitTried(false);
      // Reopening after a receipt preview must NOT read as a view switch, or
      // the heading focus below would steal the Modal's own open-focus claim.
      prevViewRef.current = entryView;
    }
  }
  // Returning staleness requires fresh consent even while the modal stays open.
  if (staleHead !== wasStale) {
    setWasStale(staleHead);
    if (staleHead) {
      setAckStale(false);
    }
  }

  // An in-modal view switch unmounts the control that carried focus; move it
  // to the new view's heading so the switch is announced and the Tab cycle
  // restarts from the top. Open itself is the Modal's focus claim, not ours.
  useEffect(() => {
    if (open && prevViewRef.current !== view) {
      headingRef.current?.focus();
    }
    prevViewRef.current = view;
  }, [open, view]);

  return {
    view,
    setView,
    advisoryItems,
    ackStale,
    setAckStale,
    submitTried,
    setSubmitTried,
    headingRef,
  };
}
