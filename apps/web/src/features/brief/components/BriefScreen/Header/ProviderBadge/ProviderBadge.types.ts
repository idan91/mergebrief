import type { ComponentType, SVGProps } from "react";
import type { ValueOf } from "types";

export type MarkComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** A provider's badge assets: its official mark and display name. */
export interface MarkConfig {
  mark: MarkComponent;
  name: string;
}

export const ProviderGenerationTypes = {
  API: "API",
  CLI: "CLI",
} as const;

export type ProviderGenerationType = ValueOf<typeof ProviderGenerationTypes>;
