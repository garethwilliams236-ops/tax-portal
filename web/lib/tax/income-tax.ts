/**
 * Personal income tax.
 *
 * Four separate rate sets, because from 6 April 2027 property and savings
 * income each diverge from other non-savings income by 2pp. Building the
 * four-way split now is far cheaper than retrofitting it.
 *
 * Ordering matters: non-savings income is taxed first, then savings, then
 * dividends at the top. The band a slice falls into depends on what sits below.
 */

import { incomeTaxRates, type RateBand, type TaxYear } from './rates.js';

export interface IncomeInputs {
  employment?: number;
  selfEmployment?: number;
  property?: number;
  /** Residential finance costs — relieved as a basic rate reducer, not deducted. */
  propertyFinanceCosts?: number;
  pension?: number;
  savings?: number;
  dividends?: number;
  /** Gross personal pension contributions and Gift Aid reduce adjusted net income. */
  grossPensionContributions?: number;
  giftAidGross?: number;
}

export interface IncomeTaxResult {
  totalIncome: number;
  adjustedNetIncome: number;
  personalAllowance: number;
  personalAllowanceLost: number;
  taxByCategory: {
    nonSavings: number;
    property: number;
    savings: number;
    dividends: number;
  };
  financeCostReducer: number;
  totalTax: number;
  marginalRate: number;
  workings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tax a slice of income sitting on top of `alreadyUsed` of the band structure.
 * Returns tax and the new cumulative total.
 */
function taxSlice(
  amount: number,
  alreadyUsed: number,
  bands: RateBand[],
): { tax: number; used: number; detail: string[] } {
  let remaining = amount;
  let position = alreadyUsed;
  let tax = 0;
  const detail: string[] = [];

  for (const band of bands) {
    if (remaining <= 0) break;
    const ceiling = band.upTo ?? Infinity;
    if (position >= ceiling) continue;
    const room = ceiling - position;
    const inThisBand = Math.min(remaining, room);
    if (inThisBand > 0) {
      tax += inThisBand * band.rate;
      detail.push(`£${round2(inThisBand).toLocaleString()} at ${(band.rate * 100).toFixed(2)}%`);
      position += inThisBand;
      remaining -= inThisBand;
    }
  }

  return { tax: round2(tax), used: position, detail };
}

export function computeIncomeTax(inputs: IncomeInputs, taxYear: TaxYear): IncomeTaxResult {
  const r = incomeTaxRates(taxYear);
  const workings: string[] = [];

  const employment = inputs.employment ?? 0;
  const selfEmployment = inputs.selfEmployment ?? 0;
  const property = inputs.property ?? 0;
  const pension = inputs.pension ?? 0;
  const savings = inputs.savings ?? 0;
  const dividends = inputs.dividends ?? 0;
  const financeCosts = inputs.propertyFinanceCosts ?? 0;

  const otherNonSavings = employment + selfEmployment + pension;
  const totalIncome = otherNonSavings + property + savings + dividends;

  // Adjusted net income drives the PA taper and HICBC. Gross pension
  // contributions and Gift Aid reduce it — which is why they are extraction
  // levers, not just deductions.
  const reliefDeductions = (inputs.grossPensionContributions ?? 0) + (inputs.giftAidGross ?? 0);
  const adjustedNetIncome = Math.max(0, totalIncome - reliefDeductions);

  // Personal allowance taper: £1 lost per £2 above £100,000, gone at £125,140.
  const excess = Math.max(0, adjustedNetIncome - r.paTaperThreshold);
  const allowanceLost = Math.min(r.personalAllowance, excess / r.paTaperDivisor);
  const personalAllowance = round2(r.personalAllowance - allowanceLost);

  if (allowanceLost > 0) {
    workings.push(
      `Personal allowance tapered: adjusted net income £${round2(adjustedNetIncome).toLocaleString()} exceeds ` +
        `£${r.paTaperThreshold.toLocaleString()} by £${round2(excess).toLocaleString()}, so £${round2(allowanceLost).toLocaleString()} ` +
        `of allowance is lost, leaving £${personalAllowance.toLocaleString()}. This creates the 60% effective band.`,
    );
  }

  // Allocate the personal allowance against non-savings income first, then
  // property, then savings, then dividends — the order that minimises tax.
  let allowanceRemaining = personalAllowance;
  const useAllowance = (amount: number): number => {
    const used = Math.min(amount, allowanceRemaining);
    allowanceRemaining -= used;
    return amount - used;
  };

  const taxableNonSavings = useAllowance(otherNonSavings);
  const taxableProperty = useAllowance(property);
  const taxableSavingsGross = useAllowance(savings);
  const taxableDividendsGross = useAllowance(dividends);

  let used = 0;

  const nonSavingsResult = taxSlice(taxableNonSavings, used, r.nonSavings);
  used = nonSavingsResult.used;
  if (taxableNonSavings > 0) {
    workings.push(`Non-savings income: ${nonSavingsResult.detail.join(', ')}.`);
  }

  const propertyResult = taxSlice(taxableProperty, used, r.property);
  used = propertyResult.used;
  if (taxableProperty > 0) {
    workings.push(`Property income: ${propertyResult.detail.join(', ')}.`);
  }

  // Personal savings allowance depends on the band reached.
  const psa =
    used > r.higherRateLimit
      ? r.personalSavingsAllowance.additional
      : used > r.basicRateLimit
        ? r.personalSavingsAllowance.higher
        : r.personalSavingsAllowance.basic;

  // Starting rate for savings: withdrawn £1-for-£1 by non-savings income above
  // the personal allowance, nil once other income reaches £17,570.
  const startingRateRoom = Math.max(
    0,
    r.startingRateForSavings - Math.max(0, taxableNonSavings + taxableProperty),
  );
  const savingsAtZero = Math.min(taxableSavingsGross, startingRateRoom + psa);
  const taxableSavings = Math.max(0, taxableSavingsGross - savingsAtZero);
  used += savingsAtZero;

  const savingsResult = taxSlice(taxableSavings, used, r.savings);
  used = savingsResult.used;
  if (taxableSavingsGross > 0) {
    workings.push(
      `Savings: £${round2(savingsAtZero).toLocaleString()} at 0% (starting rate room ` +
        `£${round2(startingRateRoom).toLocaleString()} plus PSA £${psa.toLocaleString()})` +
        (savingsResult.detail.length ? `, then ${savingsResult.detail.join(', ')}` : '') +
        '.',
    );
  }

  const dividendAllowanceUsed = Math.min(taxableDividendsGross, r.dividendAllowance);
  const taxableDividends = taxableDividendsGross - dividendAllowanceUsed;
  used += dividendAllowanceUsed;

  const dividendResult = taxSlice(taxableDividends, used, r.dividend);
  if (taxableDividendsGross > 0) {
    workings.push(
      `Dividends: £${dividendAllowanceUsed.toLocaleString()} covered by the dividend allowance` +
        (dividendResult.detail.length ? `, then ${dividendResult.detail.join(', ')}` : '') +
        '.',
    );
  }

  // s.24 finance cost restriction: a tax reducer at the BASIC rate on the
  // lowest of finance costs, property profits, and adjusted total income.
  const adjustedTotalIncome = Math.max(0, totalIncome - personalAllowance - savings - dividends);
  const reducerBasis = Math.min(financeCosts, Math.max(0, property), adjustedTotalIncome);
  const financeCostReducer = round2(reducerBasis * r.financeCostReducerRate);
  if (financeCosts > 0) {
    workings.push(
      `Finance cost reducer (s.24): ${(r.financeCostReducerRate * 100).toFixed(0)}% of the lowest of finance costs ` +
        `£${financeCosts.toLocaleString()}, property profits £${round2(property).toLocaleString()} and adjusted total ` +
        `income £${round2(adjustedTotalIncome).toLocaleString()} = £${financeCostReducer.toLocaleString()}. ` +
        `Reduces tax, not income, and cannot create a repayment.`,
    );
  }

  const grossTax =
    nonSavingsResult.tax + propertyResult.tax + savingsResult.tax + dividendResult.tax;
  const totalTax = round2(Math.max(0, grossTax - financeCostReducer));

  // Marginal rate on the next £1 of non-savings income.
  const bump = computeMarginalRate(inputs, taxYear, totalTax);

  return {
    totalIncome: round2(totalIncome),
    adjustedNetIncome: round2(adjustedNetIncome),
    personalAllowance,
    personalAllowanceLost: round2(allowanceLost),
    taxByCategory: {
      nonSavings: nonSavingsResult.tax,
      property: propertyResult.tax,
      savings: savingsResult.tax,
      dividends: dividendResult.tax,
    },
    financeCostReducer,
    totalTax,
    marginalRate: bump,
    workings,
  };
}

/** Effective marginal rate on the next £100 of employment income. */
function computeMarginalRate(
  inputs: IncomeInputs,
  taxYear: TaxYear,
  baseTax: number,
): number {
  const step = 100;
  const bumped: IncomeInputs = { ...inputs, employment: (inputs.employment ?? 0) + step };
  const r = incomeTaxRates(taxYear);

  // Recompute without recursion by inlining a minimal version.
  const result = computeIncomeTaxNoMarginal(bumped, r);
  return Math.round(((result - baseTax) / step) * 10000) / 10000;
}

function computeIncomeTaxNoMarginal(
  inputs: IncomeInputs,
  r: ReturnType<typeof incomeTaxRates>,
): number {
  const otherNonSavings =
    (inputs.employment ?? 0) + (inputs.selfEmployment ?? 0) + (inputs.pension ?? 0);
  const property = inputs.property ?? 0;
  const savings = inputs.savings ?? 0;
  const dividends = inputs.dividends ?? 0;
  const totalIncome = otherNonSavings + property + savings + dividends;
  const reliefDeductions = (inputs.grossPensionContributions ?? 0) + (inputs.giftAidGross ?? 0);
  const ani = Math.max(0, totalIncome - reliefDeductions);
  const excess = Math.max(0, ani - r.paTaperThreshold);
  const pa = Math.max(0, r.personalAllowance - Math.min(r.personalAllowance, excess / r.paTaperDivisor));

  let allowanceRemaining = pa;
  const useAllowance = (amount: number): number => {
    const u = Math.min(amount, allowanceRemaining);
    allowanceRemaining -= u;
    return amount - u;
  };

  const tNon = useAllowance(otherNonSavings);
  const tProp = useAllowance(property);
  const tSav = useAllowance(savings);
  const tDiv = useAllowance(dividends);

  let used = 0;
  const a = taxSlice(tNon, used, r.nonSavings);
  used = a.used;
  const b = taxSlice(tProp, used, r.property);
  used = b.used;

  const psa =
    used > r.higherRateLimit
      ? r.personalSavingsAllowance.additional
      : used > r.basicRateLimit
        ? r.personalSavingsAllowance.higher
        : r.personalSavingsAllowance.basic;
  const startingRoom = Math.max(0, r.startingRateForSavings - Math.max(0, tNon + tProp));
  const savAtZero = Math.min(tSav, startingRoom + psa);
  used += savAtZero;
  const c = taxSlice(Math.max(0, tSav - savAtZero), used, r.savings);
  used = c.used;

  const divAllow = Math.min(tDiv, r.dividendAllowance);
  used += divAllow;
  const d = taxSlice(tDiv - divAllow, used, r.dividend);

  const financeCosts = inputs.propertyFinanceCosts ?? 0;
  const adjustedTotalIncome = Math.max(0, totalIncome - pa - savings - dividends);
  const reducer =
    Math.min(financeCosts, Math.max(0, property), adjustedTotalIncome) * r.financeCostReducerRate;

  return round2(Math.max(0, a.tax + b.tax + c.tax + d.tax - reducer));
}

/** High Income Child Benefit Charge: 1% of child benefit per £200 over £60,000. */
export function computeHicbc(
  adjustedNetIncome: number,
  childBenefitReceived: number,
  taxYear: TaxYear,
): { charge: number; percentage: number } {
  const r = incomeTaxRates(taxYear);
  if (adjustedNetIncome <= r.hicbcLower) return { charge: 0, percentage: 0 };
  const pct = Math.min(
    1,
    Math.floor((adjustedNetIncome - r.hicbcLower) / 200) / 100,
  );
  return { charge: round2(childBenefitReceived * pct), percentage: pct };
}
