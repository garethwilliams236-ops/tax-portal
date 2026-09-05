/**
 * The ledger: return, then liability, then payment.
 *
 * The order matters and is the whole point of this module. You REPORT first,
 * and the report DECLARES the amount. A liability exists because a return
 * declared it, or because statute charged it in advance of one — payments on
 * account and quarterly instalments. Payments are then ALLOCATED to a named
 * liability, and what is outstanding is arithmetic: liability less allocations.
 *
 * Nothing here lets an estimate become a debt. `estimateAmount` on a return is
 * carried for forecasting and for the variance once the return is filed; it is
 * never charged. That distinction is the reason this module exists — a portal
 * that records payments against computed figures reports a position that no
 * return ever declared.
 *
 * Pure functions throughout: no I/O, no dates read from the clock except where
 * one is passed in.
 */

import type { TaxType } from './obligations.js';

export type ReturnStatus = 'not_started' | 'in_progress' | 'ready_to_file' | 'filed';

export type LiabilityKind =
  // charged BY a return
  | 'return_charge'
  | 'balancing_payment'
  // charged by statute IN ADVANCE of one
  | 'payment_on_account'
  | 'quarterly_instalment'
  // charged outside the return cycle
  | 'interest'
  | 'penalty'
  | 'hmrc_amendment'
  | 'other';

export interface TaxReturn {
  id: string;
  entityId: string;
  taxType: TaxType;
  /** Tax-year string for SA ('2025-26'); ISO period end for everything else. */
  periodKey: string;
  periodStart?: Date;
  periodEnd: Date;
  fileBy: Date;
  payBy: Date;
  status: ReturnStatus;
  /** Authoritative once filed. Null on a filed return means it declares nothing. */
  declaredAmount: number | null;
  filedOn?: Date | null;
  submissionReference?: string;
  /** What the engine or the books thought. Never charged. */
  estimateAmount?: number | null;
}

export interface Liability {
  id: string;
  entityId: string;
  taxType: TaxType;
  periodKey: string;
  kind: LiabilityKind;
  label: string;
  detail?: string;
  amount: number;
  dueDate: Date;
  returnId?: string;
  /** Instalments are charged on an estimate by design. */
  isEstimated?: boolean;
}

export interface Payment {
  id: string;
  entityId: string;
  taxType: TaxType;
  amount: number;
  paidOn: Date;
  direction: 'to_hmrc' | 'from_hmrc';
  reference?: string;
  allocations: Allocation[];
}

export interface Allocation {
  liabilityId: string;
  amount: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const EPS = 0.005;

/* -------------------------------------------------------------------------- */
/* Charges arising from a filed return                                        */
/* -------------------------------------------------------------------------- */

/**
 * The charge a filed return creates.
 *
 * Returns null where the return is not filed, declares nothing, or where the
 * declared amount is entirely covered by charges already made in advance —
 * a return that declares exactly what the payments on account already charged
 * leaves nothing further to pay, and inventing a nil liability for it would
 * clutter the ledger.
 *
 * A NEGATIVE result is kept: over-charged instalments or payments on account
 * mean a repayment is due, and that is a real position, not a zero.
 */
export function chargeFromReturn(
  ret: TaxReturn,
  chargedInAdvance: Liability[] = [],
): Liability | null {
  if (ret.status !== 'filed' || ret.declaredAmount === null) return null;

  const advance = r2(chargedInAdvance.reduce((a, l) => a + l.amount, 0));
  const amount = r2(ret.declaredAmount - advance);
  if (Math.abs(amount) < EPS) return null;

  const balancing = advance !== 0;
  return {
    id: `${ret.entityId}|${ret.taxType}|${ret.periodKey}|charge`,
    entityId: ret.entityId,
    taxType: ret.taxType,
    periodKey: ret.periodKey,
    kind: balancing ? 'balancing_payment' : 'return_charge',
    label: balancing
      ? amount >= 0
        ? 'Balancing payment'
        : 'Overpaid in advance — repayment due'
      : `${ret.taxType} declared`,
    detail: balancing
      ? `Declared ${ret.declaredAmount} less ${advance} already charged`
      : undefined,
    amount,
    dueDate: ret.payBy,
    returnId: ret.id,
  };
}

/**
 * The variance between what the return declared and what the engine computed.
 * Null where there is nothing to compare — an unfiled return, or a computation
 * that was never run. A zero variance is a real result and is returned as 0.
 */
export function declaredVariance(ret: TaxReturn): number | null {
  if (ret.status !== 'filed' || ret.declaredAmount === null) return null;
  if (ret.estimateAmount === null || ret.estimateAmount === undefined) return null;
  return r2(ret.declaredAmount - ret.estimateAmount);
}

/* -------------------------------------------------------------------------- */
/* Charges arising by statute, before any return                              */
/* -------------------------------------------------------------------------- */

/**
 * Self Assessment payments on account — TMA 1970 s.59A.
 *
 * Each is 50% of the PRECEDING year's relevant liability, due 31 January in
 * the tax year and 31 July after it. They are due whether or not this year's
 * return exists, which is exactly why they cannot be modelled as something a
 * return produces.
 *
 * Not required where the preceding year's liability was under £1,000, or where
 * 80% or more of that liability was met by deduction at source. The second
 * test needs facts this function is not given, so it is passed in as
 * `deductedAtSourceRatio` and defaults to nil.
 *
 * `priorYearLiability` must be the DECLARED figure from the filed prior-year
 * return. Passing an estimate here would charge money no return reported.
 */
export function paymentsOnAccount(args: {
  entityId: string;
  taxYear: string;
  priorTaxYear: string;
  priorYearLiability: number | null;
  /** 31 January in the tax year. */
  firstDue: Date;
  /** 31 July after it. */
  secondDue: Date;
  deductedAtSourceRatio?: number;
}): Liability[] {
  const base = args.priorYearLiability;
  if (base === null || base < 1000) return [];
  if ((args.deductedAtSourceRatio ?? 0) >= 0.8) return [];

  const half = r2(base / 2);
  const detail = `50% of the ${args.priorTaxYear} liability of ${base}`;
  const make = (n: 1 | 2, dueDate: Date): Liability => ({
    id: `${args.entityId}|SA|${args.taxYear}|poa${n}`,
    entityId: args.entityId,
    taxType: 'SA',
    periodKey: args.taxYear,
    kind: 'payment_on_account',
    label: `${n === 1 ? 'First' : 'Second'} payment on account ${args.taxYear}`,
    detail,
    amount: half,
    dueDate,
  });
  return [make(1, args.firstDue), make(2, args.secondDue)];
}

/**
 * Corporation Tax quarterly instalments — SI 1998/3175 reg 5.
 *
 * Due 6 months and 13 days after the START of the accounting period, then at
 * three-month intervals. For a 12-month period that puts the last instalment 3
 * months and 14 days after the period end, which is the cross-check.
 *
 * These are charged on an ESTIMATE by design: the money is due long before the
 * CT600 exists. They are flagged `isEstimated` so nothing presents one as a
 * declared figure, and they reconcile when the return is filed.
 */
export function quarterlyInstalments(args: {
  entityId: string;
  periodKey: string;
  periodStart: Date;
  estimatedLiability: number;
  count?: number;
}): Liability[] {
  const n = args.count ?? 4;
  const each = r2(args.estimatedLiability / n);
  const out: Liability[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(args.periodStart.getTime());
    d.setUTCMonth(d.getUTCMonth() + 6 + 3 * i);
    d.setUTCDate(d.getUTCDate() + 13);
    out.push({
      id: `${args.entityId}|CT|${args.periodKey}|qip${i + 1}`,
      entityId: args.entityId,
      taxType: 'CT',
      periodKey: args.periodKey,
      kind: 'quarterly_instalment',
      label: `Corporation Tax instalment ${i + 1} of ${n}`,
      detail: `Estimated — ${each} of ${args.estimatedLiability} on current figures`,
      amount: each,
      dueDate: d,
      isEstimated: true,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Allocation and balances                                                    */
/* -------------------------------------------------------------------------- */

const sign = (p: Payment): number => (p.direction === 'from_hmrc' ? -1 : 1);

export function allocatedTo(liabilityId: string, payments: Payment[]): number {
  let t = 0;
  for (const p of payments) {
    for (const a of p.allocations) {
      if (a.liabilityId === liabilityId) t += sign(p) * a.amount;
    }
  }
  return r2(t);
}

export function outstandingOf(l: Liability, payments: Payment[]): number {
  return r2(l.amount - allocatedTo(l.id, payments));
}

/**
 * Money paid over and above any named debt. HMRC holds it. It is a real
 * position and is reported separately — never netted silently against an
 * unrelated liability, and never treated as having nothing to pay.
 */
export function creditOnAccount(payments: Payment[]): number {
  let t = 0;
  for (const p of payments) {
    const allocated = p.allocations.reduce((a, b) => a + b.amount, 0);
    t += sign(p) * r2(p.amount - allocated);
  }
  return r2(t);
}

export interface AccountPosition {
  charged: number;
  paid: number;
  outstanding: number;
  credit: number;
  /** Outstanding less money already sitting on account. */
  net: number;
  overdue: number;
  openLiabilities: Liability[];
  nextDue: Liability | null;
}

export function accountPosition(
  liabilities: Liability[],
  payments: Payment[],
  asAt: Date,
): AccountPosition {
  const charged = r2(liabilities.reduce((a, l) => a + l.amount, 0));
  const paid = r2(liabilities.reduce((a, l) => a + allocatedTo(l.id, payments), 0));
  const open = liabilities
    .filter((l) => outstandingOf(l, payments) > EPS)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const overdue = r2(
    open.filter((l) => l.dueDate < asAt).reduce((a, l) => a + outstandingOf(l, payments), 0),
  );
  const credit = creditOnAccount(payments);
  return {
    charged,
    paid,
    outstanding: r2(charged - paid),
    credit,
    net: r2(charged - paid - credit),
    overdue,
    openLiabilities: open,
    nextDue: open[0] ?? null,
  };
}

/**
 * Allocate a payment across open liabilities, oldest debt first.
 *
 * This is how a payment reaching HMRC with no instruction is applied, and it
 * is the right default because interest runs from the oldest due date. It is a
 * SUGGESTION: the caller is free to override it, and anything not allocated
 * stays as money on account rather than being forced onto a debt.
 */
export function allocateOldestFirst(
  amount: number,
  liabilities: Liability[],
  payments: Payment[],
): Allocation[] {
  const open = liabilities
    .map((l) => ({ l, out: outstandingOf(l, payments) }))
    .filter((x) => x.out > EPS)
    .sort((a, b) => a.l.dueDate.getTime() - b.l.dueDate.getTime());

  let remaining = r2(amount);
  const out: Allocation[] = [];
  for (const x of open) {
    if (remaining <= EPS) break;
    const take = r2(Math.min(x.out, remaining));
    out.push({ liabilityId: x.l.id, amount: take });
    remaining = r2(remaining - take);
  }
  return out;
}

/**
 * Guard for the one invariant allocation must never break: you cannot allocate
 * more of a payment than the payment was for.
 */
export function validateAllocations(payment: Payment): { ok: boolean; reason?: string } {
  const total = r2(payment.allocations.reduce((a, b) => a + b.amount, 0));
  if (total > r2(payment.amount) + EPS) {
    return { ok: false, reason: `Allocated ${total} exceeds the payment of ${payment.amount}` };
  }
  if (payment.allocations.some((a) => a.amount <= 0)) {
    return { ok: false, reason: 'An allocation must be positive' };
  }
  const seen = new Set<string>();
  for (const a of payment.allocations) {
    if (seen.has(a.liabilityId)) {
      return { ok: false, reason: `Two allocations to ${a.liabilityId}` };
    }
    seen.add(a.liabilityId);
  }
  return { ok: true };
}

/**
 * Returns whose filing deadline has passed and which have not been filed.
 *
 * Bounded by a lookback, because a deadline that passed before the portal
 * existed cannot be known to have been missed. Reporting three years of
 * "not filed" on a fresh install trains you to ignore the flag.
 */
export function returnsNotFiled(
  returns: TaxReturn[],
  asAt: Date,
  lookbackDays = 90,
): TaxReturn[] {
  const floor = new Date(asAt.getTime() - lookbackDays * 86400000);
  return returns.filter((r) => r.status !== 'filed' && r.fileBy < asAt && r.fileBy >= floor);
}
