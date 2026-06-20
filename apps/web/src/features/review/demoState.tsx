import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  clearSnapshots: () => void;
}

const DemoReviewSnapshotContext = createContext<DemoReviewSnapshotContextValue | null>(null);
const STORAGE_KEY = "code-review:demo-snapshots:v1";
const MAX_SNAPSHOTS = 12;

export function DemoReviewSnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshots, setSnapshots] = useState<Record<string, DemoReviewSnapshot>>({});
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setSnapshots(JSON.parse(raw) as Record<string, DemoReviewSnapshot>); } catch { window.sessionStorage.removeItem(STORAGE_KEY); }
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const timer = window.setTimeout(() => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots)), 250);
    return () => window.clearTimeout(timer);
  }, [snapshots, storageReady]);
  const setSnapshot = useCallback((briefId: string, snapshot: DemoReviewSnapshot) => {
    setSnapshots((current) => {
      if (snapshotsEqual(current[briefId], snapshot)) return current;
      const next = { ...current, [briefId]: snapshot };
      const ids = Object.keys(next);
      if (ids.length > MAX_SNAPSHOTS) delete next[ids[0] ?? briefId];
      return next;
    });
  }, []);
  const clearSnapshots = useCallback(() => {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSnapshots({});
  }, []);
  const value = useMemo(
    () => ({
      snapshots,
      setSnapshot,
      clearSnapshots,
    }),
    [clearSnapshots, setSnapshot, snapshots],
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

export function useClearDemoReviewSnapshots(): DemoReviewSnapshotContextValue["clearSnapshots"] {
  return useDemoReviewSnapshots().clearSnapshots;
}

function useDemoReviewSnapshots(): DemoReviewSnapshotContextValue {
  const context = useContext(DemoReviewSnapshotContext);
  if (!context) {
    throw new Error("DemoReviewSnapshotProvider is missing");
  }
  return context;
}
