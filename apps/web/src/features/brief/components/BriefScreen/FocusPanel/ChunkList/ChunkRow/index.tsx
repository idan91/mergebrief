import { LocSign, LocSigns } from "@web/components/LocSign";
import type { BriefChunk } from "../../../../../types";
import { splitFilePath } from "../../../utils";
import styles from "./ChunkRow.module.scss";

export interface ChunkRowProps {
  chunk: BriefChunk;
  current: boolean;
  jumpToChunk: (chunkId: string) => void;
}

export function ChunkRow({ chunk, current, jumpToChunk }: ChunkRowProps) {
  const { basename } = splitFilePath(chunk.file);

  return (
    <li>
      {/* oxlint-disable-next-line house/no-raw-button -- a list row as a button: name and counts laid out edge to edge */}
      <button
        aria-current={current ? "true" : undefined}
        className={styles["row"]}
        title={chunk.file}
        type="button"
        onClick={() => jumpToChunk(chunk.id)}
      >
        <span className={styles["name"]}>{basename}</span>
        <span className={styles["loc"]}>
          <LocSign sign={LocSigns.ADD} count={chunk.loc.added} />{" "}
          <LocSign sign={LocSigns.DEL} count={chunk.loc.deleted} />
        </span>
      </button>
    </li>
  );
}
