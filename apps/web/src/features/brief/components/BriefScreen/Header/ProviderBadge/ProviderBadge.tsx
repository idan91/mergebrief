import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { Brief } from "../../../../types";
// One .svg asset per mark, imported as components via vite-plugin-svgr so
// currentColor inherits. Real logos only — never a hand-drawn approximation.
import AnthropicMark from "./marks/anthropic.svg?react";
import ClaudeCodeMark from "./marks/claude-code.svg?react";
import CursorMark from "./marks/cursor.svg?react";
import GenericProviderMark from "./marks/generic.svg?react";
import OpenAiMark from "./marks/openai.svg?react";
import OpenRouterMark from "./marks/openrouter.svg?react";
import styles from "./ProviderBadge.module.scss";
import {
  ProviderGenerationTypes,
  type MarkConfig,
  type ProviderGenerationType,
} from "./ProviderBadge.types";

/**
 * Adapter CLASS per provider token: a harness-CLI run must be visibly
 * distinct from an API/SDK run — the CLI owns routing and auth, so
 * "claude-code" and "anthropic" are different trust shapes even when the
 * same model served. Carried in TEXT (the end tag), never color alone.
 * Mirrors `Providers` in packages/generators/src/config/registry.ts — kept
 * as plain data here, since client code must not pull provider SDKs.
 */
const PROVIDER_CLASS_TAG: Record<string, ProviderGenerationType> = {
  anthropic: ProviderGenerationTypes.API,
  openai: ProviderGenerationTypes.API,
  openrouter: ProviderGenerationTypes.API,
  "claude-code": ProviderGenerationTypes.CLI,
  codex: ProviderGenerationTypes.CLI,
  cursor: ProviderGenerationTypes.CLI,
};

/**
 * Official marks by provider slug. `codex` is deliberately absent: OpenAI
 * publishes no standalone Codex logomark, so it takes the named fallback
 * rather than an approximation.
 */
const PROVIDER_CONFIGS: Record<string, MarkConfig> = {
  anthropic: { mark: AnthropicMark, name: "Anthropic" },
  "claude-code": { mark: ClaudeCodeMark, name: "Claude Code" },
  cursor: { mark: CursorMark, name: "Cursor" },
  openai: { mark: OpenAiMark, name: "OpenAI" },
  openrouter: { mark: OpenRouterMark, name: "OpenRouter" },
};

export interface ProviderBadgeProps {
  /** The artifact's origin stamp; absent → no badge on older artifacts. */
  generation: Brief["generation"];
}

/**
 * Neutral mark cell → mono model cell (full model id + effort; origin never
 * abbreviates identity) → textual API/CLI end tag. Fixed 18px height riding
 * INSIDE the meta-height line box; non-interactive origin chrome.
 */
export function ProviderBadge({ generation }: ProviderBadgeProps) {
  if (!generation) return null;
  const providerSlug = generation.provider;
  // Own-property reads only: the slug comes from artifact data, and a plain
  // index read would resolve inherited Object members ("toString").
  const providerConfig = Object.hasOwn(PROVIDER_CONFIGS, providerSlug)
    ? PROVIDER_CONFIGS[providerSlug]
    : undefined;
  // Capitalized so the JSX below reads as a component, not a host tag.
  const Mark = providerConfig?.mark;
  const classTag = Object.hasOwn(PROVIDER_CLASS_TAG, providerSlug)
    ? PROVIDER_CLASS_TAG[providerSlug]
    : undefined;
  return (
    <span className={styles["badge"]} data-provider-badge="">
      {/* `title` gives pointer users the provider name — the logo alone
          isn't universally recognizable. Screen readers keep the sr-only
          sibling. */}
      <span className={styles["markCell"]} title={providerConfig?.name}>
        {providerConfig && Mark ? (
          <>
            <Mark
              aria-hidden="true"
              className={styles["mark"]}
              focusable="false"
            />
            <ScreenReaderOnly>{providerConfig.name}</ScreenReaderOnly>
          </>
        ) : (
          // Named fallback: generic glyph + the provider token as visible
          // text — never a hand-drawn brand approximation.
          <>
            <GenericProviderMark
              aria-hidden="true"
              className={styles["mark"]}
              focusable="false"
            />
            <span className={styles["markName"]}>{providerSlug}</span>
          </>
        )}
      </span>
      <span className={styles["modelCell"]}>
        {generation.model}
        {generation.effort ? ` · ${generation.effort}` : ""}
      </span>
      {classTag !== undefined ? (
        <span className={styles["classTag"]}>
          <span>{classTag}</span>
        </span>
      ) : null}
    </span>
  );
}
