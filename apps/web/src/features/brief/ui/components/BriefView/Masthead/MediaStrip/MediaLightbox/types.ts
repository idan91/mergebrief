/** A width and height in CSS pixels. */
export interface DisplaySize {
  readonly width: number;
  readonly height: number;
}

/** How far to scroll an item shown at actual size, in CSS pixels. */
export interface PanOffset {
  readonly left: number;
  readonly top: number;
}

/** A box on screen, in CSS pixels from the viewport's top left. */
export interface ScreenRect extends DisplaySize {
  readonly left: number;
  readonly top: number;
}

/** A point in CSS pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Where a zoom was asked: the click, or a keyboard press with no point. */
export interface ZoomRequest {
  readonly clientX: number;
  readonly clientY: number;
  readonly fromKeyboard: boolean;
}

/** The item point a zoom keeps under the pointer: its share of the item's size, and the pointer's place in the viewport. */
export interface ZoomAnchor {
  readonly fractionX: number;
  readonly fractionY: number;
  readonly pointerX: number;
  readonly pointerY: number;
}
