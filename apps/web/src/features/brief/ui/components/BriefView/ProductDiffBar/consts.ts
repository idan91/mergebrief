import type { TranslationKey } from "i18n";

import { ProductChangeAreas, type ProductChangeArea } from "brief-core/types";

export const AREA_LABEL_KEYS: Record<ProductChangeArea, TranslationKey> = {
  [ProductChangeAreas.USER_FLOW]: "brief.productDiff.area.userFlow",
  [ProductChangeAreas.API_CONTRACT]: "brief.productDiff.area.apiContract",
  [ProductChangeAreas.BUSINESS_RULE]: "brief.productDiff.area.businessRule",
  [ProductChangeAreas.DATA]: "brief.productDiff.area.data",
  [ProductChangeAreas.INTEGRATION]: "brief.productDiff.area.integration",
  [ProductChangeAreas.OPERATIONS]: "brief.productDiff.area.operations",
  [ProductChangeAreas.BACKGROUND_PROCESS]:
    "brief.productDiff.area.backgroundProcess",
};
