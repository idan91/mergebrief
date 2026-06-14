import type { DiffLine } from "../brief/types";

export type CommentSide = "old" | "new";

export interface CommentAnchor {
  chunkId: string;
  file: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  rowIds: string[];
  selectedText: string;
}

export interface TextEditResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface SuggestionBlock {
  body: string;
  index: number;
}

export interface ReviewComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  status: "draft" | "submitted";
  collapsed: boolean;
}

export function createCommentAnchor(chunkId: string, file: string, rows: DiffLine[], selectedIndexes: number[]): CommentAnchor | null {
  const orderedIndexes = [...new Set(selectedIndexes)].sort((left, right) => left - right);
  if (orderedIndexes.length === 0) return null;
  if (!isContinuous(orderedIndexes)) return null;

  const selectedRows = orderedIndexes.map((index) => rows[index]);
  if (selectedRows.some((row) => !row || row.kind === "hunk" || row.kind === "note")) return null;

  const hasAdd = selectedRows.some((row) => row?.kind === "add");
  const hasDel = selectedRows.some((row) => row?.kind === "del");
  if (hasAdd && hasDel) return null;

  const side: CommentSide = hasDel ? "old" : "new";
  const lineNumbers = selectedRows.map((row) => lineForSide(row, side));
  if (lineNumbers.some((line) => typeof line !== "number")) return null;

  const concreteLines = lineNumbers.filter((line): line is number => typeof line === "number");
  const startLine = concreteLines[0];
  const endLine = concreteLines.at(-1);
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;

  return {
    chunkId,
    file,
    side,
    startLine,
    endLine,
    rowIds: orderedIndexes.map((index) => rowId(chunkId, index)),
    selectedText: selectedRows.map((row) => row?.content ?? "").join("\n"),
  };
}

export function rowId(chunkId: string, rowIndex: number): string {
  return `${chunkId}:${rowIndex}`;
}

export function applyMarkdownWrap(text: string, selectionStart: number, selectionEnd: number, marker: string): TextEditResult {
  const selected = text.slice(selectionStart, selectionEnd);
  const nextText = `${text.slice(0, selectionStart)}${marker}${selected}${marker}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  };
}

export function replaceSelectionWithSuggestion(text: string, selectionStart: number, selectionEnd: number, replacement: string): TextEditResult {
  const block = `\`\`\`suggestion\n${replacement}\n\`\`\``;
  const nextText = `${text.slice(0, selectionStart)}${block}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + "```suggestion\n".length,
    selectionEnd: selectionStart + "```suggestion\n".length + replacement.length,
  };
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
  return markdown.replace(/\n?```suggestion\n[\s\S]*?\n```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function reviewCommentSubmitLabel(existingCommentCount: number): string {
  return existingCommentCount === 0 ? "Start review" : "Add review comment";
}

export function commentAnchorLabel(anchor: CommentAnchor): string {
  const sign = anchor.side === "new" ? "+" : "-";
  const range = anchor.startLine === anchor.endLine ? `${sign}${anchor.startLine}` : `${sign}${anchor.startLine}-${anchor.endLine}`;
  return `${anchor.file} · ${range}`;
}

function lineForSide(row: DiffLine | undefined, side: CommentSide): number | undefined {
  if (!row) return undefined;
  return side === "old" ? row.oldLine : row.newLine;
}

function isContinuous(indexes: number[]): boolean {
  return indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1);
}
