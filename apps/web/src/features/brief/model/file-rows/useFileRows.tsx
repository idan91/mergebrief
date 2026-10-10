import { createContext, useContext, type ReactNode } from "react";

import type { FileRowsCache } from "./cache";

const FileRowsContext = createContext<FileRowsCache | undefined>(undefined);

export interface FileRowsProviderProps {
  cache: FileRowsCache | undefined;
  children: ReactNode;
}

/** The PR diff's rows per file, for every card of the brief. */
export function FileRowsProvider({ cache, children }: FileRowsProviderProps) {
  return (
    <FileRowsContext.Provider value={cache}>
      {children}
    </FileRowsContext.Provider>
  );
}

export function useFileRows(): FileRowsCache | undefined {
  return useContext(FileRowsContext);
}
