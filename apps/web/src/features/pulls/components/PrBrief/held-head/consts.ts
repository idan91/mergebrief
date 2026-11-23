import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
} from "../../../types";
import { GenerateNotices } from "../trigger-offer";

/** Generate now on a held head: a head that stopped being held says so. */
export const HeldGenerateNotices: RegenerateNoticeKeys = {
  ...GenerateNotices,
  [RegenerateResultKinds.NOT_REGENERABLE]: "pulls.held.generate.stale",
};
