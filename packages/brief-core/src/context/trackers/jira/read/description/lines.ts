import { truncateToCodeUnits } from "../../../../utils";

/** The lines one walk has written, under its character cap. */
export class LineCollector {
  private readonly lines: string[] = [];
  private readonly maxChars: number;
  private length = 0;

  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }

  /** True once the lines hold the cap: the walk reads no further node. */
  get full(): boolean {
    return this.length >= this.maxChars;
  }

  get remaining(): number {
    return Math.max(0, this.maxChars - this.length);
  }

  add(line: string): void {
    this.lines.push(line);
    this.length += line.length + 1;
  }

  toLines(): readonly string[] {
    return this.lines;
  }

  render(): string {
    return truncateToCodeUnits(this.lines.join("\n"), this.maxChars);
  }
}
