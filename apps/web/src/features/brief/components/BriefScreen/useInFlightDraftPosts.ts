// One in-flight post-now request per draft — a disabled button, not a
// protocol. The screen owns the set: the server holds the drafts, so a
// remount reads the truth back rather than needing the window to outlive it.
//
// Keyed by DRAFT id and never cleared on a brief switch. A draft id is the
// server's and carries across spans, so a post opened on one revision is
// still that same draft's post on the next — clearing the gate there would
// re-enable the button under a live request and double-post it. The cost is
// the mirror image: a post still open on a brief left behind holds this
// screen's submit until it settles, which it always does.
import { useCallback, useMemo, useRef, useState } from "react";

const NO_POSTS: ReadonlySet<string> = new Set();

export interface InFlightDraftPosts {
  /** The comment ids with a post-now request in flight. */
  ids: ReadonlySet<string>;
  /** `false` = this draft already has one in flight; the caller must not send. */
  begin: (commentId: string) => boolean;
  /** Settle (success or failure) — always from the request's `finally`. */
  end: (commentId: string) => void;
}

export function useInFlightDraftPosts(): InFlightDraftPosts {
  const [ids, setIds] = useState(NO_POSTS);
  // A ref, not the state: two clicks can land inside one render, and the gate
  // has to refuse the second before React has re-rendered the disabled button.
  const active = useRef(new Set<string>());

  const begin = useCallback((commentId: string) => {
    if (active.current.has(commentId)) return false;
    active.current.add(commentId);
    setIds(new Set(active.current));
    return true;
  }, []);

  const end = useCallback((commentId: string) => {
    if (!active.current.delete(commentId)) return;
    setIds(new Set(active.current));
  }, []);

  // Memoized: this object rides `postDraftComment`'s dep array all the way
  // into the flow store's posture, and a fresh identity per render would
  // re-render every expanded DiffTable on unrelated screen state.
  return useMemo(() => ({ begin, end, ids }), [begin, end, ids]);
}
