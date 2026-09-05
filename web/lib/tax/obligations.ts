/**
 * Obligation generation.
 *
 * Pure functions taking an entity config and a date range, returning obligation
 * rows. No I/O, so no mocking is needed to test them.
 *
 * A dormant company generates a DIFFERENT set, not an empty one — that is how a
 * dormant company gets struck off. The confirmation statement is the one to
 * protect: 14 days, a criminal offence to miss, and the most common trigger for
 * compulsory strike-off.
 */

export type TaxType =
  | 'CT'
  | 'VAT'
  | 'PAYE'
  | 'SA'
  | 'MTD_ITSA'
  | 'CGT_60DAY'
  | 'P11D'
  | 'CIS'
  | 'IHT'
  | 'CONFIRMATION_STATEMENT'
  | 'ACCOUNTS'
  | 'CT_NOTIFICATION'
  | 'FORM_17'
  | 'EA_REVIEW';

export type ObligationKind = 'filing' | 'payment' | 'submission' | 'report' | 'decision';

export interface Obligation {
  entityId: string;
  entityName: string;
  taxType: TaxType;
  kind: ObligationKind;
  description: string;
  periodStart?: Date;
  periodEnd?: Date;
  dueDate: Date;
  /** Cannot be recovered if missed — escalate hardest. */
  isUnextendable?: boolean;
  citation?: string;
}

export interface CompanyConfig {
  entityId: string;
  entityName: string;
  type: 'company';
  yearEndMonth: number; // 1-12
  yearEndDay: number;
  tradingStatus: 'trading' | 'non_trading' | 'dormant';
  vatRegistered: boolean;
  /** Month in which a VAT quarter ends, e.g. 3 for Mar/Jun/Sep/Dec. */
  vatStaggerEndMonth?: number;
  hasPayroll: boolean;
  /** Average monthly PAYE liability under £1,500 permits quarterly payment. */
  payeQuarterly?: boolean;
  confirmationStatementDue?: Date;
  /** Set when the company has come within the charge to CT — starts the s.55 clock. */
  cameWithinChargeOn?: Date;
}

export interface IndividualConfig {
  entityId: string;
  entityName: string;
  type: 'individual';
  selfAssessment: boolean;
  /** Payments on account are not due if under £1,000 or 80%+ taxed at source. */
  paymentsOnAccountDue?: boolean;
  mtdItsa?: boolean;
}

export type EntityConfig = CompanyConfig | IndividualConfig;

const DAY = 86_400_000;

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

function addMonths(date: Date, months: number): Date {
  const r = new Date(date.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

function within(date: Date, from: Date, to: Date): boolean {
  return date >= from && date <= to;
}

/**
 * VAT return and payment deadline: "one calendar month and seven days after the
 * end of the accounting period".
 *
 * Naive date arithmetic gets this wrong. Adding one month to 30 September gives
 * 30 October, and adding seven days gives 6 November — but the actual deadline
 * is 7 November. Because VAT periods always end on a month end, "one calendar
 * month" lands on the end of the following month, so the deadline is always the
 * 7th of the SECOND month after the period end. HMRC's own examples confirm it:
 * a quarter ending 31 March is due 7 May, one ending 30 September is due
 * 7 November.
 */
export function vatDueDate(periodEnd: Date): Date {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 2, 7));
}

/** Accounting period ends falling in a window, given a year end day/month. */
function periodEndsIn(cfg: CompanyConfig, from: Date, to: Date): Date[] {
  const ends: Date[] = [];
  for (let y = from.getUTCFullYear() - 2; y <= to.getUTCFullYear() + 2; y++) {
    const end = d(y, cfg.yearEndMonth, cfg.yearEndDay);
    if (end >= new Date(from.getTime() - 400 * DAY) && end <= to) ends.push(end);
  }
  return ends;
}

function generateForCompany(cfg: CompanyConfig, from: Date, to: Date): Obligation[] {
  const out: Obligation[] = [];
  const base = { entityId: cfg.entityId, entityName: cfg.entityName };
  const isDormant = cfg.tradingStatus === 'dormant';

  for (const periodEnd of periodEndsIn(cfg, from, to)) {
    const periodStart = addMonths(periodEnd, -12);
    periodStart.setUTCDate(periodStart.getUTCDate() + 1);

    // Companies House accounts: 9 months after the accounting reference date.
    // A dormant company files AA02 instead of full accounts — same deadline.
    const accountsDue = addMonths(periodEnd, 9);
    if (within(accountsDue, from, to)) {
      out.push({
        ...base,
        taxType: 'ACCOUNTS',
        kind: 'filing',
        description: isDormant
          ? 'Dormant accounts (AA02) to Companies House'
          : 'Annual accounts to Companies House',
        periodStart,
        periodEnd,
        dueDate: accountsDue,
        citation: 'CA 2006 s.442',
      });
    }

    // A dormant company files no CT600 unless HMRC has issued a notice, and
    // makes no CT payment. Skip both.
    if (!isDormant) {
      const ctPayment = addMonths(periodEnd, 9);
      ctPayment.setUTCDate(ctPayment.getUTCDate() + 1);
      if (within(ctPayment, from, to)) {
        out.push({
          ...base,
          taxType: 'CT',
          kind: 'payment',
          description: 'Corporation Tax payment',
          periodStart,
          periodEnd,
          dueDate: ctPayment,
          citation: '9 months and 1 day after the period end',
        });
      }

      const ct600 = new Date(periodEnd.getTime());
      ct600.setUTCFullYear(ct600.getUTCFullYear() + 1);
      if (within(ct600, from, to)) {
        out.push({
          ...base,
          taxType: 'CT',
          kind: 'filing',
          description: 'CT600 Company Tax Return',
          periodStart,
          periodEnd,
          dueDate: ct600,
          citation: 'FA 1998 Sch 18',
        });
      }
    }
  }

  // Confirmation statement — required regardless of dormancy, 14 days.
  if (cfg.confirmationStatementDue) {
    let due = new Date(cfg.confirmationStatementDue.getTime());
    for (let i = 0; i < 4; i++) {
      if (within(due, from, to)) {
        out.push({
          ...base,
          taxType: 'CONFIRMATION_STATEMENT',
          kind: 'filing',
          description: 'Confirmation statement to Companies House',
          dueDate: new Date(due.getTime()),
          citation: 'CA 2006 s.853A — 14 days after the review period ends. Missing it is a criminal offence and the most common trigger for compulsory strike-off.',
        });
      }
      due = addMonths(due, 12);
    }
  }

  // s.55 notification: 3 months from the START of the accounting period in
  // which the company comes within the charge. Short clock, hard consequence.
  if (cfg.cameWithinChargeOn) {
    const due = addMonths(cfg.cameWithinChargeOn, 3);
    if (within(due, from, to)) {
      out.push({
        ...base,
        taxType: 'CT_NOTIFICATION',
        kind: 'submission',
        description: 'Notify HMRC the company is within the charge to Corporation Tax',
        dueDate: due,
        citation: 'FA 2004 s.55 — 3 months from the start of the accounting period, not the year end.',
      });
    }
  }

  // VAT: quarterly, 1 calendar month and 7 days after the period end.
  if (cfg.vatRegistered && cfg.vatStaggerEndMonth) {
    for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear() + 1; y++) {
      for (let q = 0; q < 4; q++) {
        const endMonth = ((cfg.vatStaggerEndMonth - 1 + q * 3) % 12) + 1;
        const yearOffset = Math.floor((cfg.vatStaggerEndMonth - 1 + q * 3) / 12);
        const qEnd = new Date(Date.UTC(y + yearOffset, endMonth, 0)); // last day of month
        const due = vatDueDate(qEnd);
        if (within(due, from, to)) {
          const qStart = addMonths(qEnd, -3);
          qStart.setUTCDate(qStart.getUTCDate() + 1);
          out.push({
            ...base,
            taxType: 'VAT',
            kind: 'filing',
            description: 'VAT return and payment',
            periodStart: qStart,
            periodEnd: qEnd,
            dueDate: due,
            citation: '1 calendar month and 7 days after the period end',
          });
        }
      }
    }
  }

  // PAYE: 22nd of the following tax month, electronically.
  if (cfg.hasPayroll && !isDormant) {
    for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear() + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        const due = d(y, m, 22);
        if (!within(due, from, to)) continue;
        if (cfg.payeQuarterly && ![7, 10, 1, 4].includes(m)) continue;
        out.push({
          ...base,
          taxType: 'PAYE',
          kind: 'payment',
          description: cfg.payeQuarterly ? 'PAYE/NIC quarterly payment' : 'PAYE/NIC monthly payment',
          dueDate: due,
          citation: '22nd of the following tax month for electronic payment',
        });
      }
    }
  }

  return out;
}

function generateForIndividual(cfg: IndividualConfig, from: Date, to: Date): Obligation[] {
  const out: Obligation[] = [];
  const base = { entityId: cfg.entityId, entityName: cfg.entityName };
  if (!cfg.selfAssessment) return out;

  for (let y = from.getUTCFullYear() - 1; y <= to.getUTCFullYear() + 1; y++) {
    // Tax year ending 5 April y; return and balancing payment due 31 Jan y+1.
    const filing = d(y + 1, 1, 31);
    const taxYearStart = d(y - 1, 4, 6);
    const taxYearEnd = d(y, 4, 5);

    if (within(filing, from, to)) {
      out.push({
        ...base,
        taxType: 'SA',
        kind: 'filing',
        description: `Self Assessment return ${y - 1}/${String(y % 100).padStart(2, '0')}`,
        periodStart: taxYearStart,
        periodEnd: taxYearEnd,
        dueDate: filing,
        citation: '31 January following the end of the tax year',
      });
      out.push({
        ...base,
        taxType: 'SA',
        kind: 'payment',
        description: 'Balancing payment' + (cfg.paymentsOnAccountDue ? ' and first payment on account' : ''),
        periodStart: taxYearStart,
        periodEnd: taxYearEnd,
        dueDate: filing,
      });
    }

    if (cfg.paymentsOnAccountDue) {
      const july = d(y + 1, 7, 31);
      if (within(july, from, to)) {
        out.push({
          ...base,
          taxType: 'SA',
          kind: 'payment',
          description: 'Second payment on account',
          dueDate: july,
          citation: '50% of the prior year liability, unless under £1,000 or 80%+ taxed at source',
        });
      }
    }
  }

  return out;
}

export function generateObligations(
  entities: EntityConfig[],
  from: Date,
  to: Date,
): Obligation[] {
  const out: Obligation[] = [];
  for (const e of entities) {
    if (e.type === 'company') out.push(...generateForCompany(e, from, to));
    else out.push(...generateForIndividual(e, from, to));
  }
  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** 60-day reporting obligation created by a UK residential property disposal. */
export function cgt60DayObligation(args: {
  entityId: string;
  entityName: string;
  disposalDate: Date;
  description: string;
}): Obligation {
  return {
    entityId: args.entityId,
    entityName: args.entityName,
    taxType: 'CGT_60DAY',
    kind: 'filing',
    description: `60-day CGT return: ${args.description}`,
    dueDate: new Date(args.disposalDate.getTime() + 60 * DAY),
    citation: 'Runs separately from Self Assessment — the deadline people miss',
  };
}

/**
 * Form 17 declaration. The 60 days run from the DECLARATION date, not the tax
 * year, and there is no power to extend (TSEM9862).
 */
export function form17Obligation(args: {
  entityId: string;
  entityName: string;
  declarationDate: Date;
  propertyDescription: string;
}): Obligation {
  return {
    entityId: args.entityId,
    entityName: args.entityName,
    taxType: 'FORM_17',
    kind: 'submission',
    description: `Form 17 declaration to reach HMRC: ${args.propertyDescription}`,
    dueDate: new Date(args.declarationDate.getTime() + 60 * DAY),
    isUnextendable: true,
    citation: 'TSEM9862 — 60 days from the declaration date. The time limit is enforced strictly and there is no power to extend.',
  };
}
