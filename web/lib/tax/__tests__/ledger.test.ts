import { describe, it, expect } from 'vitest';
import {
  chargeFromReturn,
  declaredVariance,
  paymentsOnAccount,
  quarterlyInstalments,
  allocatedTo,
  outstandingOf,
  creditOnAccount,
  accountPosition,
  allocateOldestFirst,
  validateAllocations,
  returnsNotFiled,
  type TaxReturn,
  type Liability,
  type Payment,
} from '../ledger.js';

const d = (s: string): Date => new Date(s + 'T00:00:00.000Z');

const aReturn = (over: Partial<TaxReturn> = {}): TaxReturn => ({
  id: 'r1',
  entityId: 'e1',
  taxType: 'VAT',
  periodKey: '2026-06-30',
  periodEnd: d('2026-06-30'),
  fileBy: d('2026-08-07'),
  payBy: d('2026-08-07'),
  status: 'filed',
  declaredAmount: 8400,
  filedOn: d('2026-08-04'),
  ...over,
});

const aPayment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1',
  entityId: 'e1',
  taxType: 'VAT',
  amount: 3000,
  paidOn: d('2026-08-06'),
  direction: 'to_hmrc',
  allocations: [],
  ...over,
});

describe('a liability exists only because a return declared it', () => {
  it('charges nothing for a return that is not filed', () => {
    expect(chargeFromReturn(aReturn({ status: 'ready_to_file' }))).toBeNull();
    expect(chargeFromReturn(aReturn({ status: 'in_progress' }))).toBeNull();
  });

  it('charges nothing for a return filed without a declared amount', () => {
    // This is the migration case: an old "mark filed" tick carried no figure.
    // It must not silently charge zero and it must not charge an estimate.
    const r = aReturn({ declaredAmount: null, estimateAmount: 8400 });
    expect(chargeFromReturn(r)).toBeNull();
  });

  it('never charges the estimate, even when one is recorded', () => {
    const r = aReturn({ status: 'in_progress', declaredAmount: null, estimateAmount: 9999 });
    expect(chargeFromReturn(r)).toBeNull();
  });

  it('charges the declared amount, due on the payment date not the filing date', () => {
    const r = aReturn({ payBy: d('2026-08-07'), filedOn: d('2026-08-04') });
    const l = chargeFromReturn(r)!;
    expect(l.amount).toBe(8400);
    expect(l.kind).toBe('return_charge');
    expect(l.dueDate).toEqual(d('2026-08-07'));
    expect(l.returnId).toBe('r1');
  });
});

describe('declared vs computed', () => {
  it('reports the variance where both exist', () => {
    expect(declaredVariance(aReturn({ declaredAmount: 8400, estimateAmount: 8150 }))).toBe(250);
  });
  it('is null where the engine never ran, rather than reporting the whole amount', () => {
    // Showing "£8,400 above the computed £0" when no inputs were entered is a
    // fabricated disagreement.
    expect(declaredVariance(aReturn({ estimateAmount: null }))).toBeNull();
    expect(declaredVariance(aReturn({ estimateAmount: undefined }))).toBeNull();
  });
  it('is null for an unfiled return', () => {
    expect(declaredVariance(aReturn({ status: 'ready_to_file', estimateAmount: 100 }))).toBeNull();
  });
  it('reports agreement as 0, not as null', () => {
    expect(declaredVariance(aReturn({ declaredAmount: 8400, estimateAmount: 8400 }))).toBe(0);
  });
});

describe('payments on account — TMA 1970 s.59A', () => {
  const base = {
    entityId: 'e1',
    taxYear: '2025-26',
    priorTaxYear: '2024-25',
    firstDue: d('2026-01-31'),
    secondDue: d('2026-07-31'),
  };

  it('charges two halves of the PRIOR year declared liability', () => {
    const poas = paymentsOnAccount({ ...base, priorYearLiability: 19000 });
    expect(poas).toHaveLength(2);
    expect(poas.map((p) => p.amount)).toEqual([9500, 9500]);
    expect(poas[0]!.dueDate).toEqual(d('2026-01-31'));
    expect(poas[1]!.dueDate).toEqual(d('2026-07-31'));
    expect(poas[0]!.kind).toBe('payment_on_account');
  });

  it('arises with no current-year return in existence at all', () => {
    // The point of the whole layer: this money is due before the return.
    const poas = paymentsOnAccount({ ...base, priorYearLiability: 19000 });
    expect(poas.every((p) => p.returnId === undefined)).toBe(true);
  });

  it('does not arise where the prior year was under £1,000', () => {
    expect(paymentsOnAccount({ ...base, priorYearLiability: 999.99 })).toHaveLength(0);
    expect(paymentsOnAccount({ ...base, priorYearLiability: 1000 })).toHaveLength(2);
  });

  it('does not arise where 80% or more was deducted at source', () => {
    expect(
      paymentsOnAccount({ ...base, priorYearLiability: 19000, deductedAtSourceRatio: 0.8 }),
    ).toHaveLength(0);
    expect(
      paymentsOnAccount({ ...base, priorYearLiability: 19000, deductedAtSourceRatio: 0.79 }),
    ).toHaveLength(2);
  });

  it('does not arise where the prior year was never filed', () => {
    expect(paymentsOnAccount({ ...base, priorYearLiability: null })).toHaveLength(0);
  });
});

describe('the balancing payment falls out of the arithmetic', () => {
  it('is declared less the payments on account already charged', () => {
    const poas = paymentsOnAccount({
      entityId: 'e1',
      taxYear: '2025-26',
      priorTaxYear: '2024-25',
      priorYearLiability: 19000,
      firstDue: d('2026-01-31'),
      secondDue: d('2026-07-31'),
    });
    const ret = aReturn({
      taxType: 'SA',
      periodKey: '2025-26',
      declaredAmount: 23000,
      payBy: d('2027-01-31'),
    });
    const bal = chargeFromReturn(ret, poas)!;
    expect(bal.amount).toBe(4000);
    expect(bal.kind).toBe('balancing_payment');
    expect(bal.dueDate).toEqual(d('2027-01-31'));
  });

  it('is negative — a repayment — where the payments on account overshot', () => {
    const poas = paymentsOnAccount({
      entityId: 'e1',
      taxYear: '2025-26',
      priorTaxYear: '2024-25',
      priorYearLiability: 19000,
      firstDue: d('2026-01-31'),
      secondDue: d('2026-07-31'),
    });
    const ret = aReturn({ taxType: 'SA', periodKey: '2025-26', declaredAmount: 12000 });
    const bal = chargeFromReturn(ret, poas)!;
    expect(bal.amount).toBe(-7000);
    expect(bal.label).toMatch(/repayment/i);
  });

  it('creates nothing where the payments on account exactly covered the year', () => {
    const poas = paymentsOnAccount({
      entityId: 'e1',
      taxYear: '2025-26',
      priorTaxYear: '2024-25',
      priorYearLiability: 19000,
      firstDue: d('2026-01-31'),
      secondDue: d('2026-07-31'),
    });
    const ret = aReturn({ taxType: 'SA', periodKey: '2025-26', declaredAmount: 19000 });
    expect(chargeFromReturn(ret, poas)).toBeNull();
  });
});

describe('quarterly instalments — SI 1998/3175', () => {
  it('falls due 6 months and 13 days after the period START, then quarterly', () => {
    const q = quarterlyInstalments({
      entityId: 'e1',
      periodKey: '2026-03-31',
      periodStart: d('2025-04-01'),
      estimatedLiability: 400000,
    });
    expect(q.map((x) => x.dueDate.toISOString().slice(0, 10))).toEqual([
      '2025-10-14',
      '2026-01-14',
      '2026-04-14',
      '2026-07-14',
    ]);
  });

  it('puts the last instalment 3 months and 14 days after a 12-month period end', () => {
    // The statutory cross-check on the interval arithmetic, and a trap worth
    // keeping a test on: "3 months after 31 March" is 30 June, not 1 July.
    // Naive month arithmetic overflows the 31st into the next month and shifts
    // the deadline a day, which is how a payment ends up recorded as late.
    const q = quarterlyInstalments({
      entityId: 'e1',
      periodKey: '2026-03-31',
      periodStart: d('2025-04-01'),
      estimatedLiability: 400000,
    });
    const periodEnd = d('2026-03-31');
    const threeMonthsOn = new Date(
      Date.UTC(
        periodEnd.getUTCFullYear(),
        periodEnd.getUTCMonth() + 4, // day 0 of the month after = its last day
        0,
      ),
    );
    expect(threeMonthsOn.toISOString().slice(0, 10)).toBe('2026-06-30');
    const expected = new Date(threeMonthsOn.getTime());
    expected.setUTCDate(expected.getUTCDate() + 14);
    expect(expected.toISOString().slice(0, 10)).toBe('2026-07-14');
    expect(q[3]!.dueDate).toEqual(expected);
  });

  it('handles a period not starting on the first of a month', () => {
    const q = quarterlyInstalments({
      entityId: 'e1',
      periodKey: '2026-04-04',
      periodStart: d('2025-04-05'),
      estimatedLiability: 400000,
    });
    // 5 April + 6 months = 5 October, + 13 days = 18 October. NOT the 14th:
    // the rule is an interval from the start date, not a fixed day of a month.
    expect(q[0]!.dueDate.toISOString().slice(0, 10)).toBe('2025-10-18');
  });

  it('is flagged as an estimate, because the return comes long after the money', () => {
    const q = quarterlyInstalments({
      entityId: 'e1',
      periodKey: '2026-03-31',
      periodStart: d('2025-04-01'),
      estimatedLiability: 400000,
    });
    expect(q.every((x) => x.isEstimated)).toBe(true);
    expect(q.every((x) => x.returnId === undefined)).toBe(true);
  });
});

describe('allocation and outstanding', () => {
  const charge = (): Liability => ({
    id: 'L1',
    entityId: 'e1',
    taxType: 'VAT',
    periodKey: '2026-06-30',
    kind: 'return_charge',
    label: 'VAT declared',
    amount: 8400,
    dueDate: d('2026-08-07'),
    returnId: 'r1',
  });

  it('leaves a part payment outstanding for the balance', () => {
    const p = aPayment({ amount: 3000, allocations: [{ liabilityId: 'L1', amount: 3000 }] });
    expect(allocatedTo('L1', [p])).toBe(3000);
    expect(outstandingOf(charge(), [p])).toBe(5400);
  });

  it('counts an unallocated payment as money on account, not as settling the debt', () => {
    const p = aPayment({ amount: 3000, allocations: [] });
    expect(outstandingOf(charge(), [p])).toBe(8400);
    expect(creditOnAccount([p])).toBe(3000);
  });

  it('treats a repayment received as reducing what is on account', () => {
    const paid = aPayment({ id: 'p1', amount: 5000, allocations: [] });
    const back = aPayment({ id: 'p2', amount: 2000, direction: 'from_hmrc', allocations: [] });
    expect(creditOnAccount([paid, back])).toBe(3000);
  });

  it('reverses an allocated repayment against the liability it was drawn from', () => {
    const paid = aPayment({ id: 'p1', amount: 8400, allocations: [{ liabilityId: 'L1', amount: 8400 }] });
    const back = aPayment({
      id: 'p2',
      amount: 1400,
      direction: 'from_hmrc',
      allocations: [{ liabilityId: 'L1', amount: 1400 }],
    });
    expect(allocatedTo('L1', [paid, back])).toBe(7000);
    expect(outstandingOf(charge(), [paid, back])).toBe(1400);
  });

  it('allocates oldest first, which is where interest runs from', () => {
    const older: Liability = { ...charge(), id: 'L0', amount: 2000, dueDate: d('2026-05-07') };
    const alloc = allocateOldestFirst(5000, [charge(), older], []);
    expect(alloc).toEqual([
      { liabilityId: 'L0', amount: 2000 },
      { liabilityId: 'L1', amount: 3000 },
    ]);
  });

  it('leaves the surplus unallocated rather than forcing it onto a debt', () => {
    const alloc = allocateOldestFirst(10000, [charge()], []);
    expect(alloc).toEqual([{ liabilityId: 'L1', amount: 8400 }]);
    const p = aPayment({ amount: 10000, allocations: alloc });
    expect(creditOnAccount([p])).toBe(1600);
  });

  it('skips liabilities already settled by an earlier payment', () => {
    const settled = aPayment({ id: 'p0', amount: 8400, allocations: [{ liabilityId: 'L1', amount: 8400 }] });
    expect(allocateOldestFirst(500, [charge()], [settled])).toEqual([]);
  });

  it('refuses to allocate more of a payment than the payment was for', () => {
    const p = aPayment({ amount: 3000, allocations: [{ liabilityId: 'L1', amount: 3500 }] });
    expect(validateAllocations(p).ok).toBe(false);
  });

  it('refuses two allocations to the same liability', () => {
    const p = aPayment({
      amount: 3000,
      allocations: [
        { liabilityId: 'L1', amount: 1000 },
        { liabilityId: 'L1', amount: 1000 },
      ],
    });
    expect(validateAllocations(p).ok).toBe(false);
  });
});

describe('the account position', () => {
  const asAt = d('2026-09-01');
  const liabs: Liability[] = [
    {
      id: 'L1', entityId: 'e1', taxType: 'SA', periodKey: '2025-26',
      kind: 'payment_on_account', label: 'First payment on account',
      amount: 9500, dueDate: d('2026-01-31'),
    },
    {
      id: 'L2', entityId: 'e1', taxType: 'SA', periodKey: '2025-26',
      kind: 'payment_on_account', label: 'Second payment on account',
      amount: 9500, dueDate: d('2026-07-31'),
    },
  ];

  it('reports charged, paid and outstanding as arithmetic', () => {
    const p = aPayment({ taxType: 'SA', amount: 9500, allocations: [{ liabilityId: 'L1', amount: 9500 }] });
    const A = accountPosition(liabs, [p], asAt);
    expect(A.charged).toBe(19000);
    expect(A.paid).toBe(9500);
    expect(A.outstanding).toBe(9500);
    expect(A.nextDue?.id).toBe('L2');
  });

  it('reports what is overdue separately from what is merely outstanding', () => {
    const A = accountPosition(liabs, [], asAt);
    // Both fell due before 1 September 2026.
    expect(A.overdue).toBe(19000);
    const early = accountPosition(liabs, [], d('2026-03-01'));
    expect(early.overdue).toBe(9500);
  });

  it('does not let money on account hide an unpaid debt', () => {
    // £9,500 sitting unallocated does not make the first instalment paid.
    const p = aPayment({ taxType: 'SA', amount: 9500, allocations: [] });
    const A = accountPosition(liabs, [p], asAt);
    expect(A.outstanding).toBe(19000);
    expect(A.overdue).toBe(19000);
    expect(A.credit).toBe(9500);
    // net is the honest headline: owed, less what HMRC is already holding.
    expect(A.net).toBe(9500);
  });

  it('is nil across the board where nothing has been charged', () => {
    const A = accountPosition([], [], asAt);
    expect(A).toMatchObject({ charged: 0, paid: 0, outstanding: 0, overdue: 0, nextDue: null });
  });
});

describe('returns not filed', () => {
  const asAt = d('2026-09-01');
  const r = (key: string, fileBy: string, status: TaxReturn['status'] = 'not_started') =>
    aReturn({ id: key, periodKey: key, fileBy: d(fileBy), status, declaredAmount: null });

  it('counts a missed deadline inside the lookback', () => {
    const out = returnsNotFiled([r('2026-06-30', '2026-08-07')], asAt);
    expect(out.map((x) => x.id)).toEqual(['2026-06-30']);
  });

  it('ignores a deadline that passed before the portal could have known', () => {
    // A fresh install showing three years of "not filed" trains you to ignore
    // the flag, which is worse than showing nothing.
    const out = returnsNotFiled([r('2023-09-30', '2023-11-07')], asAt);
    expect(out).toHaveLength(0);
  });

  it('ignores a deadline that has not arrived', () => {
    expect(returnsNotFiled([r('2026-09-30', '2026-11-07')], asAt)).toHaveLength(0);
  });

  it('ignores a return that was filed', () => {
    const filed = aReturn({ fileBy: d('2026-08-07'), status: 'filed', declaredAmount: 8400 });
    expect(returnsNotFiled([filed], asAt)).toHaveLength(0);
  });
});
