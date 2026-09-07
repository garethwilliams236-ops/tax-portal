import { generateObligations, type EntityConfig, type Obligation, type TaxType } from '@/lib/tax/obligations';
import type { EntityRow } from './queries';
import type { TaxReturn } from '@/lib/tax/ledger';

/**
 * Return slots are DERIVED from the obligation calendar, not stored.
 *
 * A row in `tax_returns` exists only once you have something to say about that
 * period — a status, or a declared figure. Pre-creating three years of empty
 * rows would mean a table where "no row" and "nothing done" are indistinguishable
 * from a row that was deliberately cleared, and it would drift the moment a
 * statutory deadline changed.
 */
export interface Slot {
  taxType: TaxType;
  periodKey: string;
  periodStart?: Date;
  periodEnd: Date;
  fileBy: Date;
  payBy: Date;
  label: string;
  short: string;
}

/** Which obligation kind carries the declaration, per tax. PAYE declares monthly via RTI. */
const DECLARING: Partial<Record<TaxType, Obligation['kind']>> = {
  CT: 'filing', VAT: 'filing', SA: 'filing', PAYE: 'payment',
};

export function toConfig(e: EntityRow): EntityConfig {
  if (e.type === 'company') {
    return {
      entityId: e.id, entityName: e.name, type: 'company',
      yearEndMonth: e.year_end_month ?? 3,
      yearEndDay: e.year_end_day ?? 31,
      tradingStatus: e.trading_status,
      vatRegistered: e.vat_registered,
      vatStaggerEndMonth: e.vat_stagger ? Number(e.vat_stagger) : 3,
      hasPayroll: true,
    };
  }
  return { entityId: e.id, entityName: e.name, type: 'individual', selfAssessment: true, paymentsOnAccountDue: true };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const tyOf = (d: Date) => {
  const y = d.getUTCFullYear();
  return d.getTime() >= Date.UTC(y, 3, 6)
    ? `${y}-${String((y + 1) % 100).padStart(2, '0')}`
    : `${y - 1}-${String(y % 100).padStart(2, '0')}`;
};
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function shortLabel(t: TaxType, key: string, end: Date): string {
  if (t === 'SA') return key.replace('-', '/');
  if (t === 'VAT') return 'Q/E ' + fmt(end);
  if (t === 'PAYE') return 'Month to ' + fmt(end);
  return 'Y/E ' + fmt(end);
}

/** 36 months back so a historic return can still be filed; 24 forward for planning. */
export function slotsFor(entity: EntityRow, asAt: Date): Slot[] {
  const from = new Date(asAt); from.setUTCMonth(from.getUTCMonth() - 36);
  const to = new Date(asAt); to.setUTCMonth(to.getUTCMonth() + 24);

  const out: Slot[] = [];
  for (const o of generateObligations([toConfig(entity)], from, to)) {
    if (DECLARING[o.taxType] !== o.kind) continue;
    if (!o.periodEnd) continue;
    const key = o.taxType === 'SA' ? tyOf(o.periodEnd) : iso(o.periodEnd);
    if (out.some((s) => s.taxType === o.taxType && s.periodKey === key)) continue;

    const payBy =
      o.taxType === 'CT'
        ? (() => { const d = new Date(o.periodEnd!); d.setUTCMonth(d.getUTCMonth() + 9); d.setUTCDate(d.getUTCDate() + 1); return d; })()
        : o.dueDate;
    const fileBy =
      o.taxType === 'CT'
        ? (() => { const d = new Date(o.periodEnd!); d.setUTCFullYear(d.getUTCFullYear() + 1); return d; })()
        : o.dueDate;

    out.push({
      taxType: o.taxType, periodKey: key,
      periodStart: o.periodStart, periodEnd: o.periodEnd,
      fileBy, payBy,
      label: o.description,
      short: shortLabel(o.taxType, key, o.periodEnd),
    });
  }
  return out.sort((a, b) => a.fileBy.getTime() - b.fileBy.getTime());
}

/** A slot joined to whatever has been recorded against it. */
export interface SlotReturn extends Slot {
  stored: TaxReturn | null;
  status: TaxReturn['status'];
  declaredAmount: number | null;
  filedOn: Date | null | undefined;
  /** Filed but declaring nothing — an old tick carried across, or a mistake. */
  amountMissing: boolean;
}

export function joinReturns(slots: Slot[], stored: TaxReturn[]): SlotReturn[] {
  return slots.map((s) => {
    const r = stored.find((x) => x.taxType === s.taxType && x.periodKey === s.periodKey) ?? null;
    return {
      ...s,
      stored: r,
      status: r?.status ?? 'not_started',
      declaredAmount: r?.declaredAmount ?? null,
      filedOn: r?.filedOn,
      amountMissing: !!(r && r.status === 'filed' && r.declaredAmount === null),
    };
  });
}
