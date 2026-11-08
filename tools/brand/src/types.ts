export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One outlined master: a single path drawn inside its view box. */
export interface VectorMaster {
  readonly viewBox: ViewBox;
  readonly pathData: string;
}

/** A filled square of the mark's 5x5 construction grid, zero-based. */
export interface MarkCell {
  readonly column: number;
  readonly row: number;
}

export interface BrandMasters {
  readonly mark: VectorMaster;
  readonly wordmark: VectorMaster;
}

/** One generated file: where it lands, relative to the repo root, and its bytes. */
export interface BrandAsset {
  readonly target: string;
  readonly bytes: Uint8Array;
}
