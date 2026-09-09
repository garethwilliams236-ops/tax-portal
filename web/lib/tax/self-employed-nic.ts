/**
 * Class 2 and Class 4 National Insurance on self-employment.
 *
 * Two contributions with almost nothing in common. Class 4 is a tax on profit
 * in bands, computed like any other. Class 2 is not really a charge any more:
 * since 6 April 2024 nobody has to pay it, and the only question is whether a
 * year with low profits is worth buying to protect the State Pension record.
 * The two are computed separately and reported separately, because conflating
 * them is how a £3.65-a-week decision disappears inside a four-figure bill.
 */

import { selfEmployedNicRates, type TaxYear } from './rates';

export interface SelfEmployedNicInputs {
  /**
   * Taxable profits for the year — the total across all trades and
   * partnership shares. Class 4 is charged on the whole, not trade by trade.
   */
  profits: number;
  /** SA103S box 36 / SA103F box 100 / SA104 box 25 — pay Class 2 voluntarily. */
  payClass2Voluntarily?: boolean;
  /** SA103S box 37 / SA103F box 101 / SA104 box 26 — exempt from Class 4. */
  exemptFromClass4?: boolean;
  /** SA103F box 102 / SA104 box 27 — adjustment to profits chargeable to Class 4. */
  class4Adjustment?: number;
}

export interface SelfEmployedNicResult {
  class2: number;
  class4: number;
  total: number;
  /** True when profits reach the SPT, so the year counts without paying. */
  class2Credited: boolean;
  /** Profits Class 4 was actually charged on, after any adjustment. */
  class4Profits: number;
  workings: string[];
  /** Decisions the figures depend on that the portal cannot make for you. */
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const pc = (n: number) => (n * 100).toFixed(n * 100 % 1 ? 1 : 0) + '%';

/**
 * Class 2 is charged per contribution WEEK, and a tax year sometimes contains
 * 53 of them. NIM23550 says 52 weeks is enough to make the year qualify even
 * then, so 52 is the multiplier — but no GOV.UK rate table states an annual
 * pound figure, so this is inference from the charging basis rather than a
 * published number, and the workings say so.
 */
const CONTRIBUTION_WEEKS = 52;

export function computeSelfEmployedNic(
  inputs: SelfEmployedNicInputs,
  taxYear: TaxYear,
): SelfEmployedNicResult {
  const r = selfEmployedNicRates(taxYear);
  const workings: string[] = [];
  const notes: string[] = [];

  const profits = Math.max(0, inputs.profits);

  // --- Class 2 -------------------------------------------------------------

  const class2Credited = profits >= r.smallProfitsThreshold;
  let class2 = 0;

  if (class2Credited) {
    workings.push(
      `Class 2: profits of ${money0(profits)} reach the Small Profits Threshold of ${money0(r.smallProfitsThreshold)}, ` +
      `so nothing is payable and Class 2 is treated as having been paid. The year counts towards the State Pension either way.`,
    );
    if (inputs.payClass2Voluntarily) {
      notes.push(
        `The voluntary Class 2 box is ticked, but profits are at or above the Small Profits Threshold — ` +
        `the year is already credited, so there is nothing to buy. Untick it.`,
      );
    }
  } else if (inputs.payClass2Voluntarily) {
    class2 = round2(r.class2WeeklyRate * CONTRIBUTION_WEEKS);
    workings.push(
      `Class 2: profits of ${money0(profits)} are below the Small Profits Threshold of ${money0(r.smallProfitsThreshold)}, ` +
      `so none is due. Paid voluntarily at ${money(r.class2WeeklyRate)} a week × ${CONTRIBUTION_WEEKS} weeks = ${money(class2)}.`,
    );
    notes.push(
      `The ${money(class2)} annual figure is ${CONTRIBUTION_WEEKS} × the weekly rate. HMRC charges Class 2 per contribution ` +
      `week and does not publish an annual figure, so check it against HMRC's own calculation before paying. A year in which ` +
      `the trade started or ceased part way through is charged on the actual weeks, not the full 52.`,
    );
  } else {
    workings.push(
      `Class 2: profits of ${money0(profits)} are below the Small Profits Threshold of ${money0(r.smallProfitsThreshold)}, ` +
      `so none is due and the year is NOT credited.`,
    );
    notes.push(
      `This year will not count towards the State Pension unless it is bought. ${money(r.class2WeeklyRate)} a week ` +
      `(about ${money(round2(r.class2WeeklyRate * CONTRIBUTION_WEEKS))} for the year) as voluntary Class 2 is the cheap way; ` +
      `Class 3 for the same year costs ${money(r.class3WeeklyRate)} a week. Whether it is worth buying depends on how many ` +
      `qualifying years you already have.`,
    );
  }

  // --- Class 4 -------------------------------------------------------------

  const adjustment = inputs.class4Adjustment ?? 0;
  const class4Profits = Math.max(0, profits + adjustment);
  let class4 = 0;

  if (inputs.exemptFromClass4) {
    workings.push('Class 4: exempt, so nothing is charged.');
  } else if (class4Profits <= r.class4LowerProfitsLimit) {
    workings.push(
      `Class 4: profits of ${money0(class4Profits)} do not exceed the Lower Profits Limit of ${money0(r.class4LowerProfitsLimit)}, ` +
      `so nothing is due.`,
    );
  } else {
    const inMainBand = Math.min(class4Profits, r.class4UpperProfitsLimit) - r.class4LowerProfitsLimit;
    const aboveUpper = Math.max(0, class4Profits - r.class4UpperProfitsLimit);
    const main = round2(inMainBand * r.class4MainRate);
    const upper = round2(aboveUpper * r.class4UpperRate);
    class4 = round2(main + upper);

    if (adjustment !== 0) {
      workings.push(
        `Class 4: profits of ${money0(profits)} ${adjustment > 0 ? 'plus' : 'less'} an adjustment of ` +
        `${money0(Math.abs(adjustment))} gives ${money0(class4Profits)} chargeable.`,
      );
    }
    workings.push(
      `Class 4: ${money0(inMainBand)} between ${money0(r.class4LowerProfitsLimit)} and ` +
      `${money0(Math.min(class4Profits, r.class4UpperProfitsLimit))} at ${pc(r.class4MainRate)} = ${money(main)}.`,
    );
    if (aboveUpper > 0) {
      workings.push(
        `Class 4: ${money0(aboveUpper)} above the Upper Profits Limit of ${money0(r.class4UpperProfitsLimit)} ` +
        `at ${pc(r.class4UpperRate)} = ${money(upper)}.`,
      );
    }

    notes.push(
      `Class 4 losses are a SEPARATE pool from income tax losses (NIM24610). Where a trading loss was relieved against ` +
      `income that carries no Class 4 charge, that part of it survives as a Class 4 loss and reduces this figure. ` +
      `The portal does not track the two pools apart yet, so a loss history means checking this by hand.`,
    );
  }

  return {
    class2,
    class4,
    total: round2(class2 + class4),
    class2Credited,
    class4Profits: round2(class4Profits),
    workings,
    notes,
  };
}
