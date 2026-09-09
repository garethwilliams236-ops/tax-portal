/**
 * Dated rate tables.
 *
 * Every rate, threshold and fraction lives here as a dated row, never as a constant
 * scattered through calculation code. In production these move to the `tax_rates`
 * table in Postgres; this module is the seed and the shape.
 *
 * Rule: calculations select by DATE (disposal date, period end, payment date),
 * never by "current year". Several 2026 changes are retrospective traps if you
 * assume the current year's rates apply to an older event.
 *
 * All figures verified against GOV.UK and HMRC manuals as at 31 August 2026.
 */

export type TaxYear = `${number}-${number}`; // '2026-27'

/** UK tax year containing a date. 6 April to 5 April. */
export function taxYearOf(date: Date): TaxYear {
  const y = date.getUTCFullYear();
  const startOfTaxYear = Date.UTC(y, 3, 6); // 6 April
  const first = date.getTime() >= startOfTaxYear ? y : y - 1;
  const second = (first + 1) % 100;
  return `${first}-${String(second).padStart(2, '0')}` as TaxYear;
}

/** UK financial year (corporation tax) containing a date. 1 April to 31 March. */
export function financialYearOf(date: Date): number {
  const y = date.getUTCFullYear();
  return date.getTime() >= Date.UTC(y, 3, 1) ? y : y - 1;
}

// ---------------------------------------------------------------------------
// Corporation tax — by financial year (CTM03910)
// ---------------------------------------------------------------------------

export interface CorporationTaxRates {
  financialYear: number;
  smallProfitsRate: number;
  mainRate: number;
  lowerLimit: number;
  upperLimit: number;
  /** Standard marginal relief fraction. 3/200 from FY2023. */
  marginalReliefFraction: number;
  /** Quarterly instalment payment threshold, before division by associates. */
  qipThreshold: number;
  /** "Very large" instalment threshold, before division by associates. */
  veryLargeThreshold: number;
}

const CORPORATION_TAX: CorporationTaxRates[] = [
  {
    financialYear: 2023,
    smallProfitsRate: 0.19,
    mainRate: 0.25,
    lowerLimit: 50_000,
    upperLimit: 250_000,
    marginalReliefFraction: 3 / 200,
    qipThreshold: 1_500_000,
    veryLargeThreshold: 20_000_000,
  },
];

export function corporationTaxRates(atDate: Date): CorporationTaxRates {
  const fy = financialYearOf(atDate);
  const applicable = CORPORATION_TAX.filter((r) => r.financialYear <= fy).sort(
    (a, b) => b.financialYear - a.financialYear,
  );
  const found = applicable[0];
  if (!found) throw new Error(`No corporation tax rates defined for FY${fy}`);
  return found;
}

// ---------------------------------------------------------------------------
// Income tax and NIC — by tax year
// ---------------------------------------------------------------------------

export interface RateBand {
  /** Upper bound of this band measured in TAXABLE income (after allowances). */
  upTo: number | null;
  rate: number;
}

export interface IncomeTaxRates {
  taxYear: TaxYear;
  personalAllowance: number;
  /** Adjusted net income at which the personal allowance starts to taper. */
  paTaperThreshold: number;
  /** £1 of allowance lost per £N of income above the threshold. */
  paTaperDivisor: number;
  basicRateLimit: number;
  higherRateLimit: number;
  /**
   * Four separate rate sets. From 6 April 2027 property and savings income
   * diverge from other non-savings income (+2pp), so this is four-way from the
   * start rather than one table with a dividend annex.
   */
  nonSavings: RateBand[];
  property: RateBand[];
  savings: RateBand[];
  dividend: RateBand[];
  dividendAllowance: number;
  personalSavingsAllowance: { basic: number; higher: number; additional: number };
  startingRateForSavings: number;
  /** Finance cost restriction (s.24) tax reducer rate. */
  financeCostReducerRate: number;
  propertyAllowance: number;
  tradingAllowance: number;
  rentARoom: number;
  isaAllowance: number;
  hicbcLower: number;
  hicbcUpper: number;
}

const BANDS_20_40_45: RateBand[] = [
  { upTo: 37_700, rate: 0.2 },
  { upTo: 125_140, rate: 0.4 },
  { upTo: null, rate: 0.45 },
];

const BANDS_22_42_47: RateBand[] = [
  { upTo: 37_700, rate: 0.22 },
  { upTo: 125_140, rate: 0.42 },
  { upTo: null, rate: 0.47 },
];

/** Dividend rates as they stood before the 2pp rise on 6 April 2026. */
const DIVIDEND_PRE_2026: RateBand[] = [
  { upTo: 37_700, rate: 0.0875 },
  { upTo: 125_140, rate: 0.3375 },
  { upTo: null, rate: 0.3935 },
];

const INCOME_TAX: IncomeTaxRates[] = [
  {
    // Verified 9 September 2026 against GOV.UK "Income Tax rates and
    // allowances: current and past". Every income tax figure is identical in
    // 2024-25 and 2025-26 — the thresholds are frozen.
    taxYear: '2024-25',
    personalAllowance: 12_570,
    paTaperThreshold: 100_000,
    paTaperDivisor: 2,
    basicRateLimit: 37_700,
    higherRateLimit: 125_140,
    nonSavings: BANDS_20_40_45,
    property: BANDS_20_40_45,
    savings: BANDS_20_40_45,
    dividend: DIVIDEND_PRE_2026,
    dividendAllowance: 500,
    personalSavingsAllowance: { basic: 1_000, higher: 500, additional: 0 },
    startingRateForSavings: 5_000,
    financeCostReducerRate: 0.2,
    propertyAllowance: 1_000,
    tradingAllowance: 1_000,
    rentARoom: 7_500,
    isaAllowance: 20_000,
    // The £60,000/£80,000 thresholds and the 1%-per-£200 taper apply FROM
    // 2024-25. Earlier years were £50,000/£60,000 at 1% per £100.
    hicbcLower: 60_000,
    hicbcUpper: 80_000,
  },
  {
    taxYear: '2025-26',
    personalAllowance: 12_570,
    paTaperThreshold: 100_000,
    paTaperDivisor: 2,
    basicRateLimit: 37_700,
    higherRateLimit: 125_140,
    nonSavings: BANDS_20_40_45,
    property: BANDS_20_40_45,
    savings: BANDS_20_40_45,
    dividend: DIVIDEND_PRE_2026,
    dividendAllowance: 500,
    personalSavingsAllowance: { basic: 1_000, higher: 500, additional: 0 },
    startingRateForSavings: 5_000,
    financeCostReducerRate: 0.2,
    propertyAllowance: 1_000,
    tradingAllowance: 1_000,
    rentARoom: 7_500,
    isaAllowance: 20_000,
    hicbcLower: 60_000,
    hicbcUpper: 80_000,
  },
  {
    taxYear: '2026-27',
    personalAllowance: 12_570,
    paTaperThreshold: 100_000,
    paTaperDivisor: 2,
    basicRateLimit: 37_700,
    higherRateLimit: 125_140,
    nonSavings: BANDS_20_40_45,
    property: BANDS_20_40_45,
    savings: BANDS_20_40_45,
    // Dividend ordinary and upper rates rose 2pp on 6 April 2026.
    dividend: [
      { upTo: 37_700, rate: 0.1075 },
      { upTo: 125_140, rate: 0.3575 },
      { upTo: null, rate: 0.3935 },
    ],
    dividendAllowance: 500,
    personalSavingsAllowance: { basic: 1_000, higher: 500, additional: 0 },
    startingRateForSavings: 5_000,
    financeCostReducerRate: 0.2,
    propertyAllowance: 1_000,
    tradingAllowance: 1_000,
    rentARoom: 7_500,
    isaAllowance: 20_000,
    hicbcLower: 60_000,
    hicbcUpper: 80_000,
  },
  {
    // Announced: property and savings income +2pp from 6 April 2027.
    // Thresholds remain frozen to 5 April 2031.
    taxYear: '2027-28',
    personalAllowance: 12_570,
    paTaperThreshold: 100_000,
    paTaperDivisor: 2,
    basicRateLimit: 37_700,
    higherRateLimit: 125_140,
    nonSavings: BANDS_20_40_45,
    property: BANDS_22_42_47,
    savings: BANDS_22_42_47,
    dividend: [
      { upTo: 37_700, rate: 0.1075 },
      { upTo: 125_140, rate: 0.3575 },
      { upTo: null, rate: 0.3935 },
    ],
    dividendAllowance: 500,
    personalSavingsAllowance: { basic: 1_000, higher: 500, additional: 0 },
    startingRateForSavings: 5_000,
    // NOTE: the s.24 reducer stays at the BASIC rate (20%) even as property
    // income moves to 22/42/47. The gap is deliberate, not a bug.
    financeCostReducerRate: 0.2,
    propertyAllowance: 1_000,
    tradingAllowance: 1_000,
    rentARoom: 7_500,
    isaAllowance: 20_000,
    hicbcLower: 60_000,
    hicbcUpper: 80_000,
  },
];

export function incomeTaxRates(taxYear: TaxYear): IncomeTaxRates {
  const found = INCOME_TAX.find((r) => r.taxYear === taxYear);
  if (!found) throw new Error(`No income tax rates defined for ${taxYear}`);
  return found;
}

// ---------------------------------------------------------------------------
// National Insurance and Employment Allowance
// ---------------------------------------------------------------------------

export interface NicRates {
  taxYear: TaxYear;
  lowerEarningsLimit: number;
  primaryThreshold: number;
  secondaryThreshold: number;
  upperEarningsLimit: number;
  employeeMainRate: number;
  employeeUpperRate: number;
  employerRate: number;
  employmentAllowance: number;
  apprenticeshipLevyRate: number;
  apprenticeshipLevyAllowance: number;
  apprenticeshipLevyPayBillThreshold: number;
}

/**
 * Annual NIC thresholds are the figures HMRC PUBLISHES, not 52 times the
 * weekly ones. The two agree for the LEL and disagree for the PT and the UEL,
 * which are aligned to the income tax personal allowance and higher rate
 * threshold instead. Directors' annual-basis calculations use the published
 * annual figures (CA44), which is what this table holds.
 *
 * Verified 9 September 2026 against GOV.UK "Rates and thresholds for
 * employers" for each year.
 */
const NIC: NicRates[] = [
  {
    taxYear: '2024-25',
    lowerEarningsLimit: 6_396,
    primaryThreshold: 12_570,
    secondaryThreshold: 9_100,
    upperEarningsLimit: 50_270,
    employeeMainRate: 0.08,
    employeeUpperRate: 0.02,
    employerRate: 0.138,
    employmentAllowance: 5_000,
    apprenticeshipLevyRate: 0.005,
    apprenticeshipLevyAllowance: 15_000,
    apprenticeshipLevyPayBillThreshold: 3_000_000,
  },
  {
    // Two changes on 6 April 2025 that are easy to get wrong: the secondary
    // rate rose from 13.8% to 15%, and the secondary threshold was CUT from
    // £9,100 to £5,000 — a cut, not an uprating. The Employment Allowance
    // more than doubled alongside them, and the £100,000 prior-year
    // eligibility cap was removed.
    taxYear: '2025-26',
    lowerEarningsLimit: 6_500,
    primaryThreshold: 12_570,
    secondaryThreshold: 5_000,
    upperEarningsLimit: 50_270,
    employeeMainRate: 0.08,
    employeeUpperRate: 0.02,
    employerRate: 0.15,
    employmentAllowance: 10_500,
    apprenticeshipLevyRate: 0.005,
    apprenticeshipLevyAllowance: 15_000,
    apprenticeshipLevyPayBillThreshold: 3_000_000,
  },
  {
    taxYear: '2026-27',
    lowerEarningsLimit: 6_708,
    primaryThreshold: 12_570,
    secondaryThreshold: 5_000,
    upperEarningsLimit: 50_270,
    employeeMainRate: 0.08,
    employeeUpperRate: 0.02,
    employerRate: 0.15,
    employmentAllowance: 10_500,
    apprenticeshipLevyRate: 0.005,
    apprenticeshipLevyAllowance: 15_000,
    apprenticeshipLevyPayBillThreshold: 3_000_000,
  },
];

export function nicRates(taxYear: TaxYear): NicRates {
  const found = NIC.find((r) => r.taxYear === taxYear);
  if (!found) throw new Error(`No NIC rates defined for ${taxYear}`);
  return found;
}

// ---------------------------------------------------------------------------
// Capital gains tax — selected by DISPOSAL DATE, not current year
// ---------------------------------------------------------------------------

export interface CgtRates {
  /** Rates apply to disposals on or after this date. */
  from: Date;
  basicRate: number;
  higherRate: number;
  /** Residential converged with other assets on 30 October 2024. */
  residentialBasicRate: number;
  residentialHigherRate: number;
  annualExemptAmount: number;
  badrRate: number;
  badrLifetimeLimit: number;
}

const CGT: CgtRates[] = [
  {
    from: new Date(Date.UTC(2024, 9, 30)), // 30 October 2024
    basicRate: 0.18,
    higherRate: 0.24,
    residentialBasicRate: 0.18,
    residentialHigherRate: 0.24,
    annualExemptAmount: 3_000,
    badrRate: 0.1,
    badrLifetimeLimit: 1_000_000,
  },
  {
    from: new Date(Date.UTC(2025, 3, 6)), // 6 April 2025
    basicRate: 0.18,
    higherRate: 0.24,
    residentialBasicRate: 0.18,
    residentialHigherRate: 0.24,
    annualExemptAmount: 3_000,
    badrRate: 0.14,
    badrLifetimeLimit: 1_000_000,
  },
  {
    from: new Date(Date.UTC(2026, 3, 6)), // 6 April 2026
    basicRate: 0.18,
    higherRate: 0.24,
    residentialBasicRate: 0.18,
    residentialHigherRate: 0.24,
    annualExemptAmount: 3_000,
    badrRate: 0.18,
    badrLifetimeLimit: 1_000_000,
  },
];

export function cgtRates(disposalDate: Date): CgtRates {
  const applicable = CGT.filter((r) => disposalDate >= r.from).sort(
    (a, b) => b.from.getTime() - a.from.getTime(),
  );
  const found = applicable[0];
  if (!found) throw new Error(`No CGT rates defined for ${disposalDate.toISOString()}`);
  return found;
}

// ---------------------------------------------------------------------------
// Pensions
// ---------------------------------------------------------------------------

export interface PensionRates {
  taxYear: TaxYear;
  annualAllowance: number;
  moneyPurchaseAnnualAllowance: number;
  /** The defined-benefit accrual allowance once the MPAA has been triggered. */
  alternativeAnnualAllowance: number;
  taperThresholdIncome: number;
  taperAdjustedIncome: number;
  minimumTaperedAllowance: number;
  lumpSumAllowance: number;
  lumpSumAndDeathBenefitAllowance: number;
  carryForwardYears: number;
}

/**
 * Unchanged across 2024-25 to 2026-27. 2024-25 is the first year of the lump
 * sum allowance regime — the lifetime allowance went on 6 April 2024.
 * Verified 9 September 2026 against GOV.UK "Pension schemes rates".
 */
const PENSIONS: PensionRates[] = [
  {
    taxYear: '2024-25',
    annualAllowance: 60_000,
    moneyPurchaseAnnualAllowance: 10_000,
    alternativeAnnualAllowance: 50_000,
    taperThresholdIncome: 200_000,
    taperAdjustedIncome: 260_000,
    minimumTaperedAllowance: 10_000,
    lumpSumAllowance: 268_275,
    lumpSumAndDeathBenefitAllowance: 1_073_100,
    carryForwardYears: 3,
  },
  {
    taxYear: '2025-26',
    annualAllowance: 60_000,
    moneyPurchaseAnnualAllowance: 10_000,
    alternativeAnnualAllowance: 50_000,
    taperThresholdIncome: 200_000,
    taperAdjustedIncome: 260_000,
    minimumTaperedAllowance: 10_000,
    lumpSumAllowance: 268_275,
    lumpSumAndDeathBenefitAllowance: 1_073_100,
    carryForwardYears: 3,
  },
  {
    taxYear: '2026-27',
    annualAllowance: 60_000,
    moneyPurchaseAnnualAllowance: 10_000,
    alternativeAnnualAllowance: 50_000,
    taperThresholdIncome: 200_000,
    taperAdjustedIncome: 260_000,
    minimumTaperedAllowance: 10_000,
    lumpSumAllowance: 268_275,
    lumpSumAndDeathBenefitAllowance: 1_073_100,
    carryForwardYears: 3,
  },
];

/**
 * Which years the tables actually hold, per tax. A screen or an answer that
 * needs to say "the portal does not have that year" should ask here rather
 * than guessing at a range.
 */
export function yearsCovered(): { incomeTax: TaxYear[]; nic: TaxYear[]; pensions: TaxYear[] } {
  return {
    incomeTax: INCOME_TAX.map((r) => r.taxYear),
    nic: NIC.map((r) => r.taxYear),
    pensions: PENSIONS.map((r) => r.taxYear),
  };
}

export function pensionRates(taxYear: TaxYear): PensionRates {
  const found = PENSIONS.find((r) => r.taxYear === taxYear);
  if (!found) throw new Error(`No pension rates defined for ${taxYear}`);
  return found;
}

// ---------------------------------------------------------------------------
// Inheritance tax
// ---------------------------------------------------------------------------

export interface IhtRates {
  from: Date;
  nilRateBand: number;
  residenceNilRateBand: number;
  /** RNRB tapers £1 for every £2 of estate above this. */
  rnrbTaperThreshold: number;
  rnrbTaperDivisor: number;
  deathRate: number;
  /** Reduced rate where 10%+ of the baseline amount passes to charity. */
  charityReducedRate: number;
  charityReducedRateThreshold: number;
  annualExemption: number;
  smallGiftsExemption: number;
  weddingGiftChild: number;
  weddingGiftGrandchild: number;
  weddingGiftOther: number;
  /**
   * Combined APR/BPR allowance for 100% relief from 6 April 2026.
   *
   * ⚠️ UNVERIFIED AGAINST STATUTE — see PLACEHOLDERS.md item P-01.
   * GOV.UK is internally inconsistent: two policy papers say £1,000,000 and
   * non-transferable; HMRC manual IHTM25520 and the current changes page say
   * £2,500,000 and transferable. Read Finance Act 2026 Sch 12 and correct this
   * row before the estate module is relied on. It is a data change, not a code
   * change, precisely so this is cheap to fix.
   */
  aprBprAllowance: number;
  aprBprAllowanceTransferable: boolean;
  aprBprReliefAboveAllowance: number;
  /** AIM / unlisted-but-traded shares: 50% relief, no allowance. */
  aimSharesRelief: number;
}

const IHT: IhtRates[] = [
  {
    from: new Date(Date.UTC(2026, 3, 6)), // 6 April 2026
    nilRateBand: 325_000,
    residenceNilRateBand: 175_000,
    rnrbTaperThreshold: 2_000_000,
    rnrbTaperDivisor: 2,
    deathRate: 0.4,
    charityReducedRate: 0.36,
    charityReducedRateThreshold: 0.1,
    annualExemption: 3_000,
    smallGiftsExemption: 250,
    weddingGiftChild: 5_000,
    weddingGiftGrandchild: 2_500,
    weddingGiftOther: 1_000,
    aprBprAllowance: 2_500_000, // see warning above
    aprBprAllowanceTransferable: true, // see warning above
    aprBprReliefAboveAllowance: 0.5,
    aimSharesRelief: 0.5,
  },
];

export function ihtRates(atDate: Date): IhtRates {
  const applicable = IHT.filter((r) => atDate >= r.from).sort(
    (a, b) => b.from.getTime() - a.from.getTime(),
  );
  const found = applicable[0];
  if (!found) throw new Error(`No IHT rates defined for ${atDate.toISOString()}`);
  return found;
}

/**
 * Taper relief bands. Reduces the TAX on a failed PET, never the value of the
 * gift, and only where the gift bears tax in its own right after cumulation.
 */
export const TAPER_RELIEF_BANDS: { yearsFrom: number; yearsTo: number; reduction: number }[] = [
  { yearsFrom: 0, yearsTo: 3, reduction: 0 },
  { yearsFrom: 3, yearsTo: 4, reduction: 0.2 },
  { yearsFrom: 4, yearsTo: 5, reduction: 0.4 },
  { yearsFrom: 5, yearsTo: 6, reduction: 0.6 },
  { yearsFrom: 6, yearsTo: 7, reduction: 0.8 },
];
