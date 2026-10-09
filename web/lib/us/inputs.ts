import type { FilingStatus } from '@/lib/tax/us/rates';
import { ZERO_INPUTS, type UsInputs } from '@/lib/tax/us/form1040';

/**
 * The US screen's fields, and the translation from what is stored to what the
 * engine takes.
 *
 * Amounts are typed in the currency chosen for the year — pounds, usually,
 * since the income is British — and converted at the one rate entered for the
 * year. The IRS accepts its published yearly average rate for income spread
 * across the year; whichever rate is used, it is shown beside every figure it
 * produced. US withholding and estimated payments are always dollars.
 */

export type MoneyKey = Exclude<keyof typeof ZERO_INPUTS, 'feieClaimed' | 'qualifyingDays'>;

export interface MoneyField {
  key: MoneyKey;
  label: string;
  hint?: string;
  /** Always US dollars, whatever currency the year is kept in. */
  usd?: boolean;
}

export const GROUPS: { title: string; fields: MoneyField[] }[] = [
  {
    title: 'Income',
    fields: [
      { key: 'foreignEarned', label: 'Earnings abroad', hint: 'UK salary, director’s fees, self-employed profit' },
      { key: 'usWages', label: 'US-source wages' },
      { key: 'interest', label: 'Interest', hint: 'ISA interest included — the US does not recognise the ISA' },
      { key: 'ordinaryDividends', label: 'Dividends (all)' },
      { key: 'qualifiedDividends', label: 'of which qualified', hint: 'UK company dividends usually qualify under the treaty' },
      { key: 'shortTermGains', label: 'Short-term gains (losses negative)', hint: 'held one year or less' },
      { key: 'longTermGains', label: 'Long-term gains (losses negative)' },
      { key: 'pensions', label: 'Pensions (taxable amount)' },
      { key: 'rental', label: 'Net rental income', hint: 'after US depreciation, which differs from UK' },
      { key: 'otherIncome', label: 'Other income' },
      { key: 'usSourceInvestment', label: 'US-source part of investment income', hint: 'no credit on this. A gain is US source unless UK tax of at least 10% was paid on it (s.865(g))' },
    ],
  },
  {
    title: 'Deductions',
    fields: [
      { key: 'adjustments', label: 'Adjustments to income' },
      { key: 'itemized', label: 'Itemised deductions', hint: 'leave blank to take the standard deduction' },
    ],
  },
  {
    title: 'UK tax on this income',
    fields: [
      { key: 'ukTaxEarnings', label: 'UK tax on earnings', hint: 'UK income tax on salary or fees, not National Insurance' },
      { key: 'ukTaxGeneral', label: 'UK tax on pensions and other income', hint: 'general basket' },
      { key: 'ukTaxPassive', label: 'UK tax on investment and rental income', hint: 'passive basket' },
    ],
  },
  {
    title: 'US payments',
    fields: [
      { key: 'usWithholding', label: 'US tax withheld', usd: true },
      { key: 'estimatedPayments', label: 'Estimated tax paid', usd: true },
    ],
  },
  {
    title: 'Foreign accounts',
    fields: [
      { key: 'foreignAccountsMax', label: 'Highest combined balance of all non-US accounts', hint: 'FBAR test: over $10,000' },
      { key: 'specifiedAssetsYearEnd', label: 'Specified foreign assets at 31 December', hint: 'Form 8938' },
      { key: 'specifiedAssetsMax', label: 'Specified foreign assets at their highest' },
    ],
  },
];

export const ALL_MONEY = GROUPS.flatMap((g) => g.fields);
export const STATUSES: FilingStatus[] = ['mfs', 'single', 'hoh', 'mfj'];

export interface UsStored {
  status?: FilingStatus;
  currency?: 'GBP' | 'USD';
  /** Dollars per pound. */
  usd_per_gbp?: number;
  abroad?: boolean;
  extension_filed?: boolean;
  filed_on?: string;
  fbar_filed_on?: string;
  feie_claimed?: boolean;
  qualifying_days?: number;
  amounts?: Partial<Record<MoneyKey, number>>;
}

export type Prepared =
  | { ok: true; inputs: UsInputs; rate: number; currency: 'GBP' | 'USD' }
  | { ok: false; reason: string };

/** Turn the stored figures into the engine's dollar inputs, or say what is missing. */
export function prepare(year: number, s: UsStored): Prepared {
  if (!s.status) return { ok: false, reason: 'Choose a filing status to compute the return.' };
  const currency = s.currency ?? 'GBP';
  const rate = currency === 'USD' ? 1 : s.usd_per_gbp ?? 0;
  if (!(rate > 0)) return { ok: false, reason: 'Enter the dollars-per-pound rate for the year, or keep the year in dollars.' };

  const inputs: UsInputs = { ...ZERO_INPUTS, year, status: s.status };
  for (const f of ALL_MONEY) {
    const v = s.amounts?.[f.key];
    if (v === undefined) continue;
    inputs[f.key] = f.usd ? v : v * rate;
  }
  inputs.feieClaimed = s.feie_claimed === true;
  inputs.qualifyingDays = s.qualifying_days ?? 0;
  return { ok: true, inputs, rate, currency };
}

/** Read a submitted form into what is stored. Blank stays absent; a non-number throws. */
export function parseUsForm(form: FormData, previous: UsStored): UsStored {
  const num = (name: string): number | undefined => {
    const raw = String(form.get(name) ?? '').replace(/,/g, '').trim();
    if (raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${name}: not a number`);
    return n;
  };
  const date = (name: string): string | undefined => {
    const raw = String(form.get(name) ?? '').trim();
    if (raw === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${name}: not a date`);
    return raw;
  };

  const status = String(form.get('status') ?? '');
  const amounts: Partial<Record<MoneyKey, number>> = {};
  for (const f of ALL_MONEY) {
    const v = num(f.key);
    if (v !== undefined) amounts[f.key] = v;
  }
  const currency = form.get('currency') === 'USD' ? 'USD' : 'GBP';

  return {
    ...previous,
    status: (STATUSES as string[]).includes(status) ? (status as FilingStatus) : undefined,
    currency,
    usd_per_gbp: num('usd_per_gbp'),
    abroad: form.get('abroad') === 'on',
    extension_filed: form.get('extension_filed') === 'on',
    filed_on: date('filed_on'),
    fbar_filed_on: date('fbar_filed_on'),
    feie_claimed: form.get('feie_claimed') === 'on',
    qualifying_days: num('qualifying_days'),
    amounts,
  };
}
