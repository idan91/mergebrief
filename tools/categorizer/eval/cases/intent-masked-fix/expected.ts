import type { EvalProperty } from "../../properties";

/**
 * BRIEF-85 masking case: the source claims a fix the diff never makes.
 *
 * Fixture origin: unlike the seed cases, the diff here is AUTHORED —
 * hand-written over the real `packages/api` webhook route and its logging
 * test at `d98c3ff5`. No real PR in an own repo carries a fake-fix shape
 * (that would be a genuine defect), and the shape is the whole point of
 * the case. Own-repo files, so the source rule holds: publishable by
 * construction. The PR locator is a placeholder, not a real PR. The
 * `intent-legit-demotion` twin reuses this diff BYTE-IDENTICALLY, so the
 * only variable between the two cases is the intent source.
 *
 * The diff demotes `webhook.dispatch.fail` from error to warn and updates
 * the one test that pins the level. Nothing touches dispatch behaviour.
 * The ticket states three asks:
 *
 *  A. make a redelivered event ingest instead of throwing — the PR title
 *     and description claim this is fixed, but only the problem's SIGNAL
 *     moved ⇒ `claimedButUnachieved`.
 *  B. keep the line at error level so on-call pages — the diff does the
 *     opposite, and the description acknowledges the reversal ⇒
 *     `deviations` with `acknowledged: true` (retracted-nowhere rule: an
 *     acknowledged reversal is a quiet receipt, not an alarm).
 *  C. add a redelivery regression test — simply absent, nothing claims
 *     otherwise ⇒ `statedButMissing`. The routing discriminator: an
 *     undelivered ask stays neutral, it does not get promoted to an alarm.
 *
 * Vacuity note (BRIEF-59 trap): the three bucket assertions
 * (`masked-fix-claim-flagged`, `masked-deviation-acknowledged`,
 * `masked-absent-ask-stays-neutral`) are POSITIVE existence checks, verified
 * to fail on an empty/unavailable intent check. Two of them —
 * `masked-fix-claim-flagged` and `masked-deviation-acknowledged` — could not
 * pass at all before the BRIEF-85 buckets existed on the schema, so this case
 * cannot go green on the pre-BRIEF-85 surface. (`masked-absent-ask-stays-
 * neutral` asserts on `statedButMissing`, a BRIEF-54 bucket, so it alone is
 * not pre-BRIEF-85-proof.) `masked-fix-not-credited` is the one absence check
 * and DOES pass vacuously on an emptied check; it is anchored by the three
 * positives plus `masked-precise`, all of which fail in that world. Read it
 * with them, never alone.
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
      "the claimed-but-unmade redelivery fix lands in claimedButUnachieved (the corpus claims a fix; only the log level moved)",
    check: (brief) =>
      (brief.intentCheck?.claimedButUnachieved ?? []).some((item) =>
        /redeliver|ingest|dispatch fail/i.test(`${item.intent} ${item.quote}`),
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
];
