import Link from 'next/link';
import type { Item } from '@/lib/db/tasks';
import type { Backlog } from '@/lib/db/nudges';
import type { EntityRow } from '@/lib/db/queries';
import { fmtD, daysTo } from '@/lib/format';

/**
 * The combined list, as a narrow column beside the overview.
 *
 * Top level only: what it is, whose it is, and how long there is. No detail
 * paragraph and no controls — a column this narrow cannot carry them, and the
 * place to act on something is that entity's own to-do tab, which is one click
 * away on every line.
 *
 * Grouped by WHEN, then by entity within. A tax portal has several senses of
 * "period"; the one that matters when scanning a list of things to do is the
 * month the deadline falls in, so that is the heading.
 */

const MONTH = (d: Date) =>
  d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

interface Group {
  label: string;
  /** For ordering. Overdue sorts first, undated last. */
  rank: number;
  items: Item[];
}

function group(items: Item[], asAt: Date): Group[] {
  const by = new Map<string, Group>();

  for (const i of items) {
    let label: string;
    let rank: number;

    if (!i.dueDate) {
      label = 'No date';
      rank = Number.MAX_SAFE_INTEGER;
    } else if (i.dueDate < asAt) {
      label = 'Overdue';
      rank = -1;
    } else {
      label = MONTH(i.dueDate);
      rank = Date.UTC(i.dueDate.getUTCFullYear(), i.dueDate.getUTCMonth(), 1);
    }

    const g = by.get(label);
    if (g) g.items.push(i);
    else by.set(label, { label, rank, items: [i] });
  }

  // Within a group, keep entities together and order them by their soonest item.
  for (const g of by.values()) {
    g.items.sort((a, b) => {
      const an = a.entityName ?? '';
      const bn = b.entityName ?? '';
      if (an !== bn) return an.localeCompare(bn);
      return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
    });
  }

  return [...by.values()].sort((a, b) => a.rank - b.rank);
}

export function ToDoRail({
  items, backlog, entities, asAt,
}: {
  items: Item[]; backlog: Backlog[]; entities: EntityRow[]; asAt: Date;
}) {
  const slugOf = new Map(entities.map((e) => [e.id, e.slug]));
  const groups = group(items, asAt);

  return (
    <aside className="w-full xl:sticky xl:top-4 xl:w-[260px] xl:shrink-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
          What needs doing
        </h2>
        {items.length > 0 && <span className="pill pill-mute">{items.length}</span>}
      </div>

      {groups.length === 0 ? (
        <div className="tw px-3 py-5 text-center text-[12px]" style={{ color: 'var(--muted)' }}>
          Nothing due, nothing unanswered.
        </div>
      ) : (
        <div className="tw overflow-hidden">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="border-b px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider"
                style={{
                  borderColor: 'var(--line2)',
                  background: g.label === 'Overdue' ? 'var(--crit-bg)' : 'var(--panel2)',
                  color: g.label === 'Overdue' ? 'var(--crit)' : 'var(--muted)',
                }}>
                {g.label}
              </div>

              {g.items.map((i, n) => {
                const prev = g.items[n - 1];
                const newEntity = !prev || prev.entityName !== i.entityName;
                const days = i.dueDate ? daysTo(i.dueDate, asAt) : null;
                const slug = i.entityId ? slugOf.get(i.entityId) : undefined;
                const href = slug ? `/entity/${slug}/todo` : '/';

                return (
                  <div key={i.key}>
                    {newEntity && i.entityName && (
                      <div className="px-3 pt-2 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                        {i.entityName}
                      </div>
                    )}
                    <Link href={href}
                      className="block border-b px-3 py-1.5 last:border-0"
                      style={{ borderColor: 'var(--line2)' }}>
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[10.5px] tabular-nums"
                          style={{ color: days !== null && days < 0 ? 'var(--crit)' : 'var(--muted)' }}>
                          {days === null ? `p${i.priority}`
                            : days < 0 ? `${Math.abs(days)}d late`
                            : days === 0 ? 'today'
                            : `${days}d`}
                        </span>
                        <span className="text-[12px] leading-snug">{shorten(i.title)}</span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {backlog.length > 0 && (
        <div className="tw mt-3 px-3 py-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Backlog
          </div>
          {backlog.map((b) => {
            const slug = slugOf.get(b.entityId);
            return (
              <Link key={b.entityId} href={slug ? `/entity/${slug}` : '/'}
                className="block border-t py-1.5 text-[11.5px] first:border-0"
                style={{ borderColor: 'var(--line2)' }}>
                <span className="font-medium">{b.entityName}</span>
                <span className="block" style={{ color: 'var(--muted)' }}>
                  {b.count} period{b.count === 1 ? '' : 's'} with no record, from {fmtD(b.oldest)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}

/**
 * The rules write a full sentence, including the entity name and the
 * escalation. In a 260px column the entity name is already a heading and the
 * escalation is already the pill, so both are dropped from the line itself.
 */
function shorten(title: string): string {
  return title
    .replace(/\s+—\s+\d+ days OVERDUE$/, '')
    .replace(/\s+—\s+(?:OVERDUE|due (?:tomorrow|within \d+ days))$/, '')
    .replace(/^[^:]{1,60}(?:Ltd|Limited|plc|LLP):\s*/, '');
}
