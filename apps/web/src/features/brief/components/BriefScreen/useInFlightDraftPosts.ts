// One in-flight post-now request per draft: a disabled button, not a
// protocol. Keyed by draft id and never cleared on a brief switch: a draft id
// carries across revisions, so clearing the gate there would re-enable Post
// under a live request and double-post it. A post still open on a brief left
// behind holds this screen's submit until it settles.
import { useCallback, useMemo, useRef, useState } from "react";

const NO_POSTS: ReadonlySet<string> = new Set();

export interface InFlightDraftPosts {
  /** The comment ids with a post-now request in flight. */
  ids: ReadonlySet<string>;
  /** `false` = this draft already has one in flight; the caller must not send. */
  begin: (commentId: string) => boolean;
  /** Settles a post, success or failure; call it from the request's `finally`. */
  end: (commentId: string) => void;
}

export function useInFlightDraftPosts(): InFlightDraftPosts {
  const [ids, setIds] = useState(NO_POSTS);
  // A ref, not the state: two clicks can land inside one render, and the gate
  // has to refuse the second before React has re-rendered the disabled button.
  const active = useRef(new Set<string>());

  const begin = useCallback((commentId: string) => {
    if (active.current.has(commentId)) {
      return false;
    }
    active.current.add(commentId);
    setIds(new Set(active.current));
    return true;
  }, []);

  const end = useCallback((commentId: string) => {
    if (!active.current.delete(commentId)) {
      return;
    }
    setIds(new Set(active.current));
  }, []);

  // Memoized: this object rides `postDraftComment`'s deps into the review
  // posture, which every expanded DiffTable reads.
  return useMemo(() => ({ begin, end, ids }), [begin, end, ids]);
}
