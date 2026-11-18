import { readTenant } from "./tenant.js";
import type { TenantShape } from "../shapes.ts";
export { TENANT_CAP } from "./consts.mjs";
export * from "./utils.cjs";
export type { TenantRow } from "./types.tsx";
export const loadPanel = () => import("./lazy.js");
export type PanelModule = typeof import("./module.js");

export const used = [readTenant, loadPanel];
export type { TenantShape, TenantRow };
