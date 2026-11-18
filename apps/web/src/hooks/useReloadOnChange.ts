import { useRouter, type AnyRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useLatestRef } from "./useLatestRef";

/** Whether the settled screen already answers the change, so no reload is owed. */
type ChangeAnsweredCheck = (router: AnyRouter, value: boolean) => boolean;

function answerNothing(): boolean {
  return false;
}

/**
 * Route `head`s run only with a router load, so this reloads the router once
 * each time `value` changes after mount. A load in flight is let finish
 * first, since its own loader may be what moved `value`.
 */
export function useReloadOnChange(
  value: boolean,
  isAnswered: ChangeAnsweredCheck = answerNothing,
): void {
  const router = useRouter();
  const previous = useRef(value);
  const isAnsweredRef = useLatestRef(isAnswered);

  useEffect(() => {
    if (previous.current === value) {
      return undefined;
    }
    previous.current = value;

    function reload(): void {
      if (isAnsweredRef.current(router, value)) {
        return;
      }
      void router.invalidate();
    }
    if (router.state.status !== "pending") {
      reload();
      return undefined;
    }

    const unsubscribe = router.subscribe("onResolved", () => {
      unsubscribe();
      reload();
    });
    return unsubscribe;
  }, [router, value, isAnsweredRef]);
}
