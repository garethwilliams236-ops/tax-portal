import { describe, it, expect } from 'vitest';
import { docsFor, applyFilter, filtersOf, humanSize, type DocumentRow } from '@/lib/db/documents';

/**
 * One store, two doors: a scan attached to a letter and a set of accounts
 * filed directly are the same row. The tests below are mostly about not
 * losing half of them to a filter.
 */

const at = (s: string) => new Date(s + 'T00:00:00.000Z');

function doc(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'd1', entityId: 'e1',
    category: 'accounts', taxType: 'CT', periodLabel: '2026-03-31',
    fileName: 'accounts.pdf', contentType: 'application/pdf',
    sizeBytes: 240_000, uploadedAt: at('2026-09-01'),
    correspondenceId: null, correspondenceSubject: null,
    ...over,
  };
}

describe('documents on a period', () => {
  it('matches on the tax AND the period, not on either alone', () => {
    const docs = [
      doc({ id: 'a' }),
      doc({ id: 'b', periodLabel: '2025-03-31' }),
      doc({ id: 'c', taxType: 'VAT' }),
      doc({ id: 'd', taxType: null, periodLabel: null }),
    ];
    expect(docsFor(docs, 'CT', '2026-03-31').map((d) => d.id)).toEqual(['a']);
  });

  it('does not put an unfiled document on every period', () => {
    // A document filed against Corporation Tax generally, with no period, must
    // not appear on each period's screen pretending to belong there.
    const docs = [doc({ id: 'general', periodLabel: null })];
    expect(docsFor(docs, 'CT', '2026-03-31')).toEqual([]);
  });
});

describe('the filters', () => {
  const docs = [
    doc({ id: 'accounts' }),
    doc({ id: 'letter', category: 'hmrc_notice', correspondenceId: 'c1', correspondenceSubject: 'Late filing' }),
    doc({ id: 'deed', category: 'deed', taxType: null, periodLabel: null }),
  ];

  it('returns everything when nothing is chosen', () => {
    expect(applyFilter(docs, {})).toHaveLength(3);
  });

  it('narrows by category, tax and period independently', () => {
    expect(applyFilter(docs, { category: 'deed' }).map((d) => d.id)).toEqual(['deed']);
    expect(applyFilter(docs, { tax: 'CT' }).map((d) => d.id)).toEqual(['accounts', 'letter']);
    expect(applyFilter(docs, { period: '2026-03-31' }).map((d) => d.id)).toEqual(['accounts', 'letter']);
  });

  it('combines filters rather than widening', () => {
    expect(applyFilter(docs, { tax: 'CT', category: 'deed' })).toEqual([]);
  });

  it('separates what came from a letter from what was filed directly', () => {
    expect(applyFilter(docs, { source: 'letter' }).map((d) => d.id)).toEqual(['letter']);
    expect(applyFilter(docs, { source: 'filed' }).map((d) => d.id)).toEqual(['accounts', 'deed']);
  });

  it('offers only the filters something actually has', () => {
    const f = filtersOf(docs);
    expect(f.categories.sort()).toEqual(['accounts', 'deed', 'hmrc_notice']);
    expect(f.taxes).toEqual(['CT']);
    expect(f.periods).toEqual(['2026-03-31']);
  });

  it('leaves nulls out of the offered filters rather than offering an empty one', () => {
    const f = filtersOf([doc({ category: null, taxType: null, periodLabel: null })]);
    expect(f.categories).toEqual([]);
    expect(f.taxes).toEqual([]);
    expect(f.periods).toEqual([]);
  });
});

describe('sizes', () => {
  it('reads in KB below a megabyte and MB above', () => {
    expect(humanSize(240_000)).toBe('234 KB');
    expect(humanSize(2_400_000)).toBe('2.3 MB');
  });

  it('never shows a file as 0 KB', () => {
    expect(humanSize(120)).toBe('1 KB');
  });

  it('says nothing when the size was never recorded', () => {
    expect(humanSize(null)).toBe('');
  });
});
