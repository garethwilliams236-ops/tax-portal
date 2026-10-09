/**
 * US federal individual rates, by calendar tax year.
 *
 * Verified 9 October 2026 against the primary sources:
 *   2025 — Rev. Proc. 2024-40 ss.2.01, 2.03, 2.39; standard deduction as
 *          amended by P.L. 119-21 (the 2025 reconciliation act), per IRS
 *          "New and enhanced deductions for individuals".
 *   2026 — Rev. Proc. 2025-32 ss.4.01, 4.03, 4.05, 4.39, and the IRS release
 *          of the 2026 adjustments.
 *   NIIT — IRC s.1411(b); IRS Topic 559. Fixed in statute, not indexed.
 *   Form 8938 — IRS "Do I need to file Form 8938", taxpayers living abroad.
 *   FBAR — 31 CFR 1010.306(c): aggregate over $10,000 at any time.
 *
 * Brackets are stored as the UPPER bound of each band; the published base
 * amounts ("$17,966 plus 24% of the excess...") are not stored, because they
 * follow from the bounds. The tests recompute them and compare against the
 * figures printed in the Rev. Procs., which is the check that a bound was
 * copied correctly.
 *
 * A year not in this table is not substituted. `usRates` throws, and the
 * screen says the year is not held.
 */

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
};

export const BRACKET_RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37] as const;

export interface UsYearRates {
  year: number;
  /** Upper bound of the 10%..35% bands; the 37% band is unbounded. Six numbers. */
  brackets: Record<FilingStatus, readonly number[]>;
  standardDeduction: Record<FilingStatus, number>;
  /** s.1(h): top of the 0% band and of the 15% band for qualified dividends and LTCG. */
  cgZeroMax: Record<FilingStatus, number>;
  cgFifteenMax: Record<FilingStatus, number>;
  /** s.911(b)(2)(D)(i). */
  feie: number;
  /** s.24 maximum per qualifying child. Recorded, not yet applied by the engine. */
  childTaxCredit: number;
  source: string;
  verifiedOn: string;
}

export const NIIT_RATE = 0.038;
/** s.1411(b). Statutory and not indexed. */
export const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  mfj: 250_000, mfs: 125_000, single: 200_000, hoh: 200_000,
};

/** s.1211(b): net capital loss deductible against other income. */
export const CAPITAL_LOSS_LIMIT: Record<FilingStatus, number> = {
  mfj: 3_000, single: 3_000, hoh: 3_000, mfs: 1_500,
};

export const FBAR_THRESHOLD = 10_000;

/** Form 8938, for a taxpayer whose tax home is abroad. */
export const FORM_8938_ABROAD: Record<FilingStatus, { yearEnd: number; anyTime: number }> = {
  single: { yearEnd: 200_000, anyTime: 300_000 },
  mfs: { yearEnd: 200_000, anyTime: 300_000 },
  hoh: { yearEnd: 200_000, anyTime: 300_000 },
  mfj: { yearEnd: 400_000, anyTime: 600_000 },
};

const US_RATES: UsYearRates[] = [
  {
    year: 2025,
    brackets: {
      single: [11_925, 48_475, 103_350, 197_300, 250_525, 626_350],
      mfj: [23_850, 96_950, 206_700, 394_600, 501_050, 751_600],
      mfs: [11_925, 48_475, 103_350, 197_300, 250_525, 375_800],
      hoh: [17_000, 64_850, 103_350, 197_300, 250_500, 626_350],
    },
    standardDeduction: { single: 15_750, mfs: 15_750, mfj: 31_500, hoh: 23_625 },
    cgZeroMax: { mfj: 96_700, mfs: 48_350, hoh: 64_750, single: 48_350 },
    cgFifteenMax: { mfj: 600_050, mfs: 300_000, hoh: 566_700, single: 533_400 },
    feie: 130_000,
    childTaxCredit: 2_200,
    source: 'Rev. Proc. 2024-40; standard deduction per P.L. 119-21',
    verifiedOn: '2026-10-09',
  },
  {
    year: 2026,
    brackets: {
      single: [12_400, 50_400, 105_700, 201_775, 256_225, 640_600],
      mfj: [24_800, 100_800, 211_400, 403_550, 512_450, 768_700],
      mfs: [12_400, 50_400, 105_700, 201_775, 256_225, 384_350],
      hoh: [17_700, 67_450, 105_700, 201_750, 256_200, 640_600],
    },
    standardDeduction: { single: 16_100, mfs: 16_100, mfj: 32_200, hoh: 24_150 },
    cgZeroMax: { mfj: 98_900, mfs: 49_450, hoh: 66_200, single: 49_450 },
    cgFifteenMax: { mfj: 613_700, mfs: 306_850, hoh: 579_600, single: 545_500 },
    feie: 132_900,
    childTaxCredit: 2_200,
    source: 'Rev. Proc. 2025-32',
    verifiedOn: '2026-10-09',
  },
];

export const US_YEARS_HELD = US_RATES.map((r) => r.year);

export function usRates(year: number): UsYearRates {
  const r = US_RATES.find((x) => x.year === year);
  if (!r) throw new Error(`US rates for ${year} are not held (held: ${US_YEARS_HELD.join(', ')})`);
  return r;
}

/** Ordinary-rate tax on an amount of taxable income: the s.1(j) table. */
export function ordinaryTax(income: number, status: FilingStatus, year: number): number {
  if (income <= 0) return 0;
  const bounds = usRates(year).brackets[status];
  let tax = 0;
  let lower = 0;
  for (let i = 0; i < BRACKET_RATES.length; i++) {
    const upper = bounds[i] ?? Infinity;
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * (BRACKET_RATES[i] ?? 0);
    lower = upper;
  }
  return tax;
}
