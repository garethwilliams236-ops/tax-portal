import { describe, it, expect } from 'vitest';
import { ivorMatch, isPositionQuestion, words } from '../ivor/retrieve';
import { glossaryHits, isDefinitional, GLOSSARY, termText } from '../ivor/glossary';
import { KB, kbField, kbById } from '../ivor/kb';
import { verify } from '../ivor/answer';
import { parseWhere, describeWhere } from '../ivor/where';
import { parseTaxYear, ratesSummary } from '../ivor/rates-summary';
import { yearsCovered, nicRates, incomeTaxRates } from '../tax/rates';
import { computeIncomeTax } from '../tax/income-tax';
import { computeAnnualNic } from '../tax/paye-nic';

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
    expect(verify('The allowance is £10,500 — see NIM06545.', facts).unsupported).toEqual([]);
  });

  it('passes a figure written to two decimal places', () => {
    expect(verify('£10,500.00 is available.', facts).unsupported).toEqual([]);
  });

  it('catches a figure that did not', () => {
    expect(verify('The allowance is £5,000.', facts).unsupported).toContain('£5,000');
  });

  it('catches an invented statutory reference', () => {
    expect(verify('See s.44 of the Act.', facts).unsupported).toContain('s.44');
  });

  it('catches an invented manual reference', () => {
    expect(verify('See NIM99999 for more.', facts).unsupported).toContain('NIM99999');
  });

  it('catches an invented percentage', () => {
    expect(verify('Relief is given at 33%.', facts).unsupported).toContain('33%');
  });
});

describe('worked examples', () => {
  const facts = 'The annual allowance is £60,000, tapered by £1 for every £2 of adjusted income above £260,000, floor £10,000. PTM057100.';

  it('allows invented figures inside a paragraph opened as an example', () => {
    // Refusing these is what made Ivor decline to work the taper through.
    const text = 'The taper reduces the allowance.\n\nExample: adjusted income of £300,000 is £40,000 above £260,000, so the allowance falls by £20,000 to £40,000.';
    const c = verify(text, facts);
    expect(c.unsupported).toEqual([]);
    expect(c.illustrative).toContain('£300,000');
  });

  it('accepts "Suppose" as the same signal', () => {
    const c = verify('Suppose adjusted income is £280,000.', facts);
    expect(c.unsupported).toEqual([]);
    expect(c.illustrative).toContain('£280,000');
  });

  it('still refuses an invented figure outside the example', () => {
    const text = 'The allowance floors at £4,000.\n\nExample: income of £300,000.';
    const c = verify(text, facts);
    expect(c.unsupported).toContain('£4,000');
    expect(c.illustrative).toContain('£300,000');
  });

  it('still refuses an invented reference even inside an example', () => {
    const c = verify('Example: income of £300,000 — see PTM999999.', facts);
    expect(c.unsupported).toContain('PTM999999');
  });
});

describe('pension questions reach pension topics', () => {
  it('does not answer a contributions question with the estate change', () => {
    // The reported failure: asking about relief on pension contributions was
    // answered, repeatedly, about pensions coming into the estate in 2027 —
    // because "pension" appeared in that topic's tags and nowhere else.
    expect(topId('what relief do I get on pension contributions?')).toBe('pension-relief');
    expect(topId('how is a personal pension contribution relieved?')).toBe('pension-relief');
    expect(topId('higher rate relief on pension contributions')).toBe('pension-relief');
  });

  it('routes allowance questions to the allowance topic', () => {
    expect(topId('what is the annual allowance?')).toBe('annual-allowance');
    expect(topId('how does the tapered annual allowance work?')).toBe('annual-allowance');
    expect(topId('can I carry forward unused pension allowance?')).toBe('annual-allowance');
  });

  it('routes company contributions to the employer topic', () => {
    expect(topId('can my company make an employer pension contribution?')).toBe('employer-pension');
  });

  it('still routes the estate question to the estate topic', () => {
    expect(topId('do unused pension funds come into the estate?')).toBe('pensions-iht');
  });

  it('holds the pension acronyms in the glossary', () => {
    expect(glossaryHits('what is the MPAA').map((g) => g.t)).toContain('MPAA');
    expect(glossaryHits('what does TAA mean').map((g) => g.t)).toContain('TAA');
  });
});

describe('reading the page the question was asked from', () => {
  it('reads the entity, tax and period off a tax screen', () => {
    const w = parseWhere('/entity/ardent-advisors-ltd?tax=CT&period=2027-03-31');
    expect(w.slug).toBe('ardent-advisors-ltd');
    expect(w.section).toBe('taxes');
    expect(w.taxType).toBe('CT');
    expect(w.periodKey).toBe('2027-03-31');
  });

  it('reads the payroll and properties screens with their tax year', () => {
    expect(parseWhere('/entity/ardent/payroll?year=2026-27')).toMatchObject({
      slug: 'ardent', section: 'payroll', taxYear: '2026-27',
    });
    expect(parseWhere('/entity/gareth/properties?year=2025-26')).toMatchObject({
      slug: 'gareth', section: 'properties', taxYear: '2025-26',
    });
  });

  it('knows the overview and the pages that are not an entity', () => {
    expect(parseWhere('/').section).toBe('overview');
    expect(parseWhere('/entity/new?type=company').section).toBe('other');
    expect(parseWhere(null).section).toBe('other');
  });

  it('refuses a tax type it does not recognise rather than passing it through', () => {
    expect(parseWhere('/entity/x?tax=NONSENSE').taxType).toBeUndefined();
  });

  it('describes where the user is only when it knows the entity', () => {
    const w = parseWhere('/entity/ardent?tax=CT&period=2027-03-31');
    expect(describeWhere(w, 'Ardent Advisors Ltd')).toMatch(/Ardent Advisors Ltd.*CT.*2027-03-31/);
    expect(describeWhere(w, undefined)).toBeNull();
  });
});

describe('the rate tables cover the years the portal offers', () => {
  it('holds income tax, NIC and pension rates for the working years', () => {
    const cov = yearsCovered();
    for (const y of ['2024-25', '2025-26', '2026-27'] as const) {
      expect(cov.incomeTax, 'income tax').toContain(y);
      expect(cov.nic, 'NIC').toContain(y);
      expect(cov.pensions, 'pensions').toContain(y);
    }
  });

  it('computes income tax in every year it claims to hold', () => {
    for (const y of yearsCovered().incomeTax) {
      const r = computeIncomeTax({ employment: 60_000 }, y);
      expect(r.totalTax, y).toBeGreaterThan(0);
    }
  });

  it('computes NIC in every year it claims to hold', () => {
    for (const y of yearsCovered().nic) {
      const r = computeAnnualNic(30_000, y);
      expect(r.employeeNic, y).toBeGreaterThan(0);
      expect(r.employerNic, y).toBeGreaterThan(0);
    }
  });

  it('carries the April 2025 employer changes, which are the ones most often wrong', () => {
    const before = nicRates('2024-25');
    const after = nicRates('2025-26');
    expect(before.employerRate).toBe(0.138);
    expect(after.employerRate).toBe(0.15);
    // The secondary threshold was CUT, not uprated.
    expect(before.secondaryThreshold).toBe(9_100);
    expect(after.secondaryThreshold).toBe(5_000);
    expect(before.employmentAllowance).toBe(5_000);
    expect(after.employmentAllowance).toBe(10_500);
  });

  it('carries the April 2026 dividend rise', () => {
    const before = incomeTaxRates('2025-26').dividend;
    const after = incomeTaxRates('2026-27').dividend;
    expect(before[0]!.rate).toBeCloseTo(0.0875, 4);
    expect(after[0]!.rate).toBeCloseTo(0.1075, 4);
  });

  it('answers a question about this year’s rates from the rates topic', () => {
    expect(topId('what are the rates and thresholds this year?')).toBe('rates');
    const t = kbById('rates')!;
    expect(kbField(t, 'what')).toMatch(/personal allowance/i);
    expect(kbField(t, 'detail').join(' ')).toMatch(/Employment Allowance/);
  });
});

describe('a question with one recognised word', () => {
  it('answers "show me a worked example of the taper" rather than holding nothing', () => {
    // It scored just under the floor on the single word "taper" and reported
    // that the portal held nothing — about topics whose titles are that word.
    const hits = ivorMatch('SHOW ME A WORKED EXAMPLE FOR THE TAPER');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.topic.id)).toEqual(
      expect.arrayContaining(['taper']),
    );
  });

  it('survives a typo in the words the table does not know anyway', () => {
    expect(ivorMatch('show me a worked example fo rthe taper').length).toBeGreaterThan(0);
  });

  it('offers the other readings of an ambiguous term', () => {
    // "Taper" means three different things in this table: the personal
    // allowance taper, the annual allowance taper, and IHT taper relief.
    const ids = ivorMatch('the taper', 3).map((h) => h.topic.id);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('still refuses a subject the table does not cover, even when one word lands', () => {
    // "rate" is a word the table knows; "stamp" and "second" are not, and they
    // are what the question is actually about.
    expect(ivorMatch('what is the stamp duty rate on a second home?')).toEqual([]);
  });

  it('reads a bare "what is a return" as the topic that explains returns', () => {
    // Not a miss: the ledger topic is titled "Return, then liability, then
    // payment" and is exactly what that question wants.
    expect(ivorMatch('what is a return', 1)[0]?.topic.id).toBe('ledger');
  });
});

describe('a year named in the question', () => {
  it('reads the year out of every form it might be written in', () => {
    expect(parseTaxYear('rates for 2024-25')).toMatchObject({ year: '2024-25', assumed: false });
    expect(parseTaxYear('rates for 2024/25')).toMatchObject({ year: '2024-25', assumed: false });
    expect(parseTaxYear('rates for 2024 to 2025')).toMatchObject({ year: '2024-25', assumed: false });
    expect(parseTaxYear('rates for 24/25')).toMatchObject({ year: '2024-25', assumed: false });
  });

  it('reads a bare year as the year that starts in it, and says it assumed', () => {
    // "the tax rates for 2024" — a UK tax year spans two calendar years, so
    // this is a guess and has to be declared as one.
    expect(parseTaxYear('what were the tax rates for 2024')).toMatchObject({
      year: '2024-25', assumed: true,
    });
  });

  it('finds no year where none is named', () => {
    expect(parseTaxYear('what are the rates and thresholds?')).toBeNull();
  });

  it('gives the figures for the year asked about, not the current one', () => {
    // The failure: asking for 2024 returned 2026-27 figures, silently.
    const asked = ratesSummary('2024-25');
    const now = ratesSummary('2026-27');
    expect(asked.what).toMatch(/2024-25/);
    expect(asked.what).not.toEqual(now.what);
    // The 6 April 2025 employer changes are the visible difference.
    expect(asked.detail.join(' ')).toMatch(/ST £9,100/);
    expect(now.detail.join(' ')).toMatch(/ST £5,000/);
  });

  it('says what it does not hold rather than substituting a year it does', () => {
    const old = ratesSummary('2019-20');
    expect(old.missing).toContain('income tax');
    expect(old.detail.join(' ')).toMatch(/No .*table for 2019-20/);
    expect(old.what).not.toMatch(/12,570/);
  });
});
