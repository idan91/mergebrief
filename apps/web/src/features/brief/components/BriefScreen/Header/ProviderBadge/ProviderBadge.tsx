import type { ReactNode } from "react";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { Brief } from "../../../../types";
import {
  AnthropicMark,
  ClaudeCodeMark,
  GenericProviderMark,
  OpenAiMark,
  OpenRouterMark,
} from "./marks";
import styles from "./ProviderBadge.module.scss";

export interface ProviderBadgeProps {
  /** The artifact's provenance stamp; absent → no badge (pre-ADR-0013 artifacts). */
  generation: Brief["generation"];
}

/**
 * Adapter CLASS per provider token (ADR 0030 #6): a harness-CLI run must be
 * visibly distinct from an API/SDK run — the CLI owns routing and auth, so
 * "claude-code" and "anthropic" are different trust shapes even when the
 * same model served. Carried in TEXT (the end tag), never color alone.
 * Pinned to `Providers` in packages/generators/src/config/registry.ts —
 * kept as plain data here (client code must not pull provider SDKs).
 */
const PROVIDER_CLASS_TAG: Record<string, string> = {
  anthropic: "API",
  openai: "API",
  openrouter: "API",
  "claude-code": "CLI",
  codex: "CLI",
};

/**
 * Official marks by provider token. `codex` is deliberately absent: OpenAI
 * publishes no standalone Codex logomark (see marks.tsx provenance block),
 * so it takes the named fallback rather than an approximation.
 */
const PROVIDER_MARK: Record<string, { mark: () => ReactNode; name: string }> = {
  anthropic: { mark: AnthropicMark, name: "Anthropic" },
  "claude-code": { mark: ClaudeCodeMark, name: "Claude Code" },
  openai: { mark: OpenAiMark, name: "OpenAI" },
  openrouter: { mark: OpenRouterMark, name: "OpenRouter" },
};

/**
 * The keycap-split provenance badge (BRIEF-103 spec): neutral mark cell →
 * mono model cell (full model id + effort — OpenRouter author prefixes kept,
 * provenance never abbreviates identity) → textual API/CLI end tag. Fixed
 * 18px height riding INSIDE the meta-height line box; non-interactive
 * provenance chrome (badge-as-trigger rejected).
 */
export function ProviderBadge({ generation }: ProviderBadgeProps) {
  if (!generation) return null;
  const provider = generation.provider;
  // Own-property reads only: the token comes from artifact data, and a plain
  // index read would resolve inherited Object members ("toString").
  const known = Object.hasOwn(PROVIDER_MARK, provider)
    ? PROVIDER_MARK[provider]
    : undefined;
  const classTag = Object.hasOwn(PROVIDER_CLASS_TAG, provider)
    ? PROVIDER_CLASS_TAG[provider]
    : undefined;
  return (
    <span className={styles["badge"]} data-provider-badge="">
      {/* `title`: pointer users get the provider name as the native browser
          tooltip (Idan 2026-08-04) — the logo alone isn't universally
          recognizable. Screen readers keep the sr-only sibling. */}
      <span
        className={styles["markCell"]}
        title={known ? known.name : undefined}
      >
        {known ? (
          <>
            <known.mark />
            <ScreenReaderOnly>{known.name}</ScreenReaderOnly>
          </>
        ) : (
          // Named fallback (accuracy gate): generic glyph + the provider
          // token as visible text — never a hand-drawn brand approximation.
          <>
            <GenericProviderMark />
            <span className={styles["markName"]}>{provider}</span>
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
