import type { Obligation } from '@/lib/tax/obligations';

/**
 * US federal deadlines for a calendar tax year.
 *
 *   1040, payment  15 April. Interest runs from here whatever extension
 *                  applies to filing (s.6601; IRS, "U.S. taxpayers living
 *                  abroad must file and pay taxes by June 16").
 *   1040, filing   15 April; 15 June automatically for a citizen living
 *                  abroad on the due date (Reg. 1.6081-5(a)(5), a statement
 *                  attached); 15 October with Form 4868 (Reg. 1.6081-4).
 *   FBAR           15 April, extended automatically to 15 October with no
 *                  request (31 CFR 1010.306(c)).
 *
 * A date on a weekend or a District of Columbia legal holiday moves to the
 * next business day (s.7503). Emancipation Day, 16 April, is the one that
 * lands near these dates.
 */

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function emancipationDayObserved(y: number): Date {
  const d = ymd(y, 4, 16);
  const dow = d.getUTCDay();
  if (dow === 6) return ymd(y, 4, 15);
  if (dow === 0) return ymd(y, 4, 17);
  return d;
}

export function nextBusinessDay(date: Date): Date {
  const out = new Date(date);
  const holiday = emancipationDayObserved(out.getUTCFullYear()).getTime();
  for (;;) {
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6 && out.getTime() !== holiday) return out;
    out.setUTCDate(out.getUTCDate() + 1);
  }
}

export interface UsDeadlineState {
  /** Living outside the US on the regular due date — the 15 June extension. */
  abroad: boolean;
  /** Form 4868 filed (or extension obtained by payment). */
  extensionFiled: boolean;
  filedOn?: Date | null;
  fbarRequired: boolean;
  fbarFiledOn?: Date | null;
}

export interface UsDeadlines {
  payment: Date;
  filing: Date;
  filingBasis: 'regular' | 'abroad' | 'form_4868';
  fbar: Date;
}

export function usDeadlines(year: number, st: Pick<UsDeadlineState, 'abroad' | 'extensionFiled'>): UsDeadlines {
  const y = year + 1;
  const payment = nextBusinessDay(ymd(y, 4, 15));
  const filingBasis = st.extensionFiled ? 'form_4868' : st.abroad ? 'abroad' : 'regular';
  const filing = nextBusinessDay(
    filingBasis === 'form_4868' ? ymd(y, 10, 15) : filingBasis === 'abroad' ? ymd(y, 6, 15) : ymd(y, 4, 15),
  );
  const fbar = nextBusinessDay(ymd(y, 10, 15));
  return { payment, filing, filingBasis, fbar };
}

/** The obligations a US return year generates, less any already recorded as filed. */
export function usObligations(
  entityId: string, entityName: string, year: number, st: UsDeadlineState,
): Obligation[] {
  const d = usDeadlines(year, st);
  const out: Obligation[] = [];
  const periodEnd = ymd(year, 12, 31);
  const periodStart = ymd(year, 1, 1);

  if (!st.filedOn) {
    out.push({
      entityId, entityName, taxType: 'US_1040', kind: 'filing', periodStart, periodEnd,
      description: `US Form 1040 for ${year}`,
      dueDate: d.filing,
      citation: d.filingBasis === 'form_4868' ? 'Extended by Form 4868 (Reg. 1.6081-4)'
        : d.filingBasis === 'abroad' ? 'Automatic two-month extension for a citizen abroad (Reg. 1.6081-5); attach the statement'
        : 'IRC s.6072(a)',
    });
    out.push({
      entityId, entityName, taxType: 'US_1040', kind: 'payment', periodStart, periodEnd,
      description: `US tax for ${year} — interest runs from this date`,
      dueDate: d.payment,
      citation: 'IRC s.6151, s.6601 — no extension of time to pay',
    });
  }
  if (st.fbarRequired && !st.fbarFiledOn) {
    out.push({
      entityId, entityName, taxType: 'FBAR', kind: 'report', periodStart, periodEnd,
      description: `FBAR (FinCEN 114) for ${year}`,
      dueDate: d.fbar,
      citation: '31 CFR 1010.306(c): due 15 April, extended automatically to 15 October',
    });
  }
  return out;
}
