import { taxYearOf, type TaxYear } from '@/lib/tax/rates';

/**
 * The tax years a screen offers.
 *
 * Deliberately short. Rate tables exist for a handful of years and a screen
 * that offers 2014-15 only invites a figure to be entered against a year the
 * engine cannot compute.
 */
export function taxYears(asAt: Date, back = 2, forward = 1): TaxYear[] {
  const current = taxYearOf(asAt);
  const startYear = Number(current.slice(0, 4));
  const out: TaxYear[] = [];
  for (let y = startYear - back; y <= startYear + forward; y++) {
    out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}` as TaxYear);
  }
  return out;
}

/** The tax year a screen should open on, honouring an explicit choice. */
export function chosenYear(asAt: Date, requested?: string): TaxYear {
  const years = taxYears(asAt);
  const found = years.find((y) => y === requested);
  return found ?? taxYearOf(asAt);
}
