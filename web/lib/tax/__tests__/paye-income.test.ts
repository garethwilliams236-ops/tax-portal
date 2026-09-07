import { describe, it, expect } from 'vitest';
import {
  assessEmploymentAllowance,
  chooseEmploymentAllowanceClaimant,
  computeAnnualNic,
  type PayrollPerson,
} from '../paye-nic';
import { computeIncomeTax, computeHicbc } from '../income-tax';
import { computeCgt, assessBadr, type BadrHolding } from '../cgt';

const TY = '2026-27' as const;

describe('Employment Allowance — heads above the secondary threshold, not directorships', () => {
  it('excludes a sole director who is the only person above the ST', () => {
    const people: PayrollPerson[] = [
      { personId: 'g', name: 'Gareth', isDirector: true, annualEarnings: 60_000 },
    ];
    const r = assessEmploymentAllowance(people, TY);
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain('s.2(4A)');
  });

  it('THE CORRECTION: five directors, four unpaid, one paid — still NOT eligible', () => {
    const people: PayrollPerson[] = [
      { personId: 'a', name: 'A', isDirector: true, annualEarnings: 60_000 },
      { personId: 'b', name: 'B', isDirector: true, annualEarnings: 0 },
      { personId: 'c', name: 'C', isDirector: true, annualEarnings: 0 },
      { personId: 'd', name: 'D', isDirector: true, annualEarnings: 0 },
      { personId: 'e', name: 'E', isDirector: true, annualEarnings: 0 },
    ];
    const r = assessEmploymentAllowance(people, TY);
    expect(r.eligible).toBe(false);
    expect(r.headsAboveSecondaryThreshold).toBe(1);
  });

  it('two directors both above the ST — eligible', () => {
    const people: PayrollPerson[] = [
      { personId: 'g', name: 'Gareth', isDirector: true, annualEarnings: 60_000 },
      { personId: 'w', name: 'Spouse', isDirector: true, annualEarnings: 9_000 },
    ];
    const r = assessEmploymentAllowance(people, TY);
    expect(r.eligible).toBe(true);
    expect(r.allowance).toBe(10_500);
    expect(r.headsAboveSecondaryThreshold).toBe(2);
  });

  it('THE CONTESTED CASE: second director paid but below the ST — follows HMRC, with a warning', () => {
    const people: PayrollPerson[] = [
      { personId: 'g', name: 'Gareth', isDirector: true, annualEarnings: 60_000 },
      { personId: 'w', name: 'Spouse', isDirector: true, annualEarnings: 3_000 },
    ];
    const r = assessEmploymentAllowance(people, TY);
    expect(r.eligible).toBe(false);
    expect(r.warnings[0]).toContain('pay them above');
  });

  it('sole director below the ST plus a real employee above it — eligible', () => {
    const people: PayrollPerson[] = [
      { personId: 'g', name: 'Gareth', isDirector: true, annualEarnings: 3_000 },
      { personId: 'x', name: 'Employee', isDirector: false, annualEarnings: 20_000 },
    ];
    const r = assessEmploymentAllowance(people, TY);
    expect(r.eligible).toBe(true);
  });

  it('prorates the secondary threshold for a mid-year directorship', () => {
    const people: PayrollPerson[] = [
      { personId: 'g', name: 'Gareth', isDirector: true, annualEarnings: 60_000 },
      {
        personId: 'w',
        name: 'Spouse',
        isDirector: true,
        annualEarnings: 3_000,
        directorshipStartedOn: new Date(Date.UTC(2027, 0, 6)), // 3 months to go
      },
    ];
    const r = assessEmploymentAllowance(people, TY);
    // Pro-rated ST is roughly £1,250, so £3,000 clears it
    expect(r.eligible).toBe(true);
  });
});

describe('Employment Allowance across connected companies', () => {
  it('allows only one claim and picks the company that absorbs the most', () => {
    const r = chooseEmploymentAllowanceClaimant(
      [
        { entityId: 'a', name: 'Trading Co', eligible: true, expectedEmployerNic: 14_000 },
        { entityId: 'b', name: 'Second Co', eligible: true, expectedEmployerNic: 4_000 },
      ],
      TY,
    );
    expect(r.claimantId).toBe('a');
    expect(r.reason).toContain('only one allowance');
  });

  it('does not engage s.3 where only one company qualifies', () => {
    const r = chooseEmploymentAllowanceClaimant(
      [
        { entityId: 'a', name: 'Trading Co', eligible: true, expectedEmployerNic: 14_000 },
        { entityId: 'b', name: 'Dormant Co', eligible: false, expectedEmployerNic: 0 },
      ],
      TY,
    );
    expect(r.claimantId).toBe('a');
    expect(r.reason).toContain('does not bite');
  });
});

describe('NIC', () => {
  it('computes employee and employer NIC on £60,000', () => {
    const r = computeAnnualNic(60_000, TY);
    // Employee: 8% on (50,270 − 12,570) = 3,016; 2% on 9,730 = 194.60
    expect(r.employeeNic).toBeCloseTo(3_210.6, 2);
    // Employer: 15% on (60,000 − 5,000) = 8,250
    expect(r.employerNic).toBe(8_250);
  });
});

describe('income tax', () => {
  it('tapers the personal allowance above £100,000 and shows the 60% band', () => {
    const r = computeIncomeTax({ employment: 110_000 }, TY);
    expect(r.personalAllowanceLost).toBe(5_000);
    expect(r.personalAllowance).toBe(7_570);
    expect(r.marginalRate).toBeCloseTo(0.6, 2);
  });

  it('loses the allowance entirely at £125,140', () => {
    const r = computeIncomeTax({ employment: 125_140 }, TY);
    expect(r.personalAllowance).toBe(0);
  });

  it('applies the 2026/27 dividend rates, not the old ones', () => {
    // Basic rate taxpayer: £20,000 salary + £10,000 dividends
    const r = computeIncomeTax({ employment: 20_000, dividends: 10_000 }, TY);
    // Dividends: £500 allowance, then £9,500 at 10.75% = £1,021.25
    expect(r.taxByCategory.dividends).toBeCloseTo(1_021.25, 2);
  });

  it('reduces adjusted net income by gross pension contributions', () => {
    const without = computeIncomeTax({ employment: 110_000 }, TY);
    const with_ = computeIncomeTax(
      { employment: 110_000, grossPensionContributions: 10_000 },
      TY,
    );
    expect(without.personalAllowance).toBe(7_570);
    expect(with_.personalAllowance).toBe(12_570); // taper fully reversed
  });

  it('gives the s.24 finance cost reducer at the basic rate only', () => {
    const r = computeIncomeTax(
      { employment: 60_000, property: 20_000, propertyFinanceCosts: 8_000 },
      TY,
    );
    expect(r.financeCostReducer).toBe(1_600); // 20% of 8,000
  });

  it('THE 2027/28 SPLIT: property income is taxed 2pp higher than employment', () => {
    const employmentOnly = computeIncomeTax({ employment: 60_000 }, '2027-28');
    const withProperty = computeIncomeTax({ employment: 40_000, property: 20_000 }, '2027-28');
    // Same £60,000 total, but £20,000 of it at 42% rather than 40%
    expect(withProperty.totalTax).toBeGreaterThan(employmentOnly.totalTax);
    expect(withProperty.totalTax - employmentOnly.totalTax).toBeCloseTo(400, 0);
  });
});

describe('HICBC', () => {
  it('is nil at or below £60,000', () => {
    expect(computeHicbc(60_000, 2_000, TY).charge).toBe(0);
  });

  it('is 50% at £70,000', () => {
    const r = computeHicbc(70_000, 2_000, TY);
    expect(r.percentage).toBe(0.5);
    expect(r.charge).toBe(1_000);
  });

  it('is a full clawback at £80,000', () => {
    expect(computeHicbc(80_000, 2_000, TY).charge).toBe(2_000);
  });
});

describe('capital gains', () => {
  it('uses BADR at 18% for a 2026/27 disposal', () => {
    const r = computeCgt({
      disposals: [
        {
          id: 'd1',
          description: 'Shares in Trading Co',
          assetClass: 'shares',
          disposedOn: new Date(Date.UTC(2026, 5, 1)),
          proceeds: 1_003_000,
          baseCost: 3_000,
          claimBadr: true,
        },
      ],
      taxYear: TY,
      taxableIncome: 50_000,
    });
    // £1,000,000 gain less £3,000 AEA = £997,000 at 18%
    expect(r.badrTax).toBeCloseTo(179_460, 0);
  });

  it('uses the OLD BADR rate for an earlier disposal date', () => {
    const r = computeCgt({
      disposals: [
        {
          id: 'd1',
          description: 'Shares',
          assetClass: 'shares',
          disposedOn: new Date(Date.UTC(2025, 5, 1)), // 2025/26 — BADR was 14%
          proceeds: 103_000,
          baseCost: 3_000,
          claimBadr: true,
        },
      ],
      taxYear: '2026-27',
      taxableIncome: 50_000,
    });
    expect(r.badrTax).toBeCloseTo(13_580, 0); // 97,000 × 14%
  });

  it('taxes residential property at the same rates as other assets', () => {
    const shares = computeCgt({
      disposals: [
        {
          id: 'a',
          description: 'Shares',
          assetClass: 'shares',
          disposedOn: new Date(Date.UTC(2026, 5, 1)),
          proceeds: 53_000,
          baseCost: 3_000,
        },
      ],
      taxYear: TY,
      taxableIncome: 60_000,
    });
    const property = computeCgt({
      disposals: [
        {
          id: 'b',
          description: 'Flat',
          assetClass: 'residential_property',
          disposedOn: new Date(Date.UTC(2026, 5, 1)),
          proceeds: 53_000,
          baseCost: 3_000,
        },
      ],
      taxYear: TY,
      taxableIncome: 60_000,
    });
    expect(shares.totalTax).toBe(property.totalTax);
  });
});

describe('BADR qualification', () => {
  const base: BadrHolding = {
    personId: 'w',
    personName: 'Spouse',
    companyId: 'co-a',
    companyName: 'Trading Co',
    ordinarySharePct: 30,
    votingRightsPct: 30,
    distributableProfitsPct: 30,
    windingUpAssetsPct: 30,
    isOfficerOrEmployee: true,
    companyIsTrading: true,
    conditionsMetSince: new Date(Date.UTC(2025, 0, 1)),
  };

  it('does not qualify before the 2-year period completes', () => {
    const r = assessBadr(base, new Date(Date.UTC(2026, 5, 1)));
    expect(r.qualifiesNow).toBe(false);
    expect(r.daysRemaining).toBeGreaterThan(0);
    expect(r.explanation).toContain('transferring shares now does not start a shorter clock');
  });

  it('qualifies once 2 years have run', () => {
    const r = assessBadr(base, new Date(Date.UTC(2027, 5, 1)));
    expect(r.qualifiesNow).toBe(true);
  });

  it('fails on a sub-5% holding', () => {
    const r = assessBadr({ ...base, ordinarySharePct: 4 }, new Date(Date.UTC(2027, 5, 1)));
    expect(r.qualifiesNow).toBe(false);
    expect(r.failedConditions).toContain('ordinary share capital below 5%');
  });

  it('fails where the person is not an officer or employee', () => {
    const r = assessBadr({ ...base, isOfficerOrEmployee: false }, new Date(Date.UTC(2027, 5, 1)));
    expect(r.failedConditions).toContain('not an officer or employee');
  });
});
