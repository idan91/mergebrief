import { createContext, useContext, type ReactNode } from "react";

import type { BriefChunk } from "../types";
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

/**
 * The chunk with its rows once the PR diff has landed, itself until then.
 * The brief's chunks keep their identity when the diff lands, so only the
 * cards that read rows re-render.
 */
export function useChunkWithRows(chunk: BriefChunk): BriefChunk {
  const fileRows = useFileRows();
  return fileRows === undefined ? chunk : fileRows.attachChunkRows(chunk);
}
