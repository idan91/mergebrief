// opentype.js 2 ships no declarations; this states the slice the outliner calls.
declare module "opentype.js" {
  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  export interface PathDataOptions {
    decimalPlaces: number;
    flipY: boolean;
    optimize: boolean;
  }

  export interface Path {
    toPathData(options: PathDataOptions): string;
    getBoundingBox(): BoundingBox;
  }

  export type VariationCoordinates = Record<string, number>;

  export interface GlyphRenderOptions {
    variation: VariationCoordinates;
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(
      x: number,
      y: number,
      fontSize: number,
      options: GlyphRenderOptions,
      font: Font,
    ): Path;
  }

  export interface VariationManager {
    getTransform(glyph: Glyph, coordinates: VariationCoordinates): Glyph;
  }

  export type KerningLookups = unknown;

  export interface Position {
    getDefaultScriptName(): string;
    getKerningTables(script: string): KerningLookups;
    getKerningValue(
      lookups: KerningLookups,
      leftIndex: number,
      rightIndex: number,
    ): number;
  }

  export interface Font {
    unitsPerEm: number;
    variation: VariationManager;
    position: Position;
    charToGlyph(character: string): Glyph;
  }

  interface OpenType {
    parse(buffer: ArrayBuffer): Font;
  }

  const opentype: OpenType;
  export default opentype;
}
