import { useLayoutEffect, useRef } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { Button } from "../../Button";
import type { ToastAction } from "../types";

export interface ToastActionButtonProps {
  action: ToastAction;
  disabled: boolean;
  onLeftFocused: (() => void) | undefined;
}

export function ToastActionButton({
  action,
  disabled,
  onLeftFocused,
}: ToastActionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onLeftFocusedRef = useLatestRef(onLeftFocused);

  // A removed node fires no blur. A deleted component's layout cleanup runs
  // while its button is still in the document, so focus is still readable.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      const leavesFocused =
        button !== null && button === document.activeElement;
      if (leavesFocused) {
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- the caller's latest callback, not a node
        onLeftFocusedRef.current?.();
      }
    };
  }, [onLeftFocusedRef]);

  return (
    <Button disabled={disabled} ref={buttonRef} size="sm" onClick={action.run}>
      {action.label}
    </Button>
  );
}
