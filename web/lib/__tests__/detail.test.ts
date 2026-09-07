import { describe, it, expect } from 'vitest';
import { propertyPosition, figuresFor, type Property } from '../db/properties';
import { payFor, type Person } from '../db/payroll';
import { compute } from '../compute';
import type { Slot } from '../db/slots';
import type { EntityRow } from '../db/queries';

const person: EntityRow = {
  id: 'e2', slug: 'gareth', name: 'Gareth', type: 'individual',
  company_number: null, utr: null, vrn: null, ni_number: null,
  year_end_month: null, year_end_day: null,
  vat_registered: false, vat_stagger: null,
  trading_status: 'trading', is_close_investment_holding_company: false, active: true,
};

const saSlot = (taxYear: string): Slot => ({
  taxType: 'SA', periodKey: taxYear,
  periodStart: undefined,
  periodEnd: new Date(Date.UTC(Number(taxYear.slice(0, 4)) + 1, 3, 5)),
  fileBy: new Date(Date.UTC(Number(taxYear.slice(0, 4)) + 2, 0, 31)),
  payBy: new Date(Date.UTC(Number(taxYear.slice(0, 4)) + 2, 0, 31)),
  label: 'Self Assessment', short: taxYear.replace('-', '/'),
});

const property = (over: Partial<Property> = {}): Property => ({
  id: 'p1', entityId: 'e2', name: 'Flat 2', address: null,
  ownershipPct: 100, jointlyHeld: false, form17InForce: false, form17Dated: null,
  isFurnishedHolidayLet: false,
  figures: new Map(),
  ...over,
});

const figures = (taxYear: string, rent: number, expenses = 0, finance = 0) =>
  new Map([[taxYear, { taxYear, rentReceived: rent, allowableExpenses: expenses, financeCosts: finance, notes: null }]]);

describe('property income by tax year', () => {
  it('reads only the year asked for', () => {
    const p = property({ figures: figures('2026-27', 24_000, 4_000) });
    expect(propertyPosition([p], '2026-27').profit).toBe(20_000);
    expect(propertyPosition([p], '2025-26').profit).toBe(0);
    expect(propertyPosition([p], '2025-26').anyFigures).toBe(false);
  });

  it('holds finance costs apart from expenses', () => {
    const p = property({ figures: figures('2026-27', 24_000, 4_000, 6_000) });
    const pos = propertyPosition([p], '2026-27');
    expect(pos.profit).toBe(20_000);       // finance costs NOT deducted
    expect(pos.financeCosts).toBe(6_000);
  });
});

describe('jointly held property', () => {
  it('taxes 50% by default whatever the beneficial share', () => {
    const p = property({ ownershipPct: 90, jointlyHeld: true, form17InForce: false, figures: figures('2026-27', 20_000) });
    const pos = propertyPosition([p], '2026-27');
    expect(pos.profit).toBe(10_000);
    expect(pos.notes.join(' ')).toMatch(/no Form 17 in force/i);
  });

  it('taxes the actual share once a Form 17 is in force', () => {
    const p = property({ ownershipPct: 90, jointlyHeld: true, form17InForce: true, figures: figures('2026-27', 20_000) });
    expect(propertyPosition([p], '2026-27').profit).toBe(18_000);
  });

  it('leaves a solely held property at its recorded share', () => {
    const p = property({ ownershipPct: 100, jointlyHeld: false, figures: figures('2026-27', 20_000) });
    expect(propertyPosition([p], '2026-27').profit).toBe(20_000);
  });

  it('adds up across properties', () => {
    const a = property({ id: 'a', name: 'A', figures: figures('2026-27', 10_000) });
    const b = property({ id: 'b', name: 'B', ownershipPct: 50, jointlyHeld: true, figures: figures('2026-27', 8_000, 1_000) });
    expect(propertyPosition([a, b], '2026-27').profit).toBe(10_000 + 3_500);
  });
});

describe('recorded figures reach the return', () => {
  it('overrides the typed property total rather than adding to it', () => {
    const s = saSlot('2026-27');
    const typedOnly = compute('SA', { property: 50_000 }, s, person);
    const fromDetail = compute('SA', { property: 50_000 }, s, person, {
      propertyProfit: 20_000, propertyFinanceCosts: 0, propertyCount: 1,
    });

    expect(fromDetail.figure).toBeLessThan(typedOnly.figure!);
    // and it equals the same computation done with the recorded figure typed in
    expect(fromDetail.figure).toBe(compute('SA', { property: 20_000 }, s, person).figure);
    expect(fromDetail.warnings.join(' ')).toMatch(/comes from the property recorded/i);
  });

  it('falls back to the typed total when nothing is recorded', () => {
    const s = saSlot('2026-27');
    expect(compute('SA', { property: 20_000 }, s, person, {}).figure)
      .toBe(compute('SA', { property: 20_000 }, s, person).figure);
  });
});

describe('pay by tax year', () => {
  const p: Person = {
    id: 'x', entityId: 'e1', name: 'K L Williams', isDirector: true,
    directorshipStartedOn: null, startedOn: null, leftOn: null, individualEntityId: null,
    pay: new Map([['2026-27', { taxYear: '2026-27', annualPay: 6_000, benefitsInKind: 0, notes: null }]]),
  };

  it('is nil in a year with no row, not carried across', () => {
    // The prototype's bug: £6,000 entered for one year appeared in every year.
    expect(payFor(p, '2026-27').annualPay).toBe(6_000);
    expect(payFor(p, '2025-26').annualPay).toBe(0);
    expect(payFor(p, '2027-28').annualPay).toBe(0);
  });
});

describe('figuresFor', () => {
  it('returns zeros rather than undefined for an unrecorded year', () => {
    const f = figuresFor(property(), '2026-27');
    expect(f).toEqual({ taxYear: '2026-27', rentReceived: 0, allowableExpenses: 0, financeCosts: 0, notes: null });
  });
});
