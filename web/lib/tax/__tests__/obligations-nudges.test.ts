import { describe, it, expect } from 'vitest';
import {
  generateObligations,
  form17Obligation,
  cgt60DayObligation,
  vatDueDate,
  type CompanyConfig,
  type IndividualConfig,
} from '../obligations';
import {
  deadlineNudges,
  dormantActivityNudges,
  tradeStartNudges,
  employmentAllowanceNudges,
  allowanceExpiryNudges,
  petAnniversaryNudges,
  normalExpenditureEvidenceNudge,
  vatThresholdNudges,
  collate,
} from '../nudges';

const FROM = new Date(Date.UTC(2026, 8, 1));
const TO = new Date(Date.UTC(2027, 8, 1));

const tradingCo: CompanyConfig = {
  entityId: 'co-a',
  entityName: 'Trading Co',
  type: 'company',
  yearEndMonth: 3,
  yearEndDay: 31,
  tradingStatus: 'trading',
  vatRegistered: true,
  vatStaggerEndMonth: 3,
  hasPayroll: true,
  confirmationStatementDue: new Date(Date.UTC(2026, 10, 14)),
};

const dormantCo: CompanyConfig = {
  entityId: 'co-b',
  entityName: 'Second Co',
  type: 'company',
  yearEndMonth: 3,
  yearEndDay: 31,
  tradingStatus: 'dormant',
  vatRegistered: false,
  hasPayroll: false,
  confirmationStatementDue: new Date(Date.UTC(2027, 1, 3)),
};

describe('obligation generation — trading company', () => {
  const obs = generateObligations([tradingCo], FROM, TO);

  it('generates CT payment at 9 months and 1 day', () => {
    const ct = obs.find((o) => o.taxType === 'CT' && o.kind === 'payment');
    expect(ct).toBeDefined();
    expect(ct!.dueDate.toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('generates the CT600 at 12 months', () => {
    const ct = obs.find((o) => o.taxType === 'CT' && o.kind === 'filing');
    expect(ct!.dueDate.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('generates accounts at 9 months', () => {
    const acc = obs.find((o) => o.taxType === 'ACCOUNTS');
    expect(acc!.dueDate.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(acc!.description).toContain('Annual accounts');
  });

  it('generates quarterly VAT on the 7th of the second following month', () => {
    const vat = obs.filter((o) => o.taxType === 'VAT');
    expect(vat.length).toBeGreaterThanOrEqual(4);
    // Quarter ending 30 September 2026 → due 7 November 2026, NOT 6 November.
    // Naive "add one month then seven days" gets this wrong.
    const q = vat.find((o) => o.periodEnd?.toISOString().slice(0, 10) === '2026-09-30');
    expect(q!.dueDate.toISOString().slice(0, 10)).toBe('2026-11-07');
  });

  it('gets the VAT deadline right for every quarter end, including March', () => {
    // HMRC's own examples: 31 March → 7 May; 30 September → 7 November.
    expect(vatDueDate(new Date(Date.UTC(2027, 2, 31))).toISOString().slice(0, 10)).toBe('2027-05-07');
    expect(vatDueDate(new Date(Date.UTC(2026, 5, 30))).toISOString().slice(0, 10)).toBe('2026-08-07');
    expect(vatDueDate(new Date(Date.UTC(2026, 8, 30))).toISOString().slice(0, 10)).toBe('2026-11-07');
    expect(vatDueDate(new Date(Date.UTC(2026, 11, 31))).toISOString().slice(0, 10)).toBe('2027-02-07');
    // Year boundary
    expect(vatDueDate(new Date(Date.UTC(2026, 10, 30))).toISOString().slice(0, 10)).toBe('2027-01-07');
  });

  it('generates monthly PAYE on the 22nd', () => {
    const paye = obs.filter((o) => o.taxType === 'PAYE');
    expect(paye.length).toBeGreaterThan(10);
    expect(paye.every((p) => p.dueDate.getUTCDate() === 22)).toBe(true);
  });
});

describe('obligation generation — dormant company', () => {
  const obs = generateObligations([dormantCo], FROM, TO);

  it('still requires a confirmation statement', () => {
    const cs = obs.find((o) => o.taxType === 'CONFIRMATION_STATEMENT');
    expect(cs).toBeDefined();
    expect(cs!.citation).toContain('strike-off');
  });

  it('files AA02 dormant accounts rather than full accounts', () => {
    const acc = obs.find((o) => o.taxType === 'ACCOUNTS');
    expect(acc!.description).toContain('AA02');
  });

  it('generates NO CT600 and NO CT payment', () => {
    expect(obs.filter((o) => o.taxType === 'CT')).toHaveLength(0);
  });

  it('generates no PAYE or VAT', () => {
    expect(obs.filter((o) => o.taxType === 'PAYE')).toHaveLength(0);
    expect(obs.filter((o) => o.taxType === 'VAT')).toHaveLength(0);
  });

  it('adds the s.55 notification 3 months from the START of the period when it comes within charge', () => {
    const started = generateObligations(
      [{ ...dormantCo, cameWithinChargeOn: new Date(Date.UTC(2027, 3, 1)) }],
      FROM,
      new Date(Date.UTC(2027, 11, 31)),
    );
    const notif = started.find((o) => o.taxType === 'CT_NOTIFICATION');
    expect(notif!.dueDate.toISOString().slice(0, 10)).toBe('2027-07-01');
    expect(notif!.citation).toContain('not the year end');
  });
});

describe('obligation generation — individual', () => {
  const person: IndividualConfig = {
    entityId: 'ind-1',
    entityName: 'Gareth',
    type: 'individual',
    selfAssessment: true,
    paymentsOnAccountDue: true,
  };
  const obs = generateObligations([person], FROM, TO);

  it('generates the 31 January filing deadline', () => {
    const sa = obs.find((o) => o.taxType === 'SA' && o.kind === 'filing');
    expect(sa!.dueDate.toISOString().slice(0, 10)).toBe('2027-01-31');
  });

  it('generates the 31 July payment on account', () => {
    const july = obs.find((o) => o.description === 'Second payment on account');
    expect(july!.dueDate.toISOString().slice(0, 10)).toBe('2027-07-31');
  });

  it('omits payments on account where not due', () => {
    const obs2 = generateObligations([{ ...person, paymentsOnAccountDue: false }], FROM, TO);
    expect(obs2.find((o) => o.description === 'Second payment on account')).toBeUndefined();
  });
});

describe('unextendable deadlines', () => {
  it('marks Form 17 as unextendable and dates it from the declaration', () => {
    const o = form17Obligation({
      entityId: 'ind-1',
      entityName: 'Gareth',
      declarationDate: new Date(Date.UTC(2026, 8, 1)),
      propertyDescription: 'Rental flat',
    });
    expect(o.isUnextendable).toBe(true);
    expect(o.dueDate.toISOString().slice(0, 10)).toBe('2026-10-31'); // 60 days
    expect(o.citation).toContain('no power to extend');
  });

  it('escalates an unextendable deadline harder than an ordinary one', () => {
    const asAt = new Date(Date.UTC(2026, 8, 1));
    const due = new Date(Date.UTC(2026, 8, 25)); // 24 days out

    const ordinary = deadlineNudges(
      [
        {
          entityId: 'e',
          entityName: 'E',
          taxType: 'VAT',
          kind: 'filing',
          description: 'VAT return',
          dueDate: due,
        },
      ],
      asAt,
    );
    const unextendable = deadlineNudges(
      [
        {
          entityId: 'e',
          entityName: 'E',
          taxType: 'FORM_17',
          kind: 'submission',
          description: 'Form 17',
          dueDate: due,
          isUnextendable: true,
        },
      ],
      asAt,
    );

    expect(ordinary[0]!.priority).toBe(4);
    expect(unextendable[0]!.priority).toBe(2); // never below 2
    expect(unextendable[0]!.detail).toContain('CANNOT BE EXTENDED');
  });

  it('creates a 60-day CGT obligation from a disposal', () => {
    const o = cgt60DayObligation({
      entityId: 'ind-1',
      entityName: 'Gareth',
      disposalDate: new Date(Date.UTC(2026, 8, 1)),
      description: 'Rental flat',
    });
    expect(o.dueDate.toISOString().slice(0, 10)).toBe('2026-10-31');
  });
});

describe('structural nudges', () => {
  it('flags any activity in the supposedly inactive company', () => {
    const n = dormantActivityNudges([
      {
        entityId: 'co-b',
        entityName: 'Second Co',
        transactionSeenOn: new Date(Date.UTC(2026, 8, 15)),
        description: 'Bank charge £12',
        subjectCompanyName: 'Trading Co',
        subjectPeriodEnd: new Date(Date.UTC(2027, 2, 31)),
      },
    ]);
    expect(n[0]!.priority).toBe(2);
    expect(n[0]!.detail).toContain('no apportionment');
    expect(n[0]!.detail).toContain('Jowett');
  });

  it('prices a trade start inside the period and names the first safe date', () => {
    const n = tradeStartNudges(
      [
        {
          entityId: 'co-b',
          entityName: 'Second Co',
          subjectCompanyName: 'Trading Co',
          subjectPeriodEnd: new Date(Date.UTC(2027, 2, 31)),
          intendedStartDate: new Date(Date.UTC(2027, 1, 1)),
          additionalTaxIfStartedInPeriod: 4125,
        },
      ],
      new Date(Date.UTC(2026, 8, 1)),
    );
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain('£4,125');
    expect(n[0]!.detail).toContain('2027-04-01');
  });

  it('says nothing where the start date is already outside the period', () => {
    const n = tradeStartNudges(
      [
        {
          entityId: 'co-b',
          entityName: 'Second Co',
          subjectCompanyName: 'Trading Co',
          subjectPeriodEnd: new Date(Date.UTC(2027, 2, 31)),
          intendedStartDate: new Date(Date.UTC(2027, 3, 1)),
          additionalTaxIfStartedInPeriod: 4125,
        },
      ],
      new Date(Date.UTC(2026, 8, 1)),
    );
    expect(n).toHaveLength(0);
  });
});

describe('Employment Allowance nudge', () => {
  const signal = {
    entityId: 'co-a',
    entityName: 'Trading Co',
    taxYear: '2026-27',
    taxYearEnd: new Date(Date.UTC(2027, 3, 5)),
    eligible: false,
    headsAboveSecondaryThreshold: 1,
    allowance: 10_500,
    secondaryThreshold: 5_000,
  };

  it('escalates as the tax year end approaches', () => {
    const early = employmentAllowanceNudges([signal], new Date(Date.UTC(2026, 8, 1)));
    const late = employmentAllowanceNudges([signal], new Date(Date.UTC(2027, 2, 1)));
    expect(early[0]!.priority).toBe(3);
    expect(late[0]!.priority).toBe(1);
  });

  it('explains that the test counts heads, not directorships', () => {
    const n = employmentAllowanceNudges([signal], new Date(Date.UTC(2027, 0, 1)));
    expect(n[0]!.detail).toContain('not directorships');
    expect(n[0]!.detail).toContain('NICA 2014 s.3');
  });

  it('says nothing where the company already qualifies', () => {
    const n = employmentAllowanceNudges(
      [{ ...signal, eligible: true }],
      new Date(Date.UTC(2027, 0, 1)),
    );
    expect(n).toHaveLength(0);
  });
});

describe('planning window nudges', () => {
  it('flags expiring pension carry-forward and names the origin year', () => {
    const n = allowanceExpiryNudges(
      [
        {
          entityId: 'ind-1',
          entityName: 'Gareth',
          allowance: 'pension_aa',
          taxYear: '2026-27',
          originYear: '2023-24',
          limitAmount: 60_000,
          usedAmount: 10_000,
          expiresOn: new Date(Date.UTC(2027, 3, 5)),
        },
      ],
      new Date(Date.UTC(2027, 2, 20)), // 16 days out
    );
    expect(n[0]!.title).toContain('£50,000');
    expect(n[0]!.detail).toContain('2023-24');
    expect(n[0]!.priority).toBe(1); // inside 30 days
  });

  it('escalates allowance expiry as 5 April approaches', () => {
    const signal = {
      entityId: 'ind-1',
      entityName: 'Gareth',
      allowance: 'pension_aa' as const,
      taxYear: '2026-27',
      originYear: '2023-24',
      limitAmount: 60_000,
      usedAmount: 10_000,
      expiresOn: new Date(Date.UTC(2027, 3, 5)),
    };
    const far = allowanceExpiryNudges([signal], new Date(Date.UTC(2027, 0, 15)));
    const mid = allowanceExpiryNudges([signal], new Date(Date.UTC(2027, 1, 15)));
    const near = allowanceExpiryNudges([signal], new Date(Date.UTC(2027, 2, 25)));
    expect(far[0]!.priority).toBe(3);
    expect(mid[0]!.priority).toBe(2);
    expect(near[0]!.priority).toBe(1);
  });

  it('notes that the IHT annual exemption carries forward one year only', () => {
    const n = allowanceExpiryNudges(
      [
        {
          entityId: 'ind-1',
          entityName: 'Gareth',
          allowance: 'iht_annual',
          taxYear: '2026-27',
          limitAmount: 3_000,
          usedAmount: 0,
          expiresOn: new Date(Date.UTC(2027, 3, 5)),
        },
      ],
      new Date(Date.UTC(2027, 2, 1)),
    );
    expect(n[0]!.detail).toContain('one year only');
  });

  it('says nothing about a fully used allowance', () => {
    const n = allowanceExpiryNudges(
      [
        {
          entityId: 'ind-1',
          entityName: 'Gareth',
          allowance: 'isa',
          taxYear: '2026-27',
          limitAmount: 20_000,
          usedAmount: 20_000,
          expiresOn: new Date(Date.UTC(2027, 3, 5)),
        },
      ],
      new Date(Date.UTC(2027, 2, 1)),
    );
    expect(n).toHaveLength(0);
  });

  it('flags the 7-year point on a PET as restoring nil-rate band', () => {
    const giftDate = new Date(Date.UTC(2020, 0, 15));
    const n = petAnniversaryNudges(
      [
        {
          entityId: 'ind-1',
          entityName: 'Gareth',
          giftId: 'g1',
          giftDate,
          value: 100_000,
          beneficiary: 'Child 1',
        },
      ],
      new Date(Date.UTC(2027, 0, 1)),
    );
    const seven = n.find((x) => x.periodKey === '7');
    expect(seven).toBeDefined();
    expect(seven!.detail).toContain('nil-rate band it absorbed is restored');
  });

  it('prompts for the normal-expenditure schedule while figures are to hand', () => {
    const n = normalExpenditureEvidenceNudge({
      entityId: 'ind-1',
      entityName: 'Gareth',
      taxYear: '2026-27',
      taxYearEnd: new Date(Date.UTC(2027, 3, 5)),
      scheduleRecorded: false,
      asAt: new Date(Date.UTC(2027, 2, 1)),
    });
    expect(n[0]!.detail).toContain('IHT403');
    expect(n[0]!.detail).toContain('all three limbs');
  });
});

describe('threshold nudges', () => {
  it('warns at 80% of the VAT threshold and escalates at 100%', () => {
    const at80 = vatThresholdNudges([
      { entityId: 'co-a', entityName: 'Trading Co', rolling12MonthTurnover: 74_000, threshold: 90_000 },
    ]);
    const over = vatThresholdNudges([
      { entityId: 'co-a', entityName: 'Trading Co', rolling12MonthTurnover: 92_000, threshold: 90_000 },
    ]);
    expect(at80[0]!.priority).toBe(3);
    expect(over[0]!.priority).toBe(1);
    expect(at80[0]!.detail).toContain('next 30 days');
  });

  it('stays quiet well below the threshold', () => {
    expect(
      vatThresholdNudges([
        { entityId: 'co-a', entityName: 'Trading Co', rolling12MonthTurnover: 40_000, threshold: 90_000 },
      ]),
    ).toHaveLength(0);
  });
});

describe('collate — the anti-spam guarantee', () => {
  it('deduplicates by entity, rule and period, keeping the highest priority', () => {
    const base = {
      entityId: 'co-a',
      entityName: 'Trading Co',
      ruleKey: 'deadline:VAT:filing',
      periodKey: '2026-11-07',
      title: 'VAT',
      detail: 'x',
      category: 'filing' as const,
    };
    const result = collate([
      { ...base, priority: 4 },
      { ...base, priority: 2 },
      { ...base, priority: 3 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.priority).toBe(2);
  });

  it('keeps distinct periods of the same rule separate', () => {
    const base = {
      entityId: 'co-a',
      entityName: 'Trading Co',
      ruleKey: 'deadline:VAT:filing',
      title: 'VAT',
      detail: 'x',
      category: 'filing' as const,
      priority: 3,
    };
    const result = collate([
      { ...base, periodKey: '2026-11-07' },
      { ...base, periodKey: '2027-02-07' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('sorts by priority then due date', () => {
    const mk = (priority: number, day: number) => ({
      entityId: 'e',
      entityName: 'E',
      ruleKey: `r${priority}${day}`,
      periodKey: 'p',
      title: 't',
      detail: 'd',
      category: 'filing' as const,
      priority,
      dueDate: new Date(Date.UTC(2026, 8, day)),
    });
    const result = collate([mk(3, 1), mk(1, 20), mk(1, 5)]);
    expect(result.map((r) => r.priority)).toEqual([1, 1, 3]);
    expect(result[0]!.dueDate!.getUTCDate()).toBe(5);
  });
});
