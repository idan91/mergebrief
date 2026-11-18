/** The attribute a bar carries while its panel is open; layout code watches it change. */
export const OPEN_BAR_ATTRIBUTE = "data-bar-open";

/**
 * Matches a bar whose panel is open. Layout code that measures a column of
 * bars at rest queries it; the bar writes the attribute it names.
 */
export const OPEN_BAR_SELECTOR = `[${OPEN_BAR_ATTRIBUTE}]`;

/**
 * Matches a bar's panel. Layout code that needs an open bar's closed height
 * subtracts the panel it finds; the bar writes the attribute it names.
 */
export const BAR_PANEL_SELECTOR = "[data-bar-panel]";
