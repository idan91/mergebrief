const MS_PER_SECOND = 1000;

/** Gives every closed dialog a CSS exit of `exitMs`, which jsdom otherwise reports as none. */
export function stubExitTransition(exitMs: number): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `[inert] { transition-duration: ${exitMs / MS_PER_SECOND}s; }`;
  document.head.append(style);
  return style;
}
