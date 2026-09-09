import { describe, it, expect } from 'vitest';
import { computeSelfEmployedNic } from '@/lib/tax/self-employed-nic';
import { selfEmployedNicRates } from '@/lib/tax/rates';

/**
 * Class 2 is the part that is easy to get wrong, because it changed shape on
 * 6 April 2024 and the old shape is still what most guidance describes. There
 * are two bands now, not three, and the trigger is the SMALL profits
 * threshold, not the lower one.
 */

describe('the rate tables', () => {
  it('holds the years the portal can compute, and refuses the ones it cannot', () => {
    for (const y of ['2024-25', '2025-26', '2026-27'] as const) {
      expect(() => selfEmployedNicRates(y)).not.toThrow();
    }
    // The Class 4 limits are legislated frozen through 2027-28, but the
    // Class 2 rate and the SPT have not been laid. Half a table is worse
    // than none, so the year is absent.
    expect(() => selfEmployedNicRates('2027-28')).toThrow(/No self-employed NIC rates/);
  });

  it('carries the Class 4 rate cut to 6% from 6 April 2024', () => {
    expect(selfEmployedNicRates('2024-25').class4MainRate).toBe(0.06);
    expect(selfEmployedNicRates('2025-26').class4MainRate).toBe(0.06);
    expect(selfEmployedNicRates('2026-27').class4MainRate).toBe(0.06);
  });

  it('keeps the Class 4 limits aligned with the employee thresholds', () => {
    for (const y of ['2024-25', '2025-26', '2026-27'] as const) {
      const r = selfEmployedNicRates(y);
      expect(r.class4LowerProfitsLimit).toBe(12_570);
      expect(r.class4UpperProfitsLimit).toBe(50_270);
    }
  });
});

describe('Class 4', () => {
  it('charges nothing at or below the lower profits limit', () => {
    expect(computeSelfEmployedNic({ profits: 12_570 }, '2025-26').class4).toBe(0);
  });

  it('charges the main rate between the limits', () => {
    const r = computeSelfEmployedNic({ profits: 30_000 }, '2025-26');
    expect(r.class4).toBe(Math.round((30_000 - 12_570) * 0.06 * 100) / 100);
  });

  it('charges 2% above the upper profits limit, not the main rate', () => {
    const r = computeSelfEmployedNic({ profits: 80_000 }, '2025-26');
    const main = (50_270 - 12_570) * 0.06;
    const upper = (80_000 - 50_270) * 0.02;
    expect(r.class4).toBe(Math.round((main + upper) * 100) / 100);
  });

  it('applies the box 102 adjustment to the chargeable profits', () => {
    const r = computeSelfEmployedNic({ profits: 30_000, class4Adjustment: -5_000 }, '2025-26');
    expect(r.class4Profits).toBe(25_000);
    expect(r.class4).toBe(Math.round((25_000 - 12_570) * 0.06 * 100) / 100);
  });

  it('charges nothing when the exemption box is ticked', () => {
    const r = computeSelfEmployedNic({ profits: 80_000, exemptFromClass4: true }, '2025-26');
    expect(r.class4).toBe(0);
  });

  it('says the Class 4 loss pool is separate from the income tax one', () => {
    const r = computeSelfEmployedNic({ profits: 30_000 }, '2025-26');
    expect(r.notes.join(' ')).toMatch(/SEPARATE pool/);
  });
});

describe('Class 2 after the 6 April 2024 reform', () => {
  it('credits the year without charging anything once profits reach the SPT', () => {
    const r = computeSelfEmployedNic({ profits: 10_000 }, '2025-26');
    expect(r.class2).toBe(0);
    expect(r.class2Credited).toBe(true);
    expect(r.workings.join(' ')).toMatch(/treated as having been paid/);
  });

  it('credits at the SMALL profits threshold, not at £12,570', () => {
    // The old shape charged Class 2 above the Lower Profits Threshold. That
    // threshold was removed; £8,000 is credited, not liable and not a gap.
    const r = computeSelfEmployedNic({ profits: 8_000 }, '2025-26');
    expect(r.class2Credited).toBe(true);
    expect(r.class2).toBe(0);
  });

  it('charges nothing below the SPT unless it is paid voluntarily', () => {
    const r = computeSelfEmployedNic({ profits: 4_000 }, '2025-26');
    expect(r.class2).toBe(0);
    expect(r.class2Credited).toBe(false);
    expect(r.notes.join(' ')).toMatch(/will not count towards the State Pension/);
  });

  it('charges 52 weeks when it is paid voluntarily below the SPT', () => {
    const r = computeSelfEmployedNic({ profits: 4_000, payClass2Voluntarily: true }, '2025-26');
    expect(r.class2).toBe(182);   // £3.50 x 52
    expect(r.notes.join(' ')).toMatch(/does not publish an annual figure/);
  });

  it('says the voluntary tick does nothing when the year is already credited', () => {
    const r = computeSelfEmployedNic({ profits: 40_000, payClass2Voluntarily: true }, '2025-26');
    expect(r.class2).toBe(0);
    expect(r.notes.join(' ')).toMatch(/nothing to buy/);
  });

  it('uprates the weekly rate and the threshold each year', () => {
    const a = computeSelfEmployedNic({ profits: 4_000, payClass2Voluntarily: true }, '2024-25');
    const b = computeSelfEmployedNic({ profits: 4_000, payClass2Voluntarily: true }, '2026-27');
    expect(a.class2).toBe(179.40);   // £3.45 x 52
    expect(b.class2).toBe(189.80);   // £3.65 x 52
  });
});

describe('the two together', () => {
  it('reports them separately and totals them', () => {
    const r = computeSelfEmployedNic({ profits: 4_000, payClass2Voluntarily: true }, '2025-26');
    expect(r.total).toBe(r.class2 + r.class4);
  });

  it('treats a loss as nil profits rather than a negative charge', () => {
    const r = computeSelfEmployedNic({ profits: -20_000 }, '2025-26');
    expect(r.class4).toBe(0);
    expect(r.class2).toBe(0);
    expect(r.class2Credited).toBe(false);
  });
});
