import { describe, expect, it } from 'vitest';
import { computeUs, ZERO_INPUTS, type UsInputs } from '../form1040';
import { buildForms, formsNotNeeded, type UsForm } from '../forms';

const base = (over: Partial<UsInputs>): UsInputs => ({ ...ZERO_INPUTS, year: 2025, status: 'mfs', ...over });
const line = (forms: UsForm[], code: string, no: string) => {
  const f = forms.find((x) => x.code === code);
  const l = f?.lines.find((x) => x.no === no);
  if (!l) throw new Error(`${code} line ${no} not shown`);
  return l.amount ?? 0;
};

const SCENARIOS: Record<string, Partial<UsInputs>> = {
  'salary with UK tax, two children': { foreignEarned: 60_000, ukTaxEarnings: 15_000, qualifyingChildren: 2, interest: 2_000, ukTaxPassive: 400, foreignAccountsMax: 40_000 },
  'salary excluded': { foreignEarned: 90_000, feieClaimed: true, qualifyingDays: 365, ukTaxEarnings: 25_000, interest: 3_000, ukTaxPassive: 600, qualifyingChildren: 1 },
  'high investment income': { foreignEarned: 100_000, ukTaxEarnings: 30_000, interest: 150_000, ordinaryDividends: 80_000, qualifiedDividends: 80_000, ukTaxPassive: 70_000, rental: 20_000 },
  'pension and gains': { pensions: 30_000, ukTaxGeneral: 4_000, longTermGains: 25_000, shortTermGains: -3_000, ukTaxPassive: 2_000, usWithholding: 500 },
};

describe.each(Object.entries(SCENARIOS))('the forms tie together — %s', (_name, over) => {
  const i = base(over);
  const r = computeUs(i);
  const f = buildForms(i, r);

  it('1040 line 9 is the sum of the income lines', () => {
    const sum = ['1z', '2b', '3b', '7a', '8'].reduce((a, n) => a + line(f, '1040', n), 0)
      + (i.pensions ? line(f, '1040', '5b') : 0);
    expect(Math.abs(line(f, '1040', '9') - sum)).toBeLessThanOrEqual(2);
  });

  it('1040 line 15 is line 11a less line 14, not below nil', () => {
    expect(Math.abs(line(f, '1040', '15') - Math.max(0, line(f, '1040', '11a') - line(f, '1040', '14')))).toBeLessThanOrEqual(1);
  });

  it('1040 line 24 is line 22 plus line 23', () => {
    expect(Math.abs(line(f, '1040', '24') - (line(f, '1040', '22') + line(f, '1040', '23')))).toBeLessThanOrEqual(1);
  });

  it('the foreign tax credit is the same on Form 1116, Schedule 3 and the 1040', () => {
    if (r.ftc <= 0) return;
    expect(line(f, '1116 Part IV', '35')).toBe(line(f, 'Sch 3', '1'));
    expect(line(f, 'Sch 3', '8')).toBe(line(f, '1040', '20'));
  });

  it('the exclusion is the same on Form 2555, Schedule 1 and Schedule 8812', () => {
    if (!r.exclusion) return;
    expect(line(f, '2555', '45')).toBe(-line(f, 'Sch 1', '8d'));
    if (r.parts.kids) expect(line(f, 'Sch 8812', '2b')).toBe(line(f, '2555', '45'));
  });

  it('the child credit is the same on Schedule 8812 and the 1040', () => {
    if (!r.parts.kids) return;
    expect(line(f, 'Sch 8812', '14')).toBe(line(f, '1040', '19'));
    if (r.childCreditRefund) expect(line(f, 'Sch 8812', '27')).toBe(line(f, '1040', '28'));
  });

  it('the result line agrees with the summary', () => {
    const owe = f[0]!.lines.at(-1)!;
    expect(owe.no).toBe(r.balance < 0 ? '34' : '37');
    expect(Math.abs((owe.amount ?? 0) - Math.abs(r.balance))).toBeLessThanOrEqual(1);
  });
});

describe('which forms appear', () => {
  it('shows Form 2555 only when the exclusion is claimed, and no refundable credit with it', () => {
    const i = base(SCENARIOS['salary excluded']!);
    const f = buildForms(i, computeUs(i));
    expect(f.map((x) => x.code)).toContain('2555');
    expect(f.find((x) => x.code === 'Sch 8812')!.lines.some((l) => l.no === '27')).toBe(false);
  });
  it('always ends with the FBAR', () => {
    const i = base({ foreignEarned: 10 });
    expect(buildForms(i, computeUs(i)).at(-1)!.code).toBe('FBAR');
  });
});

describe('forms not needed', () => {
  it('lists Form 2555 as not needed, with how to use it, when the exclusion is not claimed', () => {
    const i = base({ foreignEarned: 50_000, ukTaxEarnings: 10_000 });
    const r = computeUs(i);
    const f2555 = formsNotNeeded(i, r).find((f) => f.code === '2555');
    expect(f2555?.why).toMatch(/Claim on Form 2555/);
  });
  it('never lists a form as both needed and not needed', () => {
    for (const over of Object.values(SCENARIOS)) {
      const i = base(over);
      const r = computeUs(i);
      const shown = new Set(buildForms(i, r).map((f) => f.code));
      for (const u of formsNotNeeded(i, r)) expect(shown.has(u.code)).toBe(false);
    }
  });
});
