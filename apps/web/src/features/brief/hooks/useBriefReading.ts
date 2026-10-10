import { useMemo } from "react";

import type {
  BriefReading,
  BriefReadingSource,
} from "../components/BriefScreen/types";
import { buildBriefViewModel } from "../utils/viewModel";

/** The model keeps its identity while the Brief and repo config do: the session store and every memo'd card key on it. */
export function useBriefReading(source: BriefReadingSource): BriefReading {
  const { brief, repoConfig } = source;
  const model = useMemo(
    () => buildBriefViewModel(brief, repoConfig),
    [brief, repoConfig],
  );

  return { ...source, model };
}
