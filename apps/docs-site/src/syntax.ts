import type { MarkdownOptions } from "vitepress";

type CodeTransformer = NonNullable<MarkdownOptions["codeTransformers"]>[number];

/** GitHub's own themes; the dark one's comment grey is the product's AA-lifted value. */
export const CODE_THEMES = {
  light: "github-light-default",
  dark: "github-dark-default",
} as const;

/** github-light-default's comment grey sits at 4.1:1 on the light code block; GitHub's muted grey clears 4.5:1. */
const LIGHT_COMMENT_COLOR = /--shiki-light:#6e7781/giu;
const LIGHT_COMMENT_LIFTED = "--shiki-light:#656d76";

export function liftLightCommentColor(style: string): string {
  return style.replace(LIGHT_COMMENT_COLOR, LIGHT_COMMENT_LIFTED);
}

export function createSyntaxContrastTransformer(): CodeTransformer {
  return {
    name: "mergebrief:syntax-contrast",
    span(node) {
      const style = node.properties["style"];
      if (typeof style === "string") {
        node.properties["style"] = liftLightCommentColor(style);
      }
    },
  };
}
