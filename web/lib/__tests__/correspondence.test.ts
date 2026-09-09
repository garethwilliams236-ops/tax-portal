import { describe, it, expect } from 'vitest';
import {
  isOpen, isOverdue, openItems, itemsFor, type CorrespondenceItem,
} from '@/lib/db/correspondence';

/**
 * Overdue is arithmetic against today, not a stored status. The tests below
 * are about the arithmetic, and in particular about the boundary: a letter due
 * TODAY is not late.
 */

const at = (s: string) => new Date(s + 'T00:00:00.000Z');

function item(over: Partial<CorrespondenceItem> = {}): CorrespondenceItem {
  return {
    id: 'x', entityId: 'e',
    happenedOn: at('2026-08-01'),
    direction: 'from_hmrc', channel: 'letter',
    subject: 'A letter', body: null,
    hmrcReference: null, contact: null,
    taxType: null, periodKey: null,
    respondBy: null, resolvedAt: null, resolution: null,
    files: [],
    ...over,
  };
}

describe('whether something is still waiting on you', () => {
  it('is open only when a date to respond by was set and nothing has closed it', () => {
    expect(isOpen(item())).toBe(false);                                   // no date
    expect(isOpen(item({ respondBy: at('2026-09-30') }))).toBe(true);
    expect(isOpen(item({ respondBy: at('2026-09-30'), resolvedAt: at('2026-09-01') }))).toBe(false);
  });

  it('is overdue once the date has passed, and not before', () => {
    const i = item({ respondBy: at('2026-09-10') });
    expect(isOverdue(i, at('2026-09-09'))).toBe(false);
    expect(isOverdue(i, at('2026-09-10'))).toBe(false);   // due today is not late
    expect(isOverdue(i, at('2026-09-11'))).toBe(true);
  });

  it('ignores the time of day, so nothing turns overdue at teatime', () => {
    const i = item({ respondBy: at('2026-09-10') });
    expect(isOverdue(i, new Date('2026-09-10T23:59:00.000Z'))).toBe(false);
  });

  it('is never overdue once it has been closed, however late it was', () => {
    const i = item({ respondBy: at('2020-01-01'), resolvedAt: at('2026-01-01') });
    expect(isOverdue(i, at('2026-09-10'))).toBe(false);
  });

  it('is never overdue with no date — a note is not a task', () => {
    expect(isOverdue(item(), at('2030-01-01'))).toBe(false);
  });
});

describe('the open list', () => {
  it('leads with the soonest, and leaves out what is closed or undated', () => {
    const items = [
      item({ id: 'late', respondBy: at('2026-09-30') }),
      item({ id: 'soon', respondBy: at('2026-09-12') }),
      item({ id: 'closed', respondBy: at('2026-09-01'), resolvedAt: at('2026-09-02') }),
      item({ id: 'note' }),
    ];
    expect(openItems(items).map((i) => i.id)).toEqual(['soon', 'late']);
  });
});

describe('filing a letter against a period', () => {
  it('matches on the tax AND the period, not on either alone', () => {
    const items = [
      item({ id: 'a', taxType: 'CT', periodKey: '2025-03-31' }),
      item({ id: 'b', taxType: 'CT', periodKey: '2026-03-31' }),
      item({ id: 'c', taxType: 'VAT', periodKey: '2025-03-31' }),
      item({ id: 'd' }),
    ];
    expect(itemsFor(items, 'CT', '2025-03-31').map((i) => i.id)).toEqual(['a']);
  });

  it('returns nothing for a period with no letters, rather than everything', () => {
    const items = [item({ id: 'a', taxType: 'CT', periodKey: '2025-03-31' })];
    expect(itemsFor(items, 'CT', '2024-03-31')).toEqual([]);
    expect(itemsFor(items, 'SA', '2025-03-31')).toEqual([]);
  });
});
