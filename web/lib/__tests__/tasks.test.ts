import { describe, it, expect } from 'vitest';
import {
  isHidden, merge, live, settled, orphaned, taskKey,
  type TaskRow, type Item,
} from '@/lib/db/tasks';
import type { Nudge } from '@/lib/tax/nudges';

/**
 * The split this file exists to protect: a NUDGE is derived and disappears
 * when its cause does; a TASK ROW is the decision you took about one, and is
 * the only part stored. Everything below tests the join between them.
 */

const at = (s: string) => new Date(s + 'T00:00:00.000Z');

function nudge(over: Partial<Nudge> = {}): Nudge {
  return {
    entityId: 'e1', entityName: 'Acme Ltd',
    ruleKey: 'deadline:CT:filing', periodKey: '2026-03-31',
    title: 'CT600 due', detail: 'Acme Ltd: CT600 due.',
    category: 'filing', priority: 3,
    dueDate: at('2026-12-31'),
    ...over,
  };
}

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1', entityId: 'e1',
    title: 'CT600 due', detail: null,
    origin: 'nudge',
    ruleKey: 'deadline:CT:filing', periodKey: '2026-03-31',
    category: 'filing', priority: 3,
    dueDate: at('2026-12-31'),
    status: 'open', snoozedUntil: null, completedAt: null,
    ...over,
  };
}

describe('whether a decision hides something', () => {
  it('hides nothing when no decision was taken', () => {
    expect(isHidden(null, at('2026-09-10'))).toBe(false);
    expect(isHidden(task({ status: 'open' }), at('2026-09-10'))).toBe(false);
  });

  it('hides what was dismissed or done', () => {
    expect(isHidden(task({ status: 'dismissed' }), at('2026-09-10'))).toBe(true);
    expect(isHidden(task({ status: 'done' }), at('2026-09-10'))).toBe(true);
  });

  it('brings a snooze back on its own once the date arrives', () => {
    const t = task({ status: 'snoozed', snoozedUntil: at('2026-09-17') });
    expect(isHidden(t, at('2026-09-16'))).toBe(true);
    expect(isHidden(t, at('2026-09-17'))).toBe(false);   // back on the day
    expect(isHidden(t, at('2026-09-18'))).toBe(false);
  });

  it('ignores the time of day, so nothing returns at teatime', () => {
    const t = task({ status: 'snoozed', snoozedUntil: at('2026-09-17') });
    expect(isHidden(t, new Date('2026-09-16T23:59:00.000Z'))).toBe(true);
    expect(isHidden(t, new Date('2026-09-17T00:01:00.000Z'))).toBe(false);
  });

  it('treats a snooze with no date as no longer hiding anything', () => {
    expect(isHidden(task({ status: 'snoozed', snoozedUntil: null }), at('2026-09-10'))).toBe(false);
  });
});

describe('joining nudges to decisions', () => {
  it('matches a decision to its nudge by entity, rule and period', () => {
    const items = merge([nudge()], [task({ status: 'done' })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.task?.status).toBe('done');
  });

  it('does not match a decision about a DIFFERENT period', () => {
    const items = merge([nudge()], [task({ periodKey: '2025-03-31', status: 'done' })]);
    expect(items[0]!.task).toBeNull();
  });

  it('does not match a decision about a different entity', () => {
    const items = merge([nudge()], [task({ entityId: 'e2', status: 'done' })]);
    expect(items[0]!.task).toBeNull();
  });

  it('takes the title from the NUDGE, not the stored row', () => {
    // The row's copy is for reading the database later; the screen must show
    // what is true now — a deadline's title escalates as the date approaches.
    const items = merge([nudge({ title: '3 days OVERDUE' })], [task({ title: 'due within 30 days' })]);
    expect(items[0]!.title).toBe('3 days OVERDUE');
  });

  it('carries manual to-dos through, and never matches them to a rule', () => {
    const manual = task({ id: 'm1', origin: 'manual', ruleKey: null, periodKey: null, title: 'Ring the bank' });
    const items = merge([nudge()], [manual]);
    expect(items).toHaveLength(2);
    const m = items.find((i) => i.manual)!;
    expect(m.title).toBe('Ring the bank');
    expect(m.key).toBe('manual:m1');
  });

  it('orders by priority, then by what is due soonest', () => {
    const items = merge([
      nudge({ ruleKey: 'a', priority: 3, dueDate: at('2026-10-01') }),
      nudge({ ruleKey: 'b', priority: 1, dueDate: at('2026-12-01') }),
      nudge({ ruleKey: 'c', priority: 3, dueDate: at('2026-09-15') }),
    ], []);
    expect(items.map((i) => i.key.split('|')[1])).toEqual(['b', 'c', 'a']);
  });

  it('puts an item with no due date last within its priority', () => {
    const items = merge([
      nudge({ ruleKey: 'dated', priority: 3, dueDate: at('2027-01-01') }),
      nudge({ ruleKey: 'undated', priority: 3, dueDate: undefined }),
    ], []);
    expect(items.map((i) => i.key.split('|')[1])).toEqual(['dated', 'undated']);
  });
});

describe('what is actually on the list', () => {
  const items: Item[] = merge(
    [
      nudge({ ruleKey: 'open' }),
      nudge({ ruleKey: 'snoozed' }),
      nudge({ ruleKey: 'done' }),
    ],
    [
      task({ id: 't2', ruleKey: 'snoozed', status: 'snoozed', snoozedUntil: at('2026-10-01') }),
      task({ id: 't3', ruleKey: 'done', status: 'done' }),
    ],
  );

  it('shows what has not been put aside', () => {
    expect(live(items, at('2026-09-10')).map((i) => i.key.split('|')[1])).toEqual(['open']);
  });

  it('shows the rest separately rather than losing it', () => {
    expect(settled(items, at('2026-09-10')).map((i) => i.key.split('|')[1]).sort())
      .toEqual(['done', 'snoozed']);
  });

  it('returns the snoozed one to the list when its date arrives', () => {
    expect(live(items, at('2026-10-01')).map((i) => i.key.split('|')[1]).sort())
      .toEqual(['open', 'snoozed']);
  });
});

describe('decisions with nothing left to decide', () => {
  it('finds a stored decision whose nudge has gone', () => {
    // The return was filed, so the deadline nudge is no longer raised.
    const stale = task({ id: 't9', ruleKey: 'deadline:VAT:filing', periodKey: '2026-06-30', status: 'done' });
    expect(orphaned([nudge()], [task(), stale]).map((t) => t.id)).toEqual(['t9']);
  });

  it('never calls a manual to-do an orphan — nothing derives it', () => {
    const manual = task({ id: 'm1', origin: 'manual', ruleKey: null, periodKey: null });
    expect(orphaned([], [manual])).toEqual([]);
  });
});

describe('the identity a decision is stored under', () => {
  it('is the same one the rules emit, so deciding twice updates one row', () => {
    const n = nudge();
    expect(taskKey(n.entityId, n.ruleKey, n.periodKey)).toBe('e1|deadline:CT:filing|2026-03-31');
  });

  it('handles a nudge that belongs to no single entity', () => {
    expect(taskKey(null, 'planning:isa', '2026-27')).toBe('all|planning:isa|2026-27');
  });
});
