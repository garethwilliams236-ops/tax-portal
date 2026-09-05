import { describe, it, expect } from 'vitest';
import { computeCorporationTax, ctPaymentDueDate, ct600FilingDueDate } from '../corporation-tax.js';
import { countAssociates, assessTradeStart, type CandidateAssociate } from '../association.js';

const FY2026 = { start: new Date(Date.UTC(2026, 3, 1)), end: new Date(Date.UTC(2027, 2, 31)) };

describe('marginal relief', () => {
  it('matches the HMRC worked example: £150,000 profits, no associates', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 150_000,
      associationDivisor: 1,
    });
    // 150,000 × 25% = 37,500; MR = (250,000 − 150,000) × 3/200 = 1,500
    expect(r.taxAtMainRate).toBe(37_500);
    expect(r.marginalRelief).toBe(1_500);
    expect(r.taxDue).toBe(36_000);
    expect(r.effectiveRate).toBeCloseTo(0.24, 4);
    expect(r.rateApplied).toBe('marginal');
  });

  it('applies the N/A factor when distributions are received', () => {
    // N = 150,000, distributions 50,000 → A = 200,000
    // MR = 3/200 × (250,000 − 200,000) × (150,000/200,000) = 750 × 0.75 = 562.50
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 150_000,
      distributionsReceived: 50_000,
      associationDivisor: 1,
    });
    expect(r.augmentedProfits).toBe(200_000);
    expect(r.marginalRelief).toBe(562.5);
    expect(r.taxDue).toBe(36_937.5);
  });

  it('gives the small profits rate below the lower limit', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 40_000,
      associationDivisor: 1,
    });
    expect(r.rateApplied).toBe('small_profits');
    expect(r.taxDue).toBe(7_600); // 19%
  });

  it('gives the main rate with no relief at or above the upper limit', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 250_000,
      associationDivisor: 1,
    });
    expect(r.rateApplied).toBe('main');
    expect(r.marginalRelief).toBe(0);
    expect(r.taxDue).toBe(62_500);
  });
});

describe('associated companies', () => {
  it('divides the limits — two associated companies gives £25k/£125k', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 80_000,
      associationDivisor: 2,
    });
    expect(r.lowerLimit).toBe(25_000);
    expect(r.upperLimit).toBe(125_000);
    // 80,000 sits between, so marginal relief applies rather than 19%
    expect(r.rateApplied).toBe('marginal');
    expect(r.marginalRelief).toBe(675); // (125,000 − 80,000) × 3/200
    expect(r.taxDue).toBe(19_325);
  });

  it('THE TRAP: £40,000 of profit falls out of the small profits rate entirely', () => {
    // Alone: £40,000 is under the £50,000 lower limit → 19% throughout.
    // Associated: the lower limit halves to £25,000, so the same profit is
    // dragged into marginal relief and costs £1,125 more.
    const alone = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 40_000,
      associationDivisor: 1,
    });
    const associated = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 40_000,
      associationDivisor: 2,
    });

    expect(alone.rateApplied).toBe('small_profits');
    expect(alone.taxDue).toBe(7_600); // 19%

    expect(associated.rateApplied).toBe('marginal');
    expect(associated.marginalRelief).toBe(1_275); // (125,000 − 40,000) × 3/200
    expect(associated.taxDue).toBe(8_725);

    expect(associated.taxDue - alone.taxDue).toBe(1_125);
    // Effective rate rises from 19% to nearly 22% on identical profits
    expect(alone.effectiveRate).toBeCloseTo(0.19, 4);
    expect(associated.effectiveRate).toBeCloseTo(0.2181, 3);
  });

  it('at £80,000 both cases are marginal, but the relief differs sharply', () => {
    const alone = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 80_000,
      associationDivisor: 1,
    });
    const associated = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 80_000,
      associationDivisor: 2,
    });
    expect(alone.marginalRelief).toBe(2_550); // (250,000 − 80,000) × 3/200
    expect(associated.marginalRelief).toBe(675); // (125,000 − 80,000) × 3/200
    expect(associated.taxDue - alone.taxDue).toBe(1_875);
  });

  it('divides the QIP threshold by associates too', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 800_000,
      associationDivisor: 2,
    });
    expect(r.qipThreshold).toBe(750_000);
    expect(r.qipApplies).toBe(true);
  });

  it('prorates limits for a short accounting period', () => {
    const r = computeCorporationTax({
      periodStart: new Date(Date.UTC(2026, 3, 1)),
      periodEnd: new Date(Date.UTC(2026, 8, 30)), // 183 days
      taxableTotalProfits: 20_000,
      associationDivisor: 1,
    });
    expect(r.daysInPeriod).toBe(183);
    expect(r.lowerLimit).toBeCloseTo((50_000 * 183) / 365, 1);
  });

  it('denies the small profits rate to a close investment-holding company', () => {
    const r = computeCorporationTax({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      taxableTotalProfits: 30_000,
      associationDivisor: 1,
      isCloseInvestmentHoldingCompany: true,
    });
    expect(r.rateApplied).toBe('main');
    expect(r.taxDue).toBe(7_500); // 25%, not 19%
  });
});

describe('s.18E counting', () => {
  const dormant: CandidateAssociate = {
    entityId: 'co-b',
    name: 'Company B',
    carriedOnTradeOrBusiness: false,
    basis: 'no_activity',
    reasoning: 'No transactions in the period.',
  };

  it('disregards a company carrying on no trade or business', () => {
    const r = countAssociates([dormant]);
    expect(r.divisor).toBe(1);
    expect(r.disregarded).toHaveLength(1);
    expect(r.disregarded[0]!.reason).toContain('s.18E(3)');
  });

  it('disregards a company earning only bank interest (Jowett)', () => {
    const r = countAssociates([
      { ...dormant, basis: 'bank_interest_only', reasoning: 'Deposit interest only.' },
    ]);
    expect(r.divisor).toBe(1);
    expect(r.disregarded[0]!.reason).toContain('Jowett');
  });

  it('counts a company that traded, and says so', () => {
    const r = countAssociates([
      { ...dormant, carriedOnTradeOrBusiness: true, basis: 'trading', reasoning: 'Began trading.' },
    ]);
    expect(r.divisor).toBe(2);
    expect(r.counted).toHaveLength(1);
  });

  it('NO APPORTIONMENT: one day of trading contaminates the whole period', () => {
    const impact = assessTradeStart({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      proposedStartDate: new Date(Date.UTC(2027, 2, 1)), // 1 March 2027, 30 days before year end
      currentCandidates: [dormant],
      startingEntityId: 'co-b',
    });
    expect(impact.contaminatesPeriod).toBe(true);
    expect(impact.divisorIfStarted).toBe(2);
    expect(impact.divisorIfNotStarted).toBe(1);
    expect(impact.explanation).toContain('WHOLE period');
    // The first safe date is the day after the period ends
    expect(impact.firstSafeStartDate.toISOString().slice(0, 10)).toBe('2027-04-01');
  });

  it('a start date after the period end leaves the period alone', () => {
    const impact = assessTradeStart({
      periodStart: FY2026.start,
      periodEnd: FY2026.end,
      proposedStartDate: new Date(Date.UTC(2027, 3, 1)),
      currentCandidates: [dormant],
      startingEntityId: 'co-b',
    });
    expect(impact.contaminatesPeriod).toBe(false);
    expect(impact.divisorIfStarted).toBe(1);
  });
});

describe('deadlines', () => {
  it('CT payment is 9 months and 1 day after the period end', () => {
    expect(ctPaymentDueDate(new Date(Date.UTC(2027, 2, 31))).toISOString().slice(0, 10)).toBe(
      '2028-01-01',
    );
  });

  it('CT600 is due 12 months after the period end', () => {
    expect(ct600FilingDueDate(new Date(Date.UTC(2027, 2, 31))).toISOString().slice(0, 10)).toBe(
      '2028-03-31',
    );
  });
});
