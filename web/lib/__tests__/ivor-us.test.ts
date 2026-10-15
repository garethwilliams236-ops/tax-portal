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

describe('Ivor answers her everyday questions', () => {
  it.each([
    ['do I have to file a US tax return?', 'us-need-to-file'],
    ['why do I file a US return when I live in the UK', 'us-why-file'],
    ['where do I start, what documents do I need', 'us-getting-started'],
    ['my P60 is April to April, which year do I use', 'us-tax-year'],
    ['what exchange rate do I use to convert pounds', 'us-exchange-rate'],
    ['can I get the child tax credit refund', 'us-ctc'],
    ['how is my UK workplace pension treated', 'us-uk-pensions'],
    ['I am a director of my husband\'s company, do I need form 5471', 'us-uk-company'],
    ['my husband gave me money, is that a gift I report', 'us-gifts-spouse'],
    ['do I need to file a state return', 'us-state-tax'],
    ['I have never filed, how do I catch up on missed years', 'us-catching-up'],
    ['we are selling our house', 'us-house-sale'],
    ['what is the standard deduction', 'us-deduction-brackets'],
  ])('%s', (q, id) => {
    expect(ivorMatch(q)[0]?.topic.id).toBe(id);
  });
});
