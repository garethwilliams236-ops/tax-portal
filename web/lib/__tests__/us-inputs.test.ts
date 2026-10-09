import { describe, expect, it } from 'vitest';
import { parseUsForm, prepare } from '@/lib/us/inputs';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('US inputs', () => {
  it('will not compute without a filing status', () => {
    expect(prepare(2025, { amounts: { interest: 100 } })).toEqual({ ok: false, reason: expect.stringMatching(/filing status/) });
  });

  it('will not guess an exchange rate for a year kept in pounds', () => {
    const p = prepare(2025, { status: 'mfs', currency: 'GBP', amounts: { interest: 100 } });
    expect(p.ok).toBe(false);
  });

  it('converts pounds at the rate given, but never US payments', () => {
    const p = prepare(2025, {
      status: 'mfs', currency: 'GBP', usd_per_gbp: 1.25,
      amounts: { foreignEarned: 80_000, usWithholding: 500 },
    });
    if (!p.ok) throw new Error(p.reason);
    expect(p.inputs.foreignEarned).toBe(100_000);
    expect(p.inputs.usWithholding).toBe(500);
  });

  it('keeps blank as absent and reads commas', () => {
    const s = parseUsForm(form({ status: 'mfs', currency: 'GBP', foreignEarned: '80,000', interest: '' }), {});
    expect(s.amounts).toEqual({ foreignEarned: 80_000 });
  });

  it('refuses a filing status it does not know, and a malformed date', () => {
    expect(parseUsForm(form({ status: 'joint-ish' }), {}).status).toBeUndefined();
    expect(() => parseUsForm(form({ filed_on: '15/06/2026' }), {})).toThrow(/not a date/);
  });
});
