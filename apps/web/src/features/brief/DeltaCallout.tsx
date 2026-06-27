import { type ReactNode } from "react";

import { Callout } from "../../components/Callout";

import styles from "./DeltaCallout.module.scss";

interface DeltaCalloutProps {
  pos: { top: number; left: number };
  eyebrow: string;
  children?: ReactNode;
  unavailable?: boolean;
}

export function DeltaCallout({
  pos,
  eyebrow,
  children,
  unavailable,
}: DeltaCalloutProps) {
  return (
    <Callout pos={pos}>
      <Callout.Eyebrow>{eyebrow}</Callout.Eyebrow>
      {unavailable ? (
        <Callout.Body>
          <span className={styles["unavailable"]}>
            Summary unavailable for this span.
          </span>
        </Callout.Body>
      ) : (
        children
      )}
    </Callout>
  );
}
