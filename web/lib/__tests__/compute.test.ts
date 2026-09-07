import { describe, it, expect } from 'vitest';
import { compute, FIELDS, type Inputs } from '../compute';
import { inputKey } from '../db/computations';
import { computeCorporationTax } from '../tax/corporation-tax';
import type { Slot } from '../db/slots';
import type { EntityRow } from '../db/queries';

const company: EntityRow = {
  id: 'e1', slug: 'ardent', name: 'Ardent Ltd', type: 'company',
  company_number: '12345678', utr: null, vrn: null, ni_number: null,
  year_end_month: 3, year_end_day: 31,
  vat_registered: true, vat_stagger: '3',
  trading_status: 'trading', is_close_investment_holding_company: false, active: true,
};

const person: EntityRow = { ...company, id: 'e2', slug: 'gareth', name: 'Gareth', type: 'individual' };

const slot = (over: Partial<Slot> = {}): Slot => ({
  taxType: 'CT',
  periodKey: '2027-03-31',
  periodStart: new Date(Date.UTC(2026, 3, 1)),
  periodEnd: new Date(Date.UTC(2027, 2, 31)),
  fileBy: new Date(Date.UTC(2028, 2, 31)),
  payBy: new Date(Date.UTC(2028, 0, 1)),
  label: 'CT600', short: 'Y/E 31 Mar 2027',
  ...over,
});

describe('corporation tax screen', () => {
  it('bridges the accounts to taxable total profits', () => {
    const i: Inputs = { profitBeforeTax: 100_000, addBacks: 12_000, deductions: 30_000 };
    const r = compute('CT', i, slot(), company);
    const ttp = r.lines.find((l) => l.label === 'Taxable total profits (N)');
    expect(ttp?.value).toBe(82_000);
  });

  it('agrees with the engine called directly', () => {
    const i: Inputs = { profitBeforeTax: 200_000, addBacks: 0, deductions: 0, associatedCompanies: 1 };
    const direct = computeCorporationTax({
      periodStart: new Date(Date.UTC(2026, 3, 1)),
      periodEnd: new Date(Date.UTC(2027, 2, 31)),
      taxableTotalProfits: 200_000,
      distributionsReceived: 0,
      associationDivisor: 2,
      isCloseInvestmentHoldingCompany: false,
    });
    expect(compute('CT', i, slot(), company).figure).toBe(direct.taxDue);
  });

  it('warns that distributions raise the limits tested without raising the profit taxed', () => {
    const withDist = compute('CT', { profitBeforeTax: 60_000, distributionsReceived: 40_000 }, slot(), company);
    const without = compute('CT', { profitBeforeTax: 60_000 }, slot(), company);
    const n = (r: typeof withDist) => r.lines.find((l) => l.label === 'Taxable total profits (N)')!.value;
    const a = (r: typeof withDist) => r.lines.find((l) => l.label === 'Augmented profits (A)')!.value;

    expect(n(withDist)).toBe(n(without));       // the profit taxed is unchanged
    expect(a(withDist)).toBeGreaterThan(a(without)); // the measure tested is not
  });

  it('denies the small profits rate to a close investment holding company', () => {
    const cihc = { ...company, is_close_investment_holding_company: true };
    const r = compute('CT', { profitBeforeTax: 20_000 }, slot(), cihc);
    expect(r.figure).toBe(5_000); // 20,000 at the main rate, no relief
    expect(r.warnings.join(' ')).toMatch(/close investment holding/i);
  });
});

describe('VAT screen', () => {
  const s = slot({ taxType: 'VAT', periodKey: '2026-09-30', periodEnd: new Date(Date.UTC(2026, 8, 30)) });

  it('derives box 3 and box 5, and leaves the value boxes out of the sum', () => {
    const r = compute('VAT', { box1: 20_000, box2: 500, box4: 6_000, box6: 100_000, box7: 30_000 }, s, company);
    expect(r.lines.find((l) => l.label.startsWith('Box 3'))?.value).toBe(20_500);
    expect(r.figure).toBe(14_500);
  });

  it('treats a negative box 5 as a repayment, not a payment', () => {
    const r = compute('VAT', { box1: 1_000, box4: 4_000 }, s, company);
    expect(r.figure).toBe(-3_000);
    expect(r.figureLabel).toMatch(/repayable/i);
    expect(r.warnings.join(' ')).toMatch(/repayment claim/i);
  });
});

describe('PAYE screen', () => {
  const s = slot({ taxType: 'PAYE', periodKey: '2026-08-05', periodEnd: new Date(Date.UTC(2026, 7, 5)) });

  it('adds the deductions and takes off the allowance and the recoveries', () => {
    const r = compute('PAYE', {
      grossPay: 10_000, incomeTax: 1_800, employeeNic: 600, employerNic: 900,
      studentLoan: 120, employmentAllowanceUsed: 900, statutoryRecoveries: 100,
    }, s, company);
    expect(r.figure).toBe(1_800 + 600 + 900 + 120 - 900 - 100);
  });

  it('does not let gross pay reach the amount payable', () => {
    const a = compute('PAYE', { incomeTax: 500 }, s, company).figure;
    const b = compute('PAYE', { incomeTax: 500, grossPay: 99_999 }, s, company).figure;
    expect(a).toBe(b);
  });

  it('runs the director annual check without changing what is payable', () => {
    const base = compute('PAYE', { employerNic: 100 }, s, company);
    const checked = compute('PAYE', { employerNic: 100, directorAnnualPay: 12_570 }, s, company);
    expect(checked.figure).toBe(base.figure);
    expect(checked.lines.some((l) => /employee NIC/i.test(l.label) && /12,570/.test(l.label))).toBe(true);
  });
});

describe('self assessment screen', () => {
  const s = slot({ taxType: 'SA', periodKey: '2026-27', periodEnd: new Date(Date.UTC(2027, 3, 5)) });

  it('takes tax deducted off the balance but not off the liability', () => {
    const r = compute('SA', { employment: 60_000, taxDeductedAtSource: 5_000 }, s, person);
    const liability = r.lines.find((l) => l.label === 'Income tax liability')!.value;
    const balance = r.lines.find((l) => l.label === 'Balance')!.value;
    expect(r.figure).toBe(liability);
    expect(balance).toBeCloseTo(liability - 5_000, 2);
  });

  it('flags allowance lost to the taper', () => {
    const r = compute('SA', { employment: 110_000 }, s, person);
    expect(r.warnings.join(' ')).toMatch(/personal allowance is lost to the taper/i);
  });

  it('reports a missing rate table rather than throwing', () => {
    const old = slot({ taxType: 'SA', periodKey: '2019-20', periodEnd: new Date(Date.UTC(2020, 3, 5)) });
    const r = compute('SA', { employment: 30_000 }, old, person);
    expect(r.figure).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/no income tax rates/i);
  });
});

describe('figures stay in their own period', () => {
  it('keys inputs by tax AND period, so one year cannot read another', () => {
    const keys = new Set([
      inputKey('SA', '2025-26'), inputKey('SA', '2026-27'),
      inputKey('CT', '2026-27'), inputKey('PAYE', '2026-27'),
    ]);
    expect(keys.size).toBe(4);
  });

  it('computes only from the inputs handed to it', () => {
    // The screen is a pure function of (tax, inputs, slot, entity). There is no
    // path by which a figure saved against another period can reach it — which
    // is the failure the prototype had, where pay entered for one year showed
    // in every year.
    const s = slot({ taxType: 'SA', periodKey: '2026-27', periodEnd: new Date(Date.UTC(2027, 3, 5)) });
    const empty = compute('SA', {}, s, person);
    expect(empty.figure).toBe(0);
  });
});

describe('field definitions', () => {
  it('defines fields for every tax with a screen', () => {
    for (const t of ['CT', 'VAT', 'PAYE', 'SA'] as const) {
      expect(FIELDS[t]?.length).toBeGreaterThan(0);
    }
  });

  it('names each field once per tax, since the name is the JSON key', () => {
    for (const [tax, fields] of Object.entries(FIELDS)) {
      const names = (fields ?? []).map((f) => f.name);
      expect(new Set(names).size, tax).toBe(names.length);
    }
  });
});
