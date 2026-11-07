import type { Brief } from "../../../../../model/types";
import { IconNames } from "@web/components/Icon/types";
import styles from "./ProviderBadge.module.scss";
import { ProviderMark } from "./ProviderMark";
import {
  ProviderGenerationTypes,
  type MarkConfig,
  type ProviderGenerationType,
} from "./types";

/**
 * Adapter CLASS per provider key: a harness-CLI run must be visibly
 * distinct from an API/SDK run: the CLI owns routing and auth, so
 * "claude-code" and "anthropic" are different trust shapes even when the
 * same model served. Carried in TEXT (the end tag), never color alone.
 * Mirrors `Providers` in packages/generators/src/config/registry.ts, kept
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
  anthropic: { mark: IconNames.ANTHROPIC, name: "Anthropic" },
  "claude-code": { mark: IconNames.CLAUDE_CODE, name: "Claude Code" },
  cursor: { mark: IconNames.CURSOR, name: "Cursor" },
  openai: { mark: IconNames.OPENAI, name: "OpenAI" },
  openrouter: { mark: IconNames.OPENROUTER, name: "OpenRouter" },
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
  if (!generation) {
    return null;
  }
  const providerSlug = generation.provider;
  // Own-property reads only: the slug comes from artifact data, and a plain
  // index read would resolve inherited Object members ("toString").
  const providerConfig = Object.hasOwn(PROVIDER_CONFIGS, providerSlug)
    ? PROVIDER_CONFIGS[providerSlug]
    : undefined;
  const classTag = Object.hasOwn(PROVIDER_CLASS_TAG, providerSlug)
    ? PROVIDER_CLASS_TAG[providerSlug]
    : undefined;
  return (
    <span className={styles["badge"]} data-provider-badge="">
      <ProviderMark
        config={providerConfig}
        key={providerSlug}
        providerSlug={providerSlug}
      />
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
