export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function applyMarkdownWrap(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd);
  const nextText = `${text.slice(0, selectionStart)}${marker}${selected}${marker}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  };
}

export function applyLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd) || "list item";
  const replacement = selected
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart,
    selectionEnd: selectionStart + replacement.length,
  };
}

export function applyLinkTemplate(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd) || "link text";
  const replacement = `[${selected}](https://example.com)`;
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart: selectionStart + 1,
    selectionEnd: selectionStart + 1 + selected.length,
  };
}

export function replaceSelectionWithSuggestion(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
): TextEdit {
  const block = `\`\`\`suggestion\n${replacement}\n\`\`\``;
  const nextText = `${text.slice(0, selectionStart)}${block}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + "```suggestion\n".length,
    selectionEnd:
      selectionStart + "```suggestion\n".length + replacement.length,
  };
}
