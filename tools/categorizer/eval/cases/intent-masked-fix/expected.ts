import type { EvalProperty } from "../../properties";

/**
 * Masking case on an authored diff over the own-repo webhook route at `d98c3ff5`
 * (the PR locator is a placeholder): it demotes `webhook.dispatch.fail` to warn.
 * A, redelivered events ingest: claimed fixed, only the signal moved, so `maskedFixes`.
 * B, keep the line at error: reversed and acknowledged, so an acknowledged deviation.
 * C, a redelivery regression test: absent and unclaimed, so `statedButMissing`.
 * `intent-legit-demotion` reuses this diff byte-identically. `masked-fix-not-credited`
 * passes vacuously on an emptied check; the positives and `masked-precise` anchor it.
 */
export const properties: EvalProperty[] = [
  {
    id: "masked-precise",
    description:
      "a concrete three-ask ticket reads as precise specificity (the gate the alarm buckets sit behind)",
    check: (brief) => brief.intentCheck?.specificity === "precise",
  },
  {
    id: "masked-fix-claim-flagged",
    description:
      "the claimed-but-unmade redelivery fix lands in maskedFixes (the sources claim a fix; only the log level moved)",
    check: (brief) =>
      (brief.intentCheck?.maskedFixes ?? []).some((item) =>
        /redeliver|ingest|dispatch fail|dispatch pages/i.test(
          `${item.intent} ${item.quote}`,
        ),
      ),
  },
  {
    id: "masked-fix-not-credited",
    description:
      "the redelivery fix is NOT credited as accomplished — the masking read replaces the credit, it does not sit alongside it",
    check: (brief) =>
      brief.intentCheck !== undefined &&
      !brief.intentCheck.accomplished.some((item) =>
        /redeliver|ingest/i.test(`${item.intent} ${item.quote}`),
      ),
  },
  {
    id: "masked-deviation-acknowledged",
    description:
      "the reversed 'keep it at error' ask lands in deviations AND is marked acknowledged (the description owns the reversal)",
    check: (brief) =>
      (brief.intentCheck?.deviations ?? []).some(
        (item) =>
          item.acknowledged &&
          /error level|at error|on-call|page/i.test(
            `${item.intent} ${item.quote}`,
          ),
      ),
  },
  {
    id: "masked-absent-ask-stays-neutral",
    description:
      "the plainly-absent regression-test ask stays in statedButMissing — an undelivered ask is not promoted to an alarm bucket",
    check: (brief) =>
      (brief.intentCheck?.statedButMissing ?? []).some((item) =>
        /regression test|redelivers the same|test that redeliver/i.test(
          `${item.intent} ${item.quote}`,
        ),
      ),
  },
  {
    id: "masked-alignment-misaligned",
    description:
      "a diff that only silences the signal of the problem the ticket asks to fix reads as misaligned, with a goal that verified",
    check: (brief) =>
      brief.intentCheck?.alignment?.read === "misaligned" &&
      (brief.intentCheck.alignment.goal ?? "").length > 0,
  },
];
