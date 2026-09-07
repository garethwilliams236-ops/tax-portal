import { describe, it, expect } from 'vitest';
import { ivorMatch, isPositionQuestion, words } from '../ivor/retrieve';
import { glossaryHits, isDefinitional, GLOSSARY, termText } from '../ivor/glossary';
import { KB, kbField, kbById } from '../ivor/kb';
import { verify } from '../ivor/answer';

const topId = (q: string) => ivorMatch(q, 1)[0]?.topic.id ?? null;

describe('the failures this retrieval exists to prevent', () => {
  it('does not answer a threshold question with the PAYE payment dates', () => {
    // The original bug: "PAYE" and "NIC" appear in paye-dates' tags, the
    // thresholds appeared nowhere, and it answered confidently about the
    // wrong thing.
    const q = 'what does NIC LEL, PT, ST and UEL mean in the context of paye?';
    expect(glossaryHits(q).map((g) => g.t)).toEqual(expect.arrayContaining(['LEL', 'PT', 'ST', 'UEL']));
    expect(isDefinitional(q)).toBe(true);
  });

  it('holds nothing on a subject that is not in the table, rather than guessing', () => {
    expect(ivorMatch('what is the stamp duty rate on a second home?')).toEqual([]);
    expect(ivorMatch('how do I import goods from Norway?')).toEqual([]);
  });

  it('does not let ANI match "associated compANIes"', () => {
    // The phrase bonus fired on a three-character fragment against a title.
    expect(topId('what is ANI')).not.toBe('association');
  });

  it('does not let the word HMRC drag a PAYE question to the notification topic', () => {
    expect(topId('when do I pay HMRC the PAYE for the month?')).toBe('paye-dates');
  });

  it('finds the topic actually asked about', () => {
    expect(topId('how does marginal relief work?')).toBe('ct-rates');
    expect(topId('when is the VAT return due?')).toBe('vat-dates');
    expect(topId('what is a payment on account?')).toBe('poa');
    expect(topId('form 17 on jointly held property')).toBe('form17');
    expect(topId('taper relief on lifetime gifts')).toBe('taper');
  });
});

describe('ledger questions versus rule questions', () => {
  const names = ['Ardent Advisors Ltd', 'Gareth Williams'];

  it('sends a position question to the ledger', () => {
    expect(isPositionQuestion('what do I owe?', names)).toBe(true);
    expect(isPositionQuestion('what is overdue?', names)).toBe(true);
    expect(isPositionQuestion('is anything outstanding for Ardent Advisors Ltd?', names)).toBe(true);
  });

  it('leaves a question about the rule to the authority table', () => {
    expect(isPositionQuestion('when is the VAT return due?', names)).toBe(false);
    expect(isPositionQuestion('how does outstanding work?', names)).toBe(false);
    expect(isPositionQuestion('what does outstanding mean?', names)).toBe(false);
  });

  it('is not triggered at all by a question with no position vocabulary', () => {
    expect(isPositionQuestion('how does marginal relief work?', names)).toBe(false);
  });
});

describe('the glossary', () => {
  it('matches acronyms as whole words, not fragments', () => {
    expect(glossaryHits('what is the PT').map((g) => g.t)).toContain('PT');
    // "part" must not match "PT", and "least" must not match "LEL".
    expect(glossaryHits('what part of the year').map((g) => g.t)).not.toContain('PT');
  });

  it('renders every term without throwing', () => {
    for (const g of GLOSSARY) {
      const text = termText(g);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it('points every "see also" at a topic that exists', () => {
    for (const g of GLOSSARY) {
      if (g.see) expect(kbById(g.see), `${g.t} -> ${g.see}`).not.toBeNull();
    }
  });
});

describe('the authority table', () => {
  it('renders every topic without throwing', () => {
    for (const k of KB) {
      expect(kbField(k, 'what').length, k.id).toBeGreaterThan(20);
      expect(Array.isArray(kbField(k, 'detail'))).toBe(true);
    }
  });

  it('gives every topic a unique id', () => {
    const ids = KB.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states the unresolved BPR allowance as a judgement rather than picking a number', () => {
    const bpr = kbById('bpr')!;
    expect(bpr.judgement).toMatch(/unresolved/i);
    expect(bpr.judgement).toMatch(/£1m/);
    expect(bpr.judgement).toMatch(/£2\.5m/);
  });

  it('drops stopwords that identify nothing in a tax knowledge base', () => {
    expect(words('what does HMRC tax mean')).toEqual([]);
  });
});

describe('checking what a model wrote against what it was given', () => {
  const facts = 'The Employment Allowance is £10,500 against employer secondary Class 1 NIC. NICA 2014 s.3 applies. NIM06545.';

  it('passes figures that came from the facts', () => {
    expect(verify('The allowance is £10,500 — see NIM06545.', facts)).toEqual([]);
  });

  it('passes a figure written to two decimal places', () => {
    expect(verify('£10,500.00 is available.', facts)).toEqual([]);
  });

  it('catches a figure that did not', () => {
    expect(verify('The allowance is £5,000.', facts)).toContain('£5,000');
  });

  it('catches an invented statutory reference', () => {
    expect(verify('See s.44 of the Act.', facts)).toContain('s.44');
  });

  it('catches an invented manual reference', () => {
    expect(verify('See NIM99999 for more.', facts)).toContain('NIM99999');
  });

  it('catches an invented percentage', () => {
    expect(verify('Relief is given at 33%.', facts)).toContain('33%');
  });
});
