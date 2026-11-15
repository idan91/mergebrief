import { CatchBoundary } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { FailureClassContext, FailureHeadingContext } from "./context";
import { RegionFailure } from "./RegionFailure";

export interface RegionBoundaryProps {
  /** Names what could not be shown, at the heading level its place gives it. */
  heading: ReactNode;
  /** A failure clears when this changes: the region has something else to show. */
  resetKey: string;
  /** The failure's box, for a region whose content brings its own insets. */
  failureClassName?: string | undefined;
  children: ReactNode;
}

function reportRegionError(error: unknown): void {
  console.error("region failed to render", error);
}

/**
 * Holds a render failure inside one region of a page: the region is replaced
 * by what failed and a retry, and everything around it stays as it was.
 */
export function RegionBoundary({
  heading,
  resetKey,
  failureClassName,
  children,
}: RegionBoundaryProps) {
  return (
    <FailureHeadingContext value={heading}>
      <FailureClassContext value={failureClassName}>
        <CatchBoundary
          errorComponent={RegionFailure}
          getResetKey={() => resetKey}
          onCatch={reportRegionError}
        >
          {children}
        </CatchBoundary>
      </FailureClassContext>
    </FailureHeadingContext>
  );
}
