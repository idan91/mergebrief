import type { ValueOf } from "types/utils";

import type { IconName } from "@web/components/Icon/types";

/** A provider's badge assets: its official mark in the icon set and its display name. */
export interface MarkConfig {
  mark: IconName;
  name: string;
}

export const ProviderGenerationTypes = {
  API: "API",
  CLI: "CLI",
} as const;

export type ProviderGenerationType = ValueOf<typeof ProviderGenerationTypes>;
