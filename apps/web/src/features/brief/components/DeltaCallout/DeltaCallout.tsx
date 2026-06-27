import { Callout } from "../../../../components/Callout";
import { bindCallout } from "../../revisionChanges";
import { type Brief, type BriefChunk } from "../../types";
import { type RevisionRun } from "../../revisionChanges";

import styles from "./DeltaCallout.module.scss";

interface DeltaCalloutProps {
  pos: { top: number; left: number };
  run: RevisionRun;
  chunk: BriefChunk;
  delta: Brief | null;
}

export function DeltaCallout({ pos, run, chunk, delta }: DeltaCalloutProps) {
  const callout = bindCallout(run, chunk, delta);
  const verb = run.kind === "removed" ? "Removed" : "New";
  return (
    <Callout pos={pos}>
      <Callout.Eyebrow>{verb} this revision</Callout.Eyebrow>
      {callout.available ? (
        <>
          {callout.groupTitle && (
            <Callout.Title>{callout.groupTitle}</Callout.Title>
          )}
          {callout.summary && <Callout.Body>{callout.summary}</Callout.Body>}
        </>
      ) : (
        <Callout.Body>
          <span className={styles["unavailable"]}>
            Summary unavailable for this span.
          </span>
        </Callout.Body>
      )}
    </Callout>
  );
}
