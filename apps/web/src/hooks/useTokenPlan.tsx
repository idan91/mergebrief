import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import {
  planBriefGrammars,
  warmDiffTokenWorker,
} from "@web/utils/diffTokens/client";
import type { BriefChunkSize, GrammarName } from "@web/utils/diffTokens/types";

export interface TokenPlan {
  briefKey: string;
  admitted: ReadonlySet<GrammarName>;
}

const NO_GRAMMARS: ReadonlySet<GrammarName> = new Set();
const NO_PLAN: TokenPlan = { briefKey: "", admitted: NO_GRAMMARS };

const TokenPlanContext = createContext<TokenPlan>(NO_PLAN);

export interface TokenPlanProviderProps {
  briefKey: string;
  /** Every tokenizable file under this key, largest-first budgeting input. */
  chunkSizes: BriefChunkSize[];
  children: ReactNode;
}

/**
 * One budget plan per brief, memoized because every token effect keys on the
 * set's identity. Warming here overlaps the worker's cold start with the
 * first paint.
 */
export function TokenPlanProvider({
  briefKey,
  chunkSizes,
  children,
}: TokenPlanProviderProps) {
  const plan = useMemo(
    () => buildTokenPlan(briefKey, chunkSizes),
    [briefKey, chunkSizes],
  );

  useEffect(() => {
    warmDiffTokenWorker(plan.briefKey, [...plan.admitted]);
  }, [plan]);

  return (
    <TokenPlanContext.Provider value={plan}>
      {children}
    </TokenPlanContext.Provider>
  );
}

/** Outside a provider every caller reads as unadmitted and renders plain. */
export function useTokenPlan(): TokenPlan {
  return useContext(TokenPlanContext);
}

function buildTokenPlan(
  briefKey: string,
  chunkSizes: BriefChunkSize[],
): TokenPlan {
  const plan = planBriefGrammars(chunkSizes);

  return { briefKey, admitted: new Set(plan.admitted) };
}
