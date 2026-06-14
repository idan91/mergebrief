import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import type { BriefMode, FlagState, ReviewMode, ReviewOutcome, RiskEvidence } from "./state";
import type { ReviewComment } from "./comments";

export interface DemoReviewSnapshot {
  briefId: string;
  reviewMode: ReviewMode;
  briefMode: BriefMode;
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
  const value = useMemo(
    () => ({
      snapshots,
      setSnapshot: (briefId: string, snapshot: DemoReviewSnapshot) => setSnapshots((current) => ({ ...current, [briefId]: snapshot })),
    }),
    [snapshots],
  );

  return <DemoReviewSnapshotContext.Provider value={value}>{children}</DemoReviewSnapshotContext.Provider>;
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
