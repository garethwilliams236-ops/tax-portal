import { describe, expect, it } from 'vitest';
import { ordinaryTax, usRates, US_YEARS_HELD, type FilingStatus } from '../rates';
import { computeUs, taxWithPreferential, ZERO_INPUTS, type UsInputs } from '../form1040';
import { nextBusinessDay, usDeadlines, usObligations } from '../deadlines';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const base = (over: Partial<UsInputs>): UsInputs => ({ ...ZERO_INPUTS, year: 2026, status: 'single', ...over });

/**
 * The Rev. Procs. print a base amount at the start of every band ("$17,966
 * plus 24% of the excess over $105,700"). The table stores only the bounds,
 * so recomputing the base at each bound and matching the printed figure is
 * the check that every bound was copied correctly.
 */
describe('rate tables reproduce the printed base amounts', () => {
  const cases: [number, FilingStatus, number, number][] = [
    // Rev. Proc. 2025-32 s.4.01
    [2026, 'single', 105_700, 17_966], [2026, 'single', 201_775, 41_024],
    [2026, 'single', 256_225, 58_448], [2026, 'single', 640_600, 192_979.25],
    [2026, 'mfs', 384_350, 103_291.75],
    [2026, 'hoh', 17_700, 1_770], [2026, 'hoh', 67_450, 7_740], [2026, 'hoh', 105_700, 16_155],
    [2026, 'hoh', 201_750, 39_207], [2026, 'hoh', 256_200, 56_631], [2026, 'hoh', 640_600, 191_171],
    // Rev. Proc. 2024-40 s.2.01
    [2025, 'mfj', 23_850, 2_385], [2025, 'mfj', 96_950, 11_157], [2025, 'mfj', 206_700, 35_302],
    [2025, 'mfj', 394_600, 80_398], [2025, 'mfj', 501_050, 114_462], [2025, 'mfj', 751_600, 202_154.50],
    [2025, 'hoh', 17_000, 1_700], [2025, 'hoh', 64_850, 7_442], [2025, 'hoh', 103_350, 15_912],
    [2025, 'hoh', 197_300, 38_460], [2025, 'hoh', 250_500, 55_484], [2025, 'hoh', 626_350, 187_031.50],
    [2025, 'single', 11_925, 1_192.50], [2025, 'single', 48_475, 5_578.50], [2025, 'single', 103_350, 17_651],
    [2025, 'single', 197_300, 40_199], [2025, 'single', 250_525, 57_231], [2025, 'single', 626_350, 188_769.75],
    [2025, 'mfs', 375_800, 101_077.25],
  ];
  it.each(cases)('%i %s at %i is %d', (year, status, at, printed) => {
    expect(ordinaryTax(at, status, year)).toBeCloseTo(printed, 2);
  });

  it('MFJ bounds are double the single bounds below the 35% band in 2026', () => {
    const r = usRates(2026);
    r.brackets.single.slice(0, 5).forEach((b, i) => expect(r.brackets.mfj[i]).toBe(b * 2));
  });

  it('refuses a year it does not hold rather than substituting one', () => {
    expect(US_YEARS_HELD).toEqual([2025, 2026]);
    expect(() => usRates(2024)).toThrow(/not held/);
  });
});

describe('qualified dividends and capital gains', () => {
  it('taxes gains inside the 0% band at nothing', () => {
    expect(taxWithPreferential(40_000, 40_000, 'single', 2026)).toBe(0);
  });
  it('stacks gains on top of ordinary income', () => {
    // 40,000 ordinary → 4,552; 9,450 of gain at 0%; 10,550 at 15% = 1,582.50
    expect(taxWithPreferential(60_000, 20_000, 'single', 2026)).toBeCloseTo(6_134.50, 2);
  });
  it('never exceeds tax at ordinary rates', () => {
    expect(taxWithPreferential(30_000, 0, 'single', 2026)).toBeCloseTo(ordinaryTax(30_000, 'single', 2026), 2);
  });
});

describe('the exclusion stacks rather than buying the top of the table', () => {
  const r = computeUs(base({ foreignEarned: 150_000, feieClaimed: true, qualifyingDays: 365 }));
  it('excludes up to the year limit', () => {
    expect(r.exclusion).toBe(132_900);
    expect(r.agi).toBe(17_100);
    expect(r.taxable).toBe(1_000);
  });
  it('taxes the remaining 1,000 at 24%, not at 10%', () => {
    expect(r.incomeTax).toBeCloseTo(240, 2);
  });
  it('pro-rates the limit for a part year', () => {
    const p = computeUs(base({ foreignEarned: 150_000, feieClaimed: true, qualifyingDays: 73 }));
    expect(p.exclusionLimit).toBeCloseTo(132_900 * 73 / 365, 2);
  });
  it('excludes nothing when the claim has no qualifying days, and says so', () => {
    const z = computeUs(base({ foreignEarned: 50_000, feieClaimed: true, qualifyingDays: 0 }));
    expect(z.exclusion).toBe(0);
    expect(z.warnings.join(' ')).toMatch(/no qualifying days/);
  });
});

describe('foreign tax credit', () => {
  it('disallows UK tax on the excluded slice and limits the rest', () => {
    const r = computeUs(base({ foreignEarned: 150_000, feieClaimed: true, qualifyingDays: 365, ukTaxEarnings: 45_000 }));
    const g = r.baskets.find((b) => b.name === 'general')!;
    expect(g.disallowed).toBeCloseTo(45_000 * 132_900 / 150_000, 2);
    expect(g.limitation).toBeCloseTo(240, 2);
    expect(g.credit).toBeCloseTo(240, 2);
    expect(r.totalTax).toBeCloseTo(0, 2);
  });

  it('wipes out US tax on UK salary where UK tax is higher, without the exclusion', () => {
    const r = computeUs(base({ foreignEarned: 100_000, ukTaxEarnings: 30_000 }));
    expect(r.incomeTax).toBeGreaterThan(0);
    expect(r.ftc).toBeCloseTo(r.incomeTax, 2);
    expect(r.baskets[0]!.excess).toBeGreaterThan(0);
  });

  it('keeps UK tax on a pension creditable when earnings are excluded', () => {
    // The reviewer's example: earnings fully excluded, pension 60,000, UK tax on it 12,000.
    const r = computeUs(base({
      foreignEarned: 100_000, feieClaimed: true, qualifyingDays: 365,
      pensions: 60_000, ukTaxEarnings: 20_000, ukTaxGeneral: 12_000,
    }));
    const g = r.baskets.find((b) => b.name === 'general')!;
    expect(g.disallowed).toBeCloseTo(20_000, 2);
    expect(g.creditable).toBeCloseTo(12_000, 2);
    expect(r.totalTax).toBeCloseTo(0, 2);
  });

  it('moves passive income taxed above 37% into the general basket', () => {
    const r = computeUs(base({ interest: 50_000, ukTaxPassive: 20_000 }));
    expect(r.baskets.find((b) => b.name === 'general')!.highTaxed).toBe(true);
    expect(r.baskets.find((b) => b.name === 'passive')!.foreignGross).toBe(0);
  });

  it('leaves passive income taxed at 20% in passive', () => {
    const r = computeUs(base({ interest: 50_000, ukTaxPassive: 6_000 }));
    expect(r.baskets.find((b) => b.name === 'passive')!.foreignGross).toBe(50_000);
  });

  it('gives no passive credit for US-source investment income', () => {
    const r = computeUs(base({ interest: 50_000, usSourceInvestment: 50_000, ukTaxPassive: 5_000 }));
    expect(r.baskets.find((b) => b.name === 'passive')!.credit).toBe(0);
  });
});

describe('net investment income tax', () => {
  it('charges 3.8% on the excess over the threshold', () => {
    expect(computeUs(base({ interest: 300_000 })).niit).toBeCloseTo(3_800, 2);
  });
  it('adds the exclusion back for the threshold test', () => {
    const r = computeUs(base({ foreignEarned: 132_900, feieClaimed: true, qualifyingDays: 365, interest: 100_000 }));
    // MAGI 232,900 → 32,900 over the 200,000 threshold
    expect(r.niitBase).toBeCloseTo(32_900, 2);
  });
  it('is not reduced by the foreign tax credit', () => {
    const r = computeUs(base({ interest: 300_000, ukTaxPassive: 500_000 }));
    expect(r.totalTax).toBeCloseTo(r.niit, 2);
  });
  it('lets an allowed capital loss reduce net investment income', () => {
    // Reviewer's example: NII 50,000 less the 3,000 allowed loss.
    const r = computeUs(base({ usWages: 250_000, interest: 50_000, shortTermGains: -10_000 }));
    expect(r.niitBase).toBeCloseTo(47_000, 2);
  });

  it('uses the married-filing-separately threshold of 125,000', () => {
    expect(computeUs(base({ status: 'mfs', interest: 150_000 })).niitBase).toBe(25_000);
  });
});

describe('capital losses and reporting thresholds', () => {
  it('limits a net loss to 1,500 married filing separately', () => {
    expect(computeUs(base({ status: 'mfs', shortTermGains: -10_000 })).grossIncome).toBe(-1_500);
  });
  it('requires an FBAR only above 10,000', () => {
    expect(computeUs(base({ foreignAccountsMax: 10_000 })).fbarRequired).toBe(false);
    expect(computeUs(base({ foreignAccountsMax: 10_001 })).fbarRequired).toBe(true);
  });
  it('uses the abroad thresholds for Form 8938', () => {
    expect(computeUs(base({ specifiedAssetsYearEnd: 199_000, specifiedAssetsMax: 299_000 })).form8938Required).toBe(false);
    expect(computeUs(base({ specifiedAssetsYearEnd: 150_000, specifiedAssetsMax: 300_001 })).form8938Required).toBe(true);
    expect(computeUs(base({ status: 'mfj', specifiedAssetsYearEnd: 350_000 })).form8938Required).toBe(false);
  });
});

describe('deadlines', () => {
  it('2025 return: payment 15 April 2026, filing 15 June abroad, FBAR 15 October', () => {
    const d = usDeadlines(2025, { abroad: true, extensionFiled: false });
    expect(iso(d.payment)).toBe('2026-04-15');
    expect(iso(d.filing)).toBe('2026-06-15');
    expect(iso(d.fbar)).toBe('2026-10-15');
  });
  it('Form 4868 moves filing to 15 October, never payment', () => {
    const d = usDeadlines(2026, { abroad: true, extensionFiled: true });
    expect(iso(d.filing)).toBe('2027-10-15');
    expect(iso(d.payment)).toBe('2027-04-15');
  });
  it('rolls past a weekend and Emancipation Day', () => {
    // 15 April 2028 is a Saturday; 16 April a Sunday, observed Monday 17th.
    expect(iso(nextBusinessDay(new Date(Date.UTC(2028, 3, 15))))).toBe('2028-04-18');
  });
  it('raises nothing once the return and FBAR are recorded as filed', () => {
    const filed = new Date(Date.UTC(2026, 5, 1));
    expect(usObligations('e', 'Her', 2025, { abroad: true, extensionFiled: false, filedOn: filed, fbarRequired: true, fbarFiledOn: filed })).toEqual([]);
    expect(usObligations('e', 'Her', 2025, { abroad: true, extensionFiled: false, fbarRequired: true }).map((o) => o.taxType))
      .toEqual(['US_1040', 'US_1040', 'FBAR']);
  });
});

describe('child tax credit', () => {
  it('pays the unused credit as a refund when UK tax has wiped out US tax', () => {
    // 60,000 UK salary, UK tax well above US tax, two children.
    const r = computeUs(base({ status: 'mfs', foreignEarned: 60_000, ukTaxEarnings: 15_000, qualifyingChildren: 2 }));
    expect(r.ftc).toBeCloseTo(r.incomeTax, 2);
    expect(r.childCredit).toBe(0);
    expect(r.childCreditRefund).toBe(3_400);
    expect(r.balance).toBe(-3_400);
  });

  it('limits the refund to 15% of earnings over 2,500', () => {
    const r = computeUs(base({ foreignEarned: 10_000, qualifyingChildren: 3 }));
    expect(r.childCreditRefund).toBeCloseTo(1_125, 2);
  });

  it('gives no refund at all when the exclusion is claimed, and says what it costs', () => {
    const r = computeUs(base({ foreignEarned: 60_000, feieClaimed: true, qualifyingDays: 365, qualifyingChildren: 2 }));
    expect(r.childCreditRefund).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/3,400 of child tax credit could be refunded/);
  });

  it('uses the credit against tax first', () => {
    const r = computeUs(base({ foreignEarned: 80_000, qualifyingChildren: 1 }));
    expect(r.childCredit).toBe(2_200);
    expect(r.childCreditRefund).toBe(0);
  });

  it('phases out by 50 for each 1,000 or part over 200,000', () => {
    const r = computeUs(base({ status: 'mfs', usWages: 200_500, qualifyingChildren: 1 }));
    expect(r.childCredit).toBe(2_150);
  });
});
