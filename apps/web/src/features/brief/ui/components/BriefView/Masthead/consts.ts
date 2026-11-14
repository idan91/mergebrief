/** The grid's held card height; the stylesheet defaults it to auto. */
export const CARD_MIN_PROPERTY = "--masthead-card-min";

/** How far the stack sits below the summary's row gap; the stylesheet defaults it to zero. */
export const STACK_OFFSET_PROPERTY = "--masthead-stack-offset";

/**
 * On the grid while a fold is open: the stylesheet applies the held height
 * and the offset only then, and lays the card out by itself at rest.
 */
export const HELD_ATTRIBUTE = "data-held";

/** The fewest attributed concerns that make a Split worth showing. */
export const MIN_SPLIT_CONCERNS = 2;
