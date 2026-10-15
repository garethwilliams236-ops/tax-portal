import { describe, expect, it } from 'vitest';
import { ivorMatch } from '@/lib/ivor/retrieve';

describe('Ivor finds the US topics', () => {
  it.each([
    ['should she file married filing separately or head of household?', 'us-filing-status'],
    ['foreign earned income exclusion or foreign tax credit for UK salary', 'us-feie-ftc'],
    ['does the foreign tax credit reduce NIIT?', 'us-niit'],
    ['when is the FBAR due', 'us-fbar-8938'],
    ['when is the 1040 due for someone living abroad', 'us-deadlines'],
    ['how do I compare the exclusion and the credit on the screen', 'us-screen'],
    ['are my ISA funds a problem for the IRS', 'us-pfic'],
    ['do I pay US self employment tax and national insurance', 'us-se-tax'],
  ])('%s', (q, id) => {
    expect(ivorMatch(q)[0]?.topic.id).toBe(id);
  });
});
