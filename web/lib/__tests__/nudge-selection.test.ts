import { describe, it, expect } from 'vitest';
import { selectObligations } from '@/lib/db/nudges';
import type { Obligation } from '@/lib/tax/obligations';

/**
 * What is worth raising today, and what is only a backlog.
 *
 * This exists because the first version looked back 400 days and put twenty-six
 * red PAYE lines at the top of the screen, going back to August 2025 — for
 * payments the portal had never been told anything about. A nudge engine that
 * does that is one you stop reading within a fortnight.
 */

const at = (s: string) => new Date(s + 'T00:00:00.000Z');
const TODAY = at('2026-09-10');
const LOOKBACK = at('2026-06-12');   // 90 days back

function ob(over: Partial<Obligation> = {}): Obligation {
  return {
    entityId: 'e1', entityName: 'Acme Ltd',
    taxType: 'PAYE', kind: 'payment',
    description: 'PAYE/NIC monthly payment',
    periodEnd: at('2025-08-05'),
    dueDate: at('2025-08-22'),
    ...over,
  };
}

const select = (all: Obligation[], filed: string[] = [], owed: string[] = []) =>
  selectObligations(all, {
    filed: new Set(filed), owed: new Set(owed),
    asAt: TODAY, lookbackFrom: LOOKBACK,
  });

describe('what still gets raised', () => {
  it('always raises something not yet due — that is what a reminder is', () => {
    const o = ob({ dueDate: at('2026-10-22'), periodEnd: at('2026-10-05') });
    expect(select([o]).obligations).toHaveLength(1);
  });

  it('raises a future deadline even with nothing recorded against it', () => {
    // The portal needs no evidence to remind you of a statutory date.
    const o = ob({ taxType: 'CT', kind: 'filing', dueDate: at('2026-09-30'), periodEnd: at('2025-09-30') });
    expect(select([o]).obligations).toHaveLength(1);
  });

  it('raises a recent overdue FILING, because an unfiled return is known', () => {
    const o = ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2026-08-07'), periodEnd: at('2026-06-30') });
    expect(select([o]).obligations).toHaveLength(1);
  });

  it('raises a recent overdue PAYMENT only when the ledger says money is owed', () => {
    const o = ob({ dueDate: at('2026-08-22'), periodEnd: at('2026-08-05') });
    expect(select([o]).obligations).toHaveLength(0);
    expect(select([o], [], ['e1|PAYE|2026-08-05']).obligations).toHaveLength(1);
  });
});

describe('what is silenced', () => {
  it('silences a filing deadline once the return is filed', () => {
    const o = ob({ taxType: 'CT', kind: 'filing', dueDate: at('2026-09-30'), periodEnd: at('2025-09-30') });
    expect(select([o], ['e1|CT|2025-09-30']).obligations).toHaveLength(0);
  });

  it('does NOT raise a year-old PAYE payment the portal was never told about', () => {
    // The exact case that produced twenty-six red lines. Absence of a liability
    // is evidence the portal was never told, not evidence money is owed.
    const months = ['2025-08-22', '2025-09-22', '2025-10-22', '2025-11-22', '2025-12-22'];
    const all = months.map((d) => ob({ dueDate: at(d), periodEnd: at(d.slice(0, 8) + '05') }));
    const r = select(all);
    expect(r.obligations).toHaveLength(0);
    // Nor is it backlog: there is nothing to catch up on, only nothing recorded.
    expect(r.backlog).toHaveLength(0);
  });

  it('still raises an old PAYE payment the ledger says is unpaid', () => {
    // Real money outstanding is a real alarm, however old.
    const o = ob({ dueDate: at('2025-08-22'), periodEnd: at('2025-08-05') });
    const r = select([o], [], ['e1|PAYE|2025-08-05']);
    // Outside the lookback window, so it is backlog rather than a daily nudge —
    // but it is counted, not dropped.
    expect(r.obligations).toHaveLength(0);
    expect(r.backlog[0]!.count).toBe(1);
  });
});

describe('the backlog', () => {
  it('counts old unfiled FILINGS once per entity, with the oldest date', () => {
    const all = [
      ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2025-05-07'), periodEnd: at('2025-03-31') }),
      ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2025-08-07'), periodEnd: at('2025-06-30') }),
      ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2025-11-07'), periodEnd: at('2025-09-30') }),
    ];
    const r = select(all);
    expect(r.obligations).toHaveLength(0);
    expect(r.backlog).toHaveLength(1);
    expect(r.backlog[0]!.count).toBe(3);
    expect(r.backlog[0]!.oldest).toEqual(at('2025-05-07'));
  });

  it('keeps entities apart', () => {
    const all = [
      ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2025-05-07'), periodEnd: at('2025-03-31') }),
      ob({ entityId: 'e2', entityName: 'Beta Ltd', taxType: 'VAT', kind: 'filing', dueDate: at('2025-05-07'), periodEnd: at('2025-03-31') }),
    ];
    expect(select(all).backlog.map((b) => b.entityName).sort()).toEqual(['Acme Ltd', 'Beta Ltd']);
  });

  it('does not count something already filed as backlog', () => {
    const o = ob({ taxType: 'VAT', kind: 'filing', dueDate: at('2025-05-07'), periodEnd: at('2025-03-31') });
    expect(select([o], ['e1|VAT|2025-03-31']).backlog).toHaveLength(0);
  });
});

describe('the boundary', () => {
  it('treats a deadline due today as still to come, not overdue', () => {
    const o = ob({ taxType: 'CT', kind: 'filing', dueDate: TODAY, periodEnd: at('2025-09-30') });
    expect(select([o]).obligations).toHaveLength(1);
  });

  it('keeps an overdue filing inside the window on the list, and moves it out beyond it', () => {
    const inside = ob({ taxType: 'CT', kind: 'filing', dueDate: at('2026-06-12'), periodEnd: at('2025-06-30') });
    const outside = ob({ taxType: 'CT', kind: 'filing', dueDate: at('2026-06-11'), periodEnd: at('2025-06-29') });
    expect(select([inside]).obligations).toHaveLength(1);
    expect(select([outside]).obligations).toHaveLength(0);
    expect(select([outside]).backlog).toHaveLength(1);
  });
});
