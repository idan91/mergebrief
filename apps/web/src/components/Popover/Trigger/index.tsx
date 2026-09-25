import { useMergeRefs } from "@floating-ui/react";
import {
  cloneElement,
  type HTMLAttributes,
  type ReactElement,
  type RefAttributes,
} from "react";

import { usePopoverContext } from "../context";

export type PopoverTriggerChildProps = HTMLAttributes<HTMLElement> &
  RefAttributes<HTMLElement>;

export interface PopoverTriggerProps {
  /** One element that forwards `ref` and its rest props to a DOM node: `IconButton`, `Button`, a raw button. */
  children: ReactElement<PopoverTriggerChildProps>;
}

/** Hands its one child the reference ref, the click and dismiss handlers, and the expanded state. */
export function PopoverTrigger({ children }: PopoverTriggerProps) {
  const popover = usePopoverContext();
  const ref = useMergeRefs([popover.setReference, children.props.ref]);
  const controls = popover.open ? popover.panelId : undefined;
  const props = popover.getReferenceProps({
    ...children.props,
    ref,
    "aria-expanded": popover.open,
    "aria-controls": controls,
  });

  return cloneElement(children, props);
}
