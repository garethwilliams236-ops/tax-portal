/**
 * The rates for a NAMED year.
 *
 * The rates topic used to read the current tax year off the clock, so asking
 * for 2024 got 2026-27 — confidently, and with no hint that the question had
 * been ignored. Everything here takes the year as an argument, and a year the
 * tables do not hold is reported as missing rather than quietly substituted.
 */

import {
  corporationTaxRates, nicRates, incomeTaxRates, pensionRates, selfEmployedNicRates,
  taxYearOf, type TaxYear,
} from '@/lib/tax/rates';

const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const pc = (n: number) => (n * 100).toFixed((n * 100) % 1 ? 2 : 0) + '%';

/**
 * A tax year named in a question. UK tax years span two calendar years, so a
 * bare "2024" is ambiguous — it is read as 2024-25, the year that STARTS in
 * 2024, which is the ordinary usage, and the answer says so.
 */
export function parseTaxYear(q: string): { year: TaxYear; assumed: boolean } | null {
  const s = q.toLowerCase();

  // 2024-25, 2024/25, 2024 to 2025, 2024-2025
  const full = s.match(/\b(20\d{2})\s*(?:[-/]|to)\s*(\d{2}|20\d{2})\b/);
  if (full) {
    const start = Number(full[1]);
    return { year: `${start}-${String((start + 1) % 100).padStart(2, '0')}` as TaxYear, assumed: false };
  }

  // 24/25 or 24-25
  const short = s.match(/\b(\d{2})\s*[-/]\s*(\d{2})\b/);
  if (short && Number(short[2]) === (Number(short[1]) + 1) % 100) {
    const start = 2000 + Number(short[1]);
    return { year: `${start}-${short[2]}` as TaxYear, assumed: false };
  }

  // A bare year.
  const bare = s.match(/\b(20\d{2})\b/);
  if (bare) {
    const start = Number(bare[1]);
    return { year: `${start}-${String((start + 1) % 100).padStart(2, '0')}` as TaxYear, assumed: true };
  }

  return null;
}

export interface RatesSummary {
  year: TaxYear;
  what: string;
  detail: string[];
  /** Which tables have nothing for this year. */
  missing: string[];
}

/** Mid-year, for selecting a corporation tax financial year from a tax year. */
const midYear = (year: TaxYear) => new Date(Date.UTC(Number(year.slice(0, 4)), 5, 1));

export function ratesSummary(year: TaxYear): RatesSummary {
  const missing: string[] = [];

  let y: ReturnType<typeof incomeTaxRates> | null = null;
  let n: ReturnType<typeof nicRates> | null = null;
  let p: ReturnType<typeof pensionRates> | null = null;
  let c: ReturnType<typeof corporationTaxRates> | null = null;
  let se: ReturnType<typeof selfEmployedNicRates> | null = null;

  try { y = incomeTaxRates(year); } catch { missing.push('income tax'); }
  try { n = nicRates(year); } catch { missing.push('National Insurance'); }
  try { p = pensionRates(year); } catch { missing.push('pensions'); }
  try { c = corporationTaxRates(midYear(year)); } catch { missing.push('Corporation Tax'); }
  try { se = selfEmployedNicRates(year); } catch { missing.push('self-employed NIC'); }

  const parts: string[] = [];
  if (y) {
    parts.push(`For ${year}: personal allowance ${money(y.personalAllowance)}, basic rate limit ${money(y.basicRateLimit)} (so the higher rate starts at ${money(y.personalAllowance + y.basicRateLimit)}), additional rate from ${money(y.higherRateLimit)}.`);
  }
  if (c) {
    parts.push(`Corporation Tax ${pc(c.smallProfitsRate)} to ${money(c.lowerLimit)} and ${pc(c.mainRate)} above ${money(c.upperLimit)}.`);
  }
  if (n) {
    parts.push(`Employer NIC ${pc(n.employerRate)} above ${money(n.secondaryThreshold)}; employee ${pc(n.employeeMainRate)} from ${money(n.primaryThreshold)} to ${money(n.upperEarningsLimit)}, then ${pc(n.employeeUpperRate)}.`);
  }
  if (!parts.length) parts.push(`The portal holds no rate tables for ${year}.`);

  const detail: string[] = [];
  if (y) {
    detail.push(`Dividends: ${pc(y.dividend[0]!.rate)} / ${pc(y.dividend[1]!.rate)} / ${pc(y.dividend[2]!.rate)}, with a ${money(y.dividendAllowance)} allowance that is a nil rate band rather than a deduction — it still uses rate band.`);
    detail.push(`Personal savings allowance ${money(y.personalSavingsAllowance.basic)} at basic rate, ${money(y.personalSavingsAllowance.higher)} at higher rate, nil at additional rate. Starting rate for savings ${money(y.startingRateForSavings)}.`);
  }
  if (n) {
    detail.push(`NIC thresholds: LEL ${money(n.lowerEarningsLimit)}, PT ${money(n.primaryThreshold)}, ST ${money(n.secondaryThreshold)}, UEL ${money(n.upperEarningsLimit)}. Employment Allowance ${money(n.employmentAllowance)}.`);
  }
  if (se) {
    const money2 = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    detail.push(`Self-employed: Class 4 ${pc(se.class4MainRate)} from ${money(se.class4LowerProfitsLimit)} to ${money(se.class4UpperProfitsLimit)}, then ${pc(se.class4UpperRate)}. Class 2 is not payable — credited at or above the Small Profits Threshold of ${money(se.smallProfitsThreshold)}, and voluntary below it at ${money2(se.class2WeeklyRate)} a week. Class 3 ${money2(se.class3WeeklyRate)} a week.`);
  }
  if (p) {
    detail.push(`Pensions: annual allowance ${money(p.annualAllowance)}, MPAA ${money(p.moneyPurchaseAnnualAllowance)}, taper from ${money(p.taperAdjustedIncome)} adjusted income with a ${money(p.minimumTaperedAllowance)} floor.`);
  }
  if (y) {
    detail.push(`Other: property and trading allowances ${money(y.propertyAllowance)} each, rent-a-room ${money(y.rentARoom)}, ISA ${money(y.isaAllowance)}, child benefit charge from ${money(y.hicbcLower)} to ${money(y.hicbcUpper)}.`);
  }
  if (missing.length) {
    detail.push(`No ${missing.join(', ')} table for ${year}. Those figures are not stated rather than guessed.`);
  }

  return { year, what: parts.join(' '), detail, missing };
}

/** The summary for whatever year is current. */
export const currentRatesSummary = () => ratesSummary(taxYearOf(new Date()));
