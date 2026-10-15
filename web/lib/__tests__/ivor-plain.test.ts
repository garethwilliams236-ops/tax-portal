import { describe, expect, it } from 'vitest';
import { RULES_PLAIN, verify } from '@/lib/ivor/answer';
import { KB, kbField } from '@/lib/ivor/kb';

describe('the plain level', () => {
  it('writes for someone who is not an accountant, under the same grounding rules', () => {
    expect(RULES_PLAIN).toMatch(/NOT an accountant/);
    expect(RULES_PLAIN).not.toMatch(/chartered accountant/);
    expect(RULES_PLAIN).toMatch(/MUST appear in the FACTS block/);
  });

  it('gives every US topic a plain version', () => {
    const us = KB.filter((k) => k.id.startsWith('us-'));
    expect(us.length).toBeGreaterThanOrEqual(23);
    for (const k of us) expect(kbField(k, 'plain').length, k.id).toBeGreaterThan(0);
  });

  it('checks dollar figures as well as pounds', () => {
    expect(verify('The limit is $999,999.', 'The limit is $130,000.').unsupported).toEqual(['$999,999']);
    expect(verify('The limit is $130,000.', 'The limit is $130,000.').unsupported).toEqual([]);
  });
});
