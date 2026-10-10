import { createContext, useContext, type ReactNode } from "react";

/**
 * Where hunk-edge expansion reads from: the pull whose head the diff was
 * built at. Absent on the local brief path, which has no API to read the
 * file from, so every edge stays folded there.
 */
export interface ExpansionSource {
  repoId: string;
  prNumber: number;
  /** The head commit sha; the file-range read serves no other ref. */
  ref: string;
}

const ExpansionSourceContext = createContext<ExpansionSource | undefined>(
  undefined,
);

export interface ExpansionSourceProviderProps {
  source: ExpansionSource | undefined;
  children: ReactNode;
}

export function ExpansionSourceProvider({
  source,
  children,
}: ExpansionSourceProviderProps) {
  return (
    <ExpansionSourceContext.Provider value={source}>
      {children}
    </ExpansionSourceContext.Provider>
  );
}

export function useExpansionSource(): ExpansionSource | undefined {
  return useContext(ExpansionSourceContext);
}
