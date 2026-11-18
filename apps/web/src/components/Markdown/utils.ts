export interface SuggestionBlock {
  body: string;
  index: number;
}

export interface SuggestionDiffRow {
  kind: "del" | "add";
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function parseSuggestionBlocks(markdown: string): SuggestionBlock[] {
  const suggestions: SuggestionBlock[] = [];
  const pattern = /```suggestion\n([\s\S]*?)\n```/g;
  for (const match of markdown.matchAll(pattern)) {
    suggestions.push({
      body: match[1] ?? "",
      index: suggestions.length,
    });
  }
  return suggestions;
}

export function stripSuggestionBlocks(markdown: string): string {
  return markdown
    .replace(/\n?```suggestion\n[\s\S]*?\n```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Addition-only rows for a suggestion WITHOUT an anchor: the fence carries
 * only the replacement text, and the old side lives in the PR diff context
 * that the conversation read does not fetch.
 */
export function buildSuggestionAdditionRows(
  suggestionText: string,
): SuggestionDiffRow[] {
  const lines = suggestionText.length === 0 ? [""] : suggestionText.split("\n");
  return lines.map((content) => ({ kind: "add", content }));
}
