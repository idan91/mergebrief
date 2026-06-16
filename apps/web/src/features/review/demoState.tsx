import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { FlagState, ReviewMode, ReviewOutcome, RiskEvidence } from "./state";
import type { ReviewComment } from "./comments";

export interface DemoReviewSnapshot {
  briefId: string;
  reviewMode: ReviewMode;
  reviewOutcome: ReviewOutcome;
  flagStates: Record<string, FlagState>;
  riskEvidence: Record<string, RiskEvidence>;
  reviewedChunkIds: string[];
  reviewComments: ReviewComment[];
}

interface DemoReviewSnapshotContextValue {
  snapshots: Record<string, DemoReviewSnapshot>;
  setSnapshot: (briefId: string, snapshot: DemoReviewSnapshot) => void;
}

const DemoReviewSnapshotContext = createContext<DemoReviewSnapshotContextValue | null>(null);

export function DemoReviewSnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshots, setSnapshots] = useState<Record<string, DemoReviewSnapshot>>({});
  const setSnapshot = useCallback((briefId: string, snapshot: DemoReviewSnapshot) => {
    setSnapshots((current) => {
      if (snapshotsEqual(current[briefId], snapshot)) return current;
      return { ...current, [briefId]: snapshot };
    });
  }, []);
  const value = useMemo(
    () => ({
      snapshots,
      setSnapshot,
    }),
    [setSnapshot, snapshots],
  );

  return <DemoReviewSnapshotContext.Provider value={value}>{children}</DemoReviewSnapshotContext.Provider>;
}

function snapshotsEqual(a: DemoReviewSnapshot | undefined, b: DemoReviewSnapshot): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

export function useDemoReviewSnapshot(briefId: string): DemoReviewSnapshot | undefined {
  return useDemoReviewSnapshots().snapshots[briefId];
}

export function useSetDemoReviewSnapshot(): DemoReviewSnapshotContextValue["setSnapshot"] {
  return useDemoReviewSnapshots().setSnapshot;
}

function useDemoReviewSnapshots(): DemoReviewSnapshotContextValue {
  const context = useContext(DemoReviewSnapshotContext);
  if (!context) {
    throw new Error("DemoReviewSnapshotProvider is missing");
  }
  return context;
}
