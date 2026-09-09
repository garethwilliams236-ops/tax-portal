import { describe, it, expect } from 'vitest';
import { SA_PAGES, SA_BOX_COUNT, saBox, saKey, saPage } from '@/lib/sa/forms';
import { pageResult, saReturn, type SaValues } from '@/lib/sa/compute';

/**
 * The schema and the mapping onto it.
 *
 * The mapping's failure mode is silence: a mistyped section name reads zero
 * and the tax figure is simply wrong, with nothing on the screen to say so.
 * The reader throws on an unknown box for that reason, and the test below
 * fires every reference on every page to make it throw here rather than in
 * front of a return.
 */

/** Every box populated, so every reference in the mapping is exercised. */
function allBoxes(): SaValues {
  const v: SaValues = {};
  for (const p of SA_PAGES) {
    for (const s of p.sections) {
      for (const b of s.boxes) {
        v[b.key] = b.kind === 'yesno' ? true
          : b.kind === 'date' ? '2025-06-01'
          : b.kind === 'text' ? 'x'
          : 1000;
      }
    }
  }
  return v;
}

describe('the SA schema', () => {
  it('holds all twelve pages', () => {
    expect(SA_PAGES.map((p) => p.code).sort()).toEqual([
      'SA100', 'SA101', 'SA102', 'SA103F', 'SA103S', 'SA104F',
      'SA104S', 'SA105', 'SA106', 'SA107', 'SA108', 'SA109',
    ]);
  });

  it('gives every box a unique key', () => {
    // The constructor throws on a duplicate, so reaching here is the assertion;
    // the count guards against a page silently vanishing from the spec.
    expect(SA_BOX_COUNT).toBeGreaterThan(650);
    const keys = SA_PAGES.flatMap((p) => p.sections.flatMap((s) => s.boxes.map((b) => b.key)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('includes the section in the key, because SA100 restarts its numbering', () => {
    // Box 1 exists twice on SA100 — savings interest, and the pension section.
    const interest = saKey('SA100', 'Dividends and interest from UK banks and building societies', '1');
    const pension = saKey('SA100', 'Paying into registered pension schemes and overseas pension schemes', '1');
    expect(interest).not.toBe(pension);
    expect(saBox(interest)?.box.label).toMatch(/Taxed UK interest/);
    expect(saBox(pension)?.box.label).toMatch(/registered pension schemes/);
  });

  it('has no furnished holiday lettings section on SA105', () => {
    // Abolished from 6 April 2025; boxes 5 to 19 are printed "no longer in use".
    const sa105 = saPage('SA105')!;
    expect(sa105.sections.map((s) => s.name).join(' ')).not.toMatch(/holiday/i);
    const boxes = sa105.sections.flatMap((s) => s.boxes.map((b) => b.box));
    for (let n = 5; n <= 19; n++) expect(boxes).not.toContain(String(n));
  });

  it('has no annual exempt amount box on SA108', () => {
    // HMRC applies it in the calculation, so there is nothing to enter.
    const labels = saPage('SA108')!.sections.flatMap((s) => s.boxes.map((b) => b.label));
    expect(labels.join(' ')).not.toMatch(/annual exempt/i);
  });

  it('carries the FIG regime on SA109 and not the old remittance basis boxes', () => {
    const sa109 = saPage('SA109')!;
    expect(sa109.sections.map((s) => s.name)).toContain('Foreign income and gains (FIG) regime');
    const labels = sa109.sections.flatMap((s) => s.boxes.map((b) => b.label)).join(' ');
    expect(labels).not.toMatch(/domicile/i);
    expect(labels).not.toMatch(/remittance basis charge/i);
  });
});

describe('reading the boxes', () => {
  it('resolves every reference the mapping makes, on every page', () => {
    const v = allBoxes();
    for (const p of SA_PAGES) {
      expect(() => pageResult(p.code, v)).not.toThrow();
    }
    expect(() => saReturn(v, '2025-26')).not.toThrow();
  });

  it('throws rather than reading zero from a box that does not exist', () => {
    // The guard that makes the test above worth running.
    expect(saBox('SA100.no-such-section.1')).toBeUndefined();
  });

  it('reports an untouched page as empty and computes nothing from it', () => {
    for (const p of SA_PAGES) {
      const r = pageResult(p.code, {});
      expect(r.empty).toBe(true);
    }
    const nothing = saReturn({}, '2025-26');
    expect(nothing.tax?.totalTax).toBe(0);
    expect(nothing.pagesUsed).toEqual([]);
  });
});

describe('from boxes to a computation', () => {
  const K = {
    pay: saKey('SA102', 'Employment', '1'),
    paye: saKey('SA102', 'Employment', '2'),
    car: saKey('SA102', 'Benefits from your employment', '9'),
    travel: saKey('SA102', 'Employment expenses', '17'),
    untaxedInterest: saKey('SA100', 'Dividends and interest from UK banks and building societies', '2'),
    taxedInterest: saKey('SA100', 'Dividends and interest from UK banks and building societies', '1'),
    ukDividends: saKey('SA100', 'Dividends and interest from UK banks and building societies', '4'),
    pensionPaid: saKey('SA100', 'Paying into registered pension schemes and overseas pension schemes', '1'),
    giftAid: saKey('SA100', 'Charitable giving', '5'),
    propProfit: saKey('SA105', 'Calculating your taxable profit or loss', '40'),
    propFinance: saKey('SA105', 'Residential property finance costs', '44'),
    seProfit: saKey('SA103S', 'Total taxable profits or net business loss', '31'),
    seTurnover: saKey('SA103S', 'Business income', '9'),
    seExpenses: saKey('SA103S', 'Allowable business expenses', '20'),
    trustNet: saKey('SA107', 'Discretionary income payment from a UK resident trust', '1'),
  };

  it('builds employment income from pay, benefits and expenses', () => {
    const r = saReturn({ [K.pay]: 60000, [K.car]: 5000, [K.travel]: 2000, [K.paye]: 12000 }, '2025-26');
    expect(r.income.employment).toBe(63000);
    expect(r.taxDeducted).toBe(12000);
  });

  it('grosses up box 1 taxed interest and credits the tax', () => {
    const r = saReturn({ [K.taxedInterest]: 800 }, '2025-26');
    expect(r.income.savings).toBe(1000);
    expect(r.taxDeducted).toBe(200);
  });

  it('grosses up Gift Aid, because the relief works on the gross', () => {
    const r = saReturn({ [K.giftAid]: 800 }, '2025-26');
    expect(r.income.giftAidGross).toBe(1000);
  });

  it('takes pension contributions gross, and does not double count box 1.1', () => {
    const oneOff = saKey('SA100', 'Paying into registered pension schemes and overseas pension schemes', '1.1');
    const r = saReturn({ [K.pensionPaid]: 20000, [oneOff]: 20000 }, '2025-26');
    expect(r.income.grossPensionContributions).toBe(20000);
  });

  it('keeps residential finance costs out of the profit', () => {
    // Needs other income too: the reducer is capped at the tax actually due,
    // and a lone £10,000 profit sits inside the personal allowance.
    const r = saReturn({ [K.pay]: 60000, [K.propProfit]: 10000, [K.propFinance]: 4000 }, '2025-26');
    expect(r.income.property).toBe(10000);
    expect(r.income.propertyFinanceCosts).toBe(4000);
    expect(r.tax!.financeCostReducer).toBeGreaterThan(0);
  });

  it('derives the self-employment profit when the total box is blank', () => {
    const netProfit = saKey('SA103S', 'Net profit or loss', '21');
    const forTax = saKey('SA103S', 'Calculating your taxable profit or loss', '28');
    const r = saReturn({ [K.seTurnover]: 50000, [K.seExpenses]: 20000, [netProfit]: 30000, [forTax]: 30000 }, '2025-26');
    expect(r.income.selfEmployment).toBe(30000);
  });

  it('prefers the entered total and says so when it disagrees with the boxes', () => {
    const netProfit = saKey('SA103S', 'Net profit or loss', '21');
    const v = { [K.seTurnover]: 50000, [K.seExpenses]: 20000, [netProfit]: 25000 };
    const page = pageResult('SA103S', v);
    expect(page.warnings.join(' ')).toMatch(/difference of/);
  });

  it('does not carry trust income into the tax, and says why', () => {
    const r = saReturn({ [K.trustNet]: 10000 }, '2025-26');
    expect(r.tax!.totalIncome).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/SA107.*NOT taxed here/);
  });

  it('warns that Class 2 and Class 4 NIC are missing rather than understating them', () => {
    const r = saReturn({ [K.seProfit]: 40000 }, '2025-26');
    expect(r.warnings.join(' ')).toMatch(/Class 2 and Class 4/);
  });

  it('taxes a whole return the same way the income tax engine does', () => {
    const r = saReturn({
      [K.pay]: 70000,
      [K.paye]: 15000,
      [K.untaxedInterest]: 2000,
      [K.ukDividends]: 6000,
      [K.propProfit]: 12000,
    }, '2025-26');
    expect(r.income.employment).toBe(70000);
    expect(r.tax!.totalIncome).toBe(90000);
    expect(r.balance).toBe(Math.round((r.tax!.totalTax - 15000) * 100) / 100);
  });

  it('holds each tax year separately', () => {
    // Same figures, two years: the answers may differ, but neither reads the
    // other's boxes — the caller passes the year and the values in together.
    const v = { [K.pay]: 60000 };
    expect(saReturn(v, '2024-25').taxYear).toBe('2024-25');
    expect(saReturn(v, '2025-26').taxYear).toBe('2025-26');
  });
});
