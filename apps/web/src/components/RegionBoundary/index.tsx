import { CatchBoundary } from "@tanstack/react-router";
import { Suspense, type ReactNode } from "react";

import { FailureClassContext, FailureHeadingContext } from "./context";
import { RegionFailure } from "./RegionFailure";

export interface RegionBoundaryProps {
  /** Names what could not be shown, at the heading level its place gives it. */
  heading: ReactNode;
  /** A failure clears when this changes: the region has something else to show. */
  resetKey: string;
  /** The failure's box, for a region whose content brings its own insets. */
  failureClassName?: string | undefined;
  /**
   * The server render holds a throw here too, so the rest of the route still
   * renders there. Each holding region hydrates as its own unit: keep it to
   * regions a page renders a fixed few of.
   */
  holdsServerFailure?: boolean;
  children: ReactNode;
}

function reportRegionError(error: unknown): void {
  console.error("region failed to render", error);
}

function ignoreReset(): void {}

/**
 * Holds a render failure inside one region of a page: the region is replaced
 * by what failed and a retry, and everything around it stays as it was.
 */
export function RegionBoundary({
  heading,
  resetKey,
  failureClassName,
  holdsServerFailure = false,
  children,
}: RegionBoundaryProps) {
  // Nothing in a region suspends, so the fallback stands only where the
  // server render threw. The client renders the region again, and a repeat
  // throw lands in CatchBoundary's failure, the same block at the same size.
  const content = holdsServerFailure ? (
    <Suspense fallback={<RegionFailure reset={ignoreReset} />}>
      {children}
    </Suspense>
  ) : (
    children
  );

  return (
    <FailureHeadingContext value={heading}>
      <FailureClassContext value={failureClassName}>
        <CatchBoundary
          errorComponent={RegionFailure}
          getResetKey={() => resetKey}
          onCatch={reportRegionError}
        >
          {content}
        </CatchBoundary>
      </FailureClassContext>
    </FailureHeadingContext>
  );
}
