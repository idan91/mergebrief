import { createContext, type ReactNode } from "react";

// The boundary hands its failure component the error and a reset, nothing
// else, so what the region asked for travels by context.
export const FailureHeadingContext = createContext<ReactNode>(null);
export const FailureClassContext = createContext<string | undefined>(undefined);
