import type { Effort, Generator, Logger } from "generators";
import type { FetchedPr } from "../../github/types";
import type { MediaItem, MediaKey } from "../../media";
import type { SummaryMedia } from "../../types";
import type { WarningCollector } from "../warnings/types";

export interface SummaryMediaResolution {
  /** Absent when nothing valid survived the trims. */
  readonly summaryMedia?: SummaryMedia;
  /** Count-only lines: never a label, caption or address. */
  readonly issues: string[];
}

/** What the trims dropped or changed, by count. */
export interface SummaryMediaTally {
  unknownNumbers: number;
  /** Items whose key the stored check refuses, such as an address past its length cap. */
  unstorableKeys: number;
  repeated: number;
  shownPastCap: number;
  pointerPastCap: number;
  pointerAlreadyShown: number;
  unknownPositions: number;
  pointerDropped: boolean;
}

/** What a pointer's numbers resolve against: the description's items and the keys already shown. */
export interface PointerContext {
  readonly items: readonly MediaItem[];
  readonly shownKeys: ReadonlySet<MediaKey>;
}

/** One Summary Media call, made after the brief when the description holds Media. */
export interface SummaryMediaRequest {
  readonly generator: Generator;
  readonly pr: FetchedPr;
  readonly media: readonly MediaItem[];
  /** The finished brief's summary, which the picks sit beside. */
  readonly summary: string;
  readonly effort: Effort;
  readonly log: Logger;
  readonly warnings: WarningCollector;
}
