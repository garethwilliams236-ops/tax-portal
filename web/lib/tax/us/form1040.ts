import {
  BRACKET_RATES, CAPITAL_LOSS_LIMIT, FBAR_THRESHOLD, FORM_8938_ABROAD, NIIT_RATE, NIIT_THRESHOLD,
  ordinaryTax, usRates, type FilingStatus,
} from './rates';

/**
 * Form 1040 for a US citizen resident in the UK.
 *
 * The shape of the problem is not the US rates, which are a table. It is the
 * two ways of not paying US tax twice on income the UK has already taxed, and
 * how they interact:
 *
 *   FEIE  (s.911, Form 2555) — excludes foreign EARNED income up to a limit.
 *         The rest of the income is then taxed as if the excluded amount were
 *         still there ("stacking", s.911(f)), so the exclusion buys the bottom
 *         of the rate table, not the top.
 *   FTC   (s.901, Form 1116) — credits UK tax against US tax on the same
 *         income, basket by basket, limited to the US tax on that basket's
 *         share of taxable income (s.904). UK tax on income the FEIE excluded
 *         is not creditable (s.911(d)(6)).
 *
 * The 3.8% NIIT (s.1411) sits outside both: the domestic FTC does not reduce
 * it, and the FEIE is added back for the threshold test.
 *
 * Everything is in US dollars. The screen converts GBP at the rate you give it.
 *
 * What this does NOT do is listed in `NOT_APPLIED` and shown on the screen,
 * because a US return understated by an omission looks exactly as confident as
 * a correct one.
 */

export interface UsInputs {
  year: number;
  status: FilingStatus;

  /** Earned abroad: UK salary, director's fees, self-employment profit. */
  foreignEarned: number;
  /** Wages with a US source. Rare for a UK resident; kept apart because it is not FEIE-eligible. */
  usWages: number;
  interest: number;
  ordinaryDividends: number;
  /** Included in ordinaryDividends, not added to it. */
  qualifiedDividends: number;
  shortTermGains: number;
  longTermGains: number;
  /** Taxable amount of pensions and annuities. */
  pensions: number;
  /** Net rental income after expenses and depreciation. */
  rental: number;
  otherIncome: number;
  /** Schedule 1 Part II adjustments. */
  adjustments: number;
  /** Total itemised deductions. Zero or less than the standard deduction → standard is used. */
  itemized: number;

  feieClaimed: boolean;
  /** Days in the tax year that satisfy the bona fide residence or physical presence test. */
  qualifyingDays: number;

  /** Portion of interest/dividends/gains/rental with a US source. Not foreign, so no FTC. */
  usSourceInvestment: number;

  /** UK tax on earnings (salary, fees, self-employed profit), converted to USD. */
  ukTaxEarnings: number;
  /** UK tax on other general-category income — pensions, other income. Not touched by the exclusion. */
  ukTaxGeneral: number;
  /** UK tax on passive income (interest, dividends, gains, rental), converted to USD. */
  ukTaxPassive: number;

  usWithholding: number;
  estimatedPayments: number;

  /** Highest aggregate balance of all non-US accounts at any time in the year. */
  foreignAccountsMax: number;
  /** Specified foreign financial assets at the year end, and at their highest. */
  specifiedAssetsYearEnd: number;
  specifiedAssetsMax: number;
}

export const ZERO_INPUTS: Omit<UsInputs, 'year' | 'status'> = {
  foreignEarned: 0, usWages: 0, interest: 0, ordinaryDividends: 0, qualifiedDividends: 0,
  shortTermGains: 0, longTermGains: 0, pensions: 0, rental: 0, otherIncome: 0,
  adjustments: 0, itemized: 0, feieClaimed: false, qualifyingDays: 0, usSourceInvestment: 0,
  ukTaxEarnings: 0, ukTaxGeneral: 0, ukTaxPassive: 0, usWithholding: 0, estimatedPayments: 0,
  foreignAccountsMax: 0, specifiedAssetsYearEnd: 0, specifiedAssetsMax: 0,
};

export interface Line {
  label: string;
  amount: number;
  /** Form and line, or statute, for checking against the return. */
  ref?: string;
  note?: string;
  /** A subtotal the screen should emphasise. */
  total?: boolean;
}

export interface Basket {
  name: 'general' | 'passive';
  /** Passive income moved into general because UK tax on it exceeds the top US rate. */
  highTaxed?: boolean;
  foreignGross: number;
  allocatedDeductions: number;
  foreignTaxable: number;
  ukTax: number;
  disallowed: number;
  creditable: number;
  limitation: number;
  credit: number;
  /** Creditable tax above the limitation: carryable back one year, forward ten (s.904(c)). Not tracked. */
  excess: number;
}

export interface UsResult {
  year: number;
  status: FilingStatus;
  grossIncome: number;
  exclusion: number;
  exclusionLimit: number;
  agi: number;
  deduction: number;
  deductionKind: 'standard' | 'itemized';
  taxable: number;
  preferential: number;
  incomeTax: number;
  baskets: Basket[];
  ftc: number;
  niitBase: number;
  niit: number;
  totalTax: number;
  payments: number;
  balance: number;
  fbarRequired: boolean;
  form8938Required: boolean;
  lines: Line[];
  warnings: string[];
}

export const NOT_APPLIED = [
  'Child tax credit and the other personal credits (s.24, s.25A etc.)',
  'Alternative minimum tax (Form 6251)',
  'Self-employment tax — and the US-UK totalization agreement that usually displaces it',
  'Foreign housing exclusion or deduction (s.911(c), Form 2555 Part VI)',
  'Form 1116 rate-differential adjustment for foreign qualified dividends and capital gains',
  'Foreign tax credit carryovers (s.904(c)) — the excess is shown but not carried',
  '25% and 28% gain categories (unrecaptured s.1250 gain, collectibles)',
  'PFIC regime for UK funds and ISAs (s.1291, Form 8621)',
  'High-tax kick-out tested on the passive basket as a whole, not group by group (Reg. 1.904-4(c))',
  'IRS Tax Table: below $100,000 the 1040 uses $50 bands; exact rates are used here, so line 16 can differ by a few dollars',
];

const daysInYear = (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);

/**
 * Tax on taxable income with qualified dividends and net capital gain taxed
 * at 0/15/20% — the Qualified Dividends and Capital Gain Tax Worksheet, lines
 * 1 to 25, without the 25%/28% categories.
 */
export function taxWithPreferential(
  taxable: number, preferential: number, status: FilingStatus, year: number,
): number {
  if (taxable <= 0) return 0;
  const r = usRates(year);
  const L1 = taxable;
  const L4 = Math.max(0, Math.min(preferential, taxable));
  const L5 = L1 - L4;
  const L7 = Math.min(L1, r.cgZeroMax[status]);
  const L8 = Math.min(L5, L7);
  const L9 = L7 - L8;                       // taxed at 0%
  const L10 = Math.min(L1, L4);
  const L12 = L10 - L9;
  const L14 = Math.min(L1, r.cgFifteenMax[status]);
  const L15 = L5 + L9;
  const L16 = Math.max(0, L14 - L15);
  const L17 = Math.min(L12, L16);           // taxed at 15%
  const L20 = L10 - (L9 + L17);             // taxed at 20%
  const withPref = ordinaryTax(L5, status, year) + L17 * 0.15 + L20 * 0.20;
  return Math.min(withPref, ordinaryTax(L1, status, year));
}

const pos = (n: number) => Math.max(0, n);
const TOP_US_RATE = BRACKET_RATES[BRACKET_RATES.length - 1]!;

export function computeUs(i: UsInputs): UsResult {
  const r = usRates(i.year);
  const s = i.status;
  const warnings: string[] = [];
  const lines: Line[] = [];

  // --- income --------------------------------------------------------------
  const netCapital = i.shortTermGains + i.longTermGains;
  const capitalIncluded = netCapital >= 0 ? netCapital : -Math.min(-netCapital, CAPITAL_LOSS_LIMIT[s]);
  const netLtcg = pos(Math.min(i.longTermGains, netCapital));
  const qd = Math.min(pos(i.qualifiedDividends), pos(i.ordinaryDividends));
  if (i.qualifiedDividends > i.ordinaryDividends) {
    warnings.push('Qualified dividends exceed ordinary dividends. They are part of ordinary dividends, not in addition to them; capped.');
  }

  const grossIncome = i.foreignEarned + i.usWages + i.interest + i.ordinaryDividends
    + capitalIncluded + i.pensions + i.rental + i.otherIncome;

  lines.push({ label: 'Wages and earnings (foreign)', amount: i.foreignEarned, ref: '1040 l.1 / Sch 1' });
  if (i.usWages) lines.push({ label: 'Wages (US source)', amount: i.usWages, ref: '1040 l.1a' });
  lines.push({ label: 'Taxable interest', amount: i.interest, ref: '1040 l.2b' });
  lines.push({ label: 'Ordinary dividends', amount: i.ordinaryDividends, ref: '1040 l.3b', note: qd ? `of which qualified ${Math.round(qd).toLocaleString('en-US')}` : undefined });
  lines.push({
    label: 'Capital gain or (loss)', amount: capitalIncluded, ref: '1040 l.7',
    note: netCapital < capitalIncluded ? `net loss ${Math.round(-netCapital).toLocaleString('en-US')}, deduction limited (s.1211(b)); balance carries forward` : undefined,
  });
  if (i.pensions) lines.push({ label: 'Pensions and annuities', amount: i.pensions, ref: '1040 l.5b' });
  if (i.rental) lines.push({ label: 'Rental income', amount: i.rental, ref: 'Sch E' });
  if (i.otherIncome) lines.push({ label: 'Other income', amount: i.otherIncome, ref: 'Sch 1' });
  lines.push({ label: 'Total income before exclusion', amount: grossIncome, total: true });

  // --- FEIE ----------------------------------------------------------------
  const days = daysInYear(i.year);
  const qDays = Math.max(0, Math.min(days, Math.round(i.qualifyingDays)));
  const exclusionLimit = r.feie * (qDays / days);
  const exclusion = i.feieClaimed ? Math.min(pos(i.foreignEarned), exclusionLimit) : 0;
  if (i.feieClaimed) {
    if (qDays === 0) warnings.push('The exclusion is claimed but no qualifying days are entered, so nothing is excluded.');
    lines.push({
      label: 'Foreign earned income exclusion', amount: -exclusion, ref: 'Form 2555; s.911',
      note: `limit ${Math.round(r.feie).toLocaleString('en-US')} × ${qDays}/${days} days`,
    });
  }

  const agi = grossIncome - exclusion - i.adjustments;
  if (i.adjustments) lines.push({ label: 'Adjustments to income', amount: -i.adjustments, ref: 'Sch 1 Part II' });
  lines.push({ label: 'Adjusted gross income', amount: agi, ref: '1040 l.11', total: true });

  const std = r.standardDeduction[s];
  const deductionKind = i.itemized > std ? 'itemized' : 'standard';
  const deduction = deductionKind === 'itemized' ? i.itemized : std;
  if (s === 'mfs' && deductionKind === 'standard') {
    // s.63(c)(6)(A): if one spouse itemises, the other's standard deduction is nil.
    warnings.push('Married filing separately: if the other spouse itemises on a US return, the standard deduction is nil (s.63(c)(6)(A)). A non-resident alien spouse files no 1040, so this is usually not engaged.');
  }
  lines.push({ label: deductionKind === 'standard' ? 'Standard deduction' : 'Itemised deductions', amount: -deduction, ref: '1040 l.12' });

  const taxable = pos(agi - deduction);
  lines.push({ label: 'Taxable income', amount: taxable, ref: '1040 l.15', total: true });

  // --- tax, stacked over any exclusion -------------------------------------
  const preferential = Math.min(qd + netLtcg, taxable);
  let incomeTax: number;
  if (taxable <= 0) {
    incomeTax = 0;
  } else if (exclusion > 0) {
    // Foreign Earned Income Tax Worksheet (1040 instructions, line 16).
    const stacked = taxWithPreferential(taxable + exclusion, preferential, s, i.year);
    const onExcluded = ordinaryTax(exclusion, s, i.year);
    incomeTax = pos(stacked - onExcluded);
    lines.push({
      label: 'Tax, stacked over the exclusion', amount: incomeTax, ref: '1040 l.16; s.911(f)',
      note: `tax on ${Math.round(taxable + exclusion).toLocaleString('en-US')} less tax on the ${Math.round(exclusion).toLocaleString('en-US')} excluded`,
    });
  } else {
    incomeTax = taxWithPreferential(taxable, preferential, s, i.year);
    lines.push({
      label: 'Tax', amount: incomeTax, ref: '1040 l.16',
      note: preferential > 0 ? `${Math.round(preferential).toLocaleString('en-US')} at the 0/15/20% rates` : undefined,
    });
  }

  // --- FTC, by basket ------------------------------------------------------
  const afterExclusion = grossIncome - exclusion;
  const passiveForeign = pos(i.interest + i.ordinaryDividends + pos(capitalIncluded) + i.rental - i.usSourceInvestment);
  const toAllocate = deduction + i.adjustments;
  const allocate = (gross: number) => (afterExclusion > 0 ? toAllocate * (gross / afterExclusion) : 0);

  // s.904(d)(2)(F), Reg. 1.904-4(c): passive income bearing foreign tax above
  // the top s.1 rate is general-category income. UK higher and additional rate
  // tax on interest and rent routinely crosses it.
  const passiveTaxable = pos(passiveForeign - allocate(passiveForeign));
  const highTaxed = passiveTaxable > 0 && i.ukTaxPassive / passiveTaxable > TOP_US_RATE;

  // s.911(d)(6), Reg. 1.911-6(a): UK tax on the excluded slice of EARNINGS is
  // not creditable. UK tax on pensions and other income is untouched by it.
  const excludedShare = exclusion > 0 && i.foreignEarned > 0 ? exclusion / i.foreignEarned : 0;
  const disallowedEarnings = i.ukTaxEarnings * excludedShare;

  const basket = (name: Basket['name'], foreignGross: number, ukTax: number, disallowed: number, moved = false): Basket => {
    const allocatedDeductions = allocate(foreignGross);
    const foreignTaxable = pos(foreignGross - allocatedDeductions);
    const limitation = taxable > 0 ? incomeTax * Math.min(1, foreignTaxable / taxable) : 0;
    const creditable = pos(ukTax - disallowed);
    const credit = Math.min(creditable, limitation);
    return { name, highTaxed: moved || undefined, foreignGross, allocatedDeductions, foreignTaxable, ukTax, disallowed, creditable, limitation, credit, excess: pos(creditable - limitation) };
  };

  const generalGross = pos(i.foreignEarned - exclusion) + i.pensions + i.otherIncome + (highTaxed ? passiveForeign : 0);
  const generalTax = i.ukTaxEarnings + i.ukTaxGeneral + (highTaxed ? i.ukTaxPassive : 0);
  const baskets = [
    basket('general', generalGross, generalTax, disallowedEarnings, highTaxed),
    basket('passive', highTaxed ? 0 : passiveForeign, highTaxed ? 0 : i.ukTaxPassive, 0),
  ];
  const ftc = Math.min(incomeTax, baskets.reduce((a, b) => a + b.credit, 0));
  for (const b of baskets) {
    if (b.ukTax > 0 || b.foreignGross > 0 || b.disallowed > 0) {
      lines.push({
        label: `Foreign tax credit — ${b.name}`, amount: -b.credit, ref: 'Form 1116; s.901, s.904',
        note: `UK tax ${Math.round(b.creditable).toLocaleString('en-US')} creditable, limit ${Math.round(b.limitation).toLocaleString('en-US')}`
          + (b.disallowed > 0 ? `; ${Math.round(b.disallowed).toLocaleString('en-US')} disallowed on excluded earnings` : '')
          + (b.highTaxed ? '; includes high-taxed passive income (s.904(d)(2)(F))' : '')
          + (b.excess > 0.5 ? `; excess ${Math.round(b.excess).toLocaleString('en-US')} not carried` : ''),
      });
    }
  }

  // --- NIIT ----------------------------------------------------------------
  // A net capital loss reduces NII to the extent it was allowed (Reg. 1.1411-4(d)(2)).
  const nii = pos(i.interest + i.ordinaryDividends + capitalIncluded + i.rental);
  const magi = agi + exclusion;
  const niitBase = pos(Math.min(nii, magi - NIIT_THRESHOLD[s]));
  const niit = niitBase * NIIT_RATE;
  if (niit > 0) {
    lines.push({
      label: 'Net investment income tax', amount: niit, ref: 'Form 8960; s.1411',
      note: `3.8% × lesser of NII ${Math.round(nii).toLocaleString('en-US')} and MAGI over ${NIIT_THRESHOLD[s].toLocaleString('en-US')}; not reduced by the FTC`,
    });
  }

  const totalTax = incomeTax - ftc + niit;
  lines.push({ label: 'Total tax', amount: totalTax, ref: '1040 l.24', total: true });

  const payments = i.usWithholding + i.estimatedPayments;
  if (payments) lines.push({ label: 'Payments and withholding', amount: -payments, ref: '1040 l.33' });
  const balance = totalTax - payments;
  lines.push({ label: balance >= 0 ? 'Amount owed' : 'Overpaid', amount: balance, ref: balance >= 0 ? '1040 l.37' : '1040 l.34', total: true });

  const t8938 = FORM_8938_ABROAD[s];
  return {
    year: i.year, status: s, grossIncome, exclusion, exclusionLimit, agi, deduction, deductionKind,
    taxable, preferential, incomeTax, baskets, ftc, niitBase, niit, totalTax, payments, balance,
    fbarRequired: i.foreignAccountsMax > FBAR_THRESHOLD,
    form8938Required: i.specifiedAssetsYearEnd > t8938.yearEnd || i.specifiedAssetsMax > t8938.anyTime,
    lines, warnings,
  };
}
