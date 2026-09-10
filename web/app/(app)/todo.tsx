import { decideNudge, addTask, setTaskStatus, deleteTask } from '@/lib/actions/tasks';
import { type Item, type TaskRow } from '@/lib/db/tasks';
import type { Backlog } from '@/lib/db/nudges';
import type { EntityRow } from '@/lib/db/queries';
import { fmtD, daysTo } from '@/lib/format';

/**
 * The to-do list.
 *
 * Ordered by the rules' own priority, which escalates on its own as a deadline
 * approaches — so the list reorders itself without anything having to run. An
 * item you put aside comes back the same way, when its snooze date passes.
 */

const CATEGORY_LABEL: Record<string, string> = {
  filing: 'filing', payment: 'payment', planning: 'planning',
  data: 'data', correspondence: 'letter', structural: 'structure',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ToDo({
  live, settled, orphans, backlog, entities, asAt,
}: {
  live: Item[]; settled: Item[]; orphans: TaskRow[]; backlog: Backlog[];
  entities: EntityRow[]; asAt: Date;
}) {
  const entityBySlug = new Map(entities.map((e) => [e.id, e]));
  return (
    <>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
          What needs doing
        </h2>
        {live.length > 0 && (
          <span className="pill pill-mute">{live.length}</span>
        )}
      </div>

      {live.length === 0 ? (
        <div className="tw px-4 py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
          Nothing due in the next 45 days, nothing unanswered, nothing put aside that has come back.
        </div>
      ) : (
        <div className="tw divide-y" style={{ borderColor: 'var(--line2)' }}>
          {live.map((i) => <Row key={i.key} item={i} asAt={asAt} />)}
        </div>
      )}

      {backlog.length > 0 && (
        <div className="tw mt-3 p-3">
          <p className="mb-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Older periods with nothing recorded. Not shown above, because a deadline three hundred days
            past is a backlog rather than something to do today — and because the portal holding no
            liability for a period is evidence it was never told, not evidence money is owed.
          </p>
          {backlog.map((b) => {
            const e = entityBySlug.get(b.entityId);
            return (
              <div key={b.entityId} className="flex flex-wrap items-baseline gap-2 border-t py-1.5 text-[12.5px]"
                style={{ borderColor: 'var(--line2)' }}>
                <span className="font-medium">{b.entityName}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {b.count} period{b.count === 1 ? '' : 's'} with no record, oldest {fmtD(b.oldest)}
                </span>
                <span className="flex-1" />
                {e && (
                  <a href={`/entity/${e.slug}`} className="text-[11.5px] underline" style={{ color: 'var(--muted)' }}>
                    open {e.name}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <details>
          <summary className="btn cursor-pointer text-[12px]">Add a to-do</summary>
          <form action={addTask} className="mt-2 w-[380px] space-y-2 rounded-lg border p-3"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
            <input name="title" required className="input" placeholder="What needs doing" />
            <textarea name="detail" rows={2} className="input" placeholder="Any detail (optional)" />
            <div className="grid grid-cols-3 gap-2">
              <select name="entity_id" className="input" defaultValue="">
                <option value="">All entities</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select name="category" className="input" defaultValue="">
                <option value="">No category</option>
                {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select name="priority" className="input" defaultValue="3">
                <option value="1">1 — now</option>
                <option value="2">2</option>
                <option value="3">3 — normal</option>
                <option value="4">4</option>
                <option value="5">5 — someday</option>
              </select>
            </div>
            <input name="due_date" type="date" className="input" />
            <button className="btn btn-pri w-full text-[12px]" type="submit">Add</button>
          </form>
        </details>

        {settled.length > 0 && (
          <details>
            <summary className="cursor-pointer pt-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
              Put aside — {settled.length}
            </summary>
            <div className="tw mt-2 divide-y" style={{ borderColor: 'var(--line2)' }}>
              {settled.map((i) => <Row key={i.key} item={i} asAt={asAt} muted />)}
            </div>
          </details>
        )}

        {orphans.length > 0 && (
          <details>
            <summary className="cursor-pointer pt-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
              Decisions with nothing left to decide — {orphans.length}
            </summary>
            <div className="tw mt-2 p-3">
              <p className="mb-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                These record a decision about something the portal no longer raises — the return was filed,
                the letter answered, the period passed. Nothing is removed automatically, because the row is
                the only evidence the decision was taken.
              </p>
              {orphans.map((t) => (
                <div key={t.id} className="flex items-baseline gap-2 border-t py-1.5 text-[12.5px]"
                  style={{ borderColor: 'var(--line2)' }}>
                  <span style={{ color: 'var(--muted)' }}>{t.status}</span>
                  <span>{t.title}</span>
                  <span className="flex-1" />
                  <form action={deleteTask}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="text-[11.5px] underline" style={{ color: 'var(--muted)' }}>
                      forget it
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  );
}

function Row({ item, asAt, muted }: { item: Item; asAt: Date; muted?: boolean }) {
  const days = item.dueDate ? daysTo(item.dueDate, asAt) : null;
  const late = days !== null && days < 0;

  const tone = late ? 'pill-crit'
    : item.priority <= 1 ? 'pill-crit'
    : item.priority === 2 ? 'pill-warn'
    : 'pill-mute';

  return (
    <div className="px-4 py-3" style={{ opacity: muted ? 0.65 : 1 }}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={`pill ${tone}`}>
          {late ? `${Math.abs(days!)}d late` : days === null ? `p${item.priority}` : days === 0 ? 'today' : `${days}d`}
        </span>
        {item.category && (
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {CATEGORY_LABEL[item.category] ?? item.category}
          </span>
        )}
        <span className="text-[13.5px] font-medium">{item.title}</span>
        <span className="flex-1" />
        {item.task && (
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {item.task.status === 'snoozed' && item.task.snoozedUntil
              ? `snoozed to ${fmtD(item.task.snoozedUntil)}`
              : item.task.status}
          </span>
        )}
      </div>

      {item.detail && (
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {item.detail}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.manual ? (
          <ManualControls item={item} />
        ) : (
          <NudgeControls item={item} />
        )}
      </div>
    </div>
  );
}

/** The hidden fields that carry a derived nudge's identity into the decision. */
function NudgeFields({ item, status, snooze }: { item: Item; status: string; snooze?: string }) {
  const [entityId, ruleKey, periodKey] = item.key.split('|');
  return (
    <>
      <input type="hidden" name="entity_id" value={entityId === 'all' ? '' : entityId} />
      <input type="hidden" name="rule_key" value={ruleKey ?? ''} />
      <input type="hidden" name="period_key" value={periodKey ?? ''} />
      <input type="hidden" name="title" value={item.title} />
      <input type="hidden" name="detail" value={item.detail} />
      <input type="hidden" name="category" value={item.category ?? ''} />
      <input type="hidden" name="priority" value={String(item.priority)} />
      <input type="hidden" name="due_date" value={item.dueDate ? iso(item.dueDate) : ''} />
      <input type="hidden" name="status" value={status} />
      {snooze && <input type="hidden" name="snooze" value={snooze} />}
    </>
  );
}

function NudgeControls({ item }: { item: Item }) {
  const decided = item.task && item.task.status !== 'open';
  return (
    <>
      {decided ? (
        <form action={decideNudge}>
          <NudgeFields item={item} status="open" />
          <button className="btn text-[11.5px]" type="submit">Put it back</button>
        </form>
      ) : (
        <>
          <form action={decideNudge}>
            <NudgeFields item={item} status="done" />
            <button className="btn text-[11.5px]" type="submit">Done</button>
          </form>
          {(['week', 'fortnight', 'month'] as const).map((s) => (
            <form key={s} action={decideNudge}>
              <NudgeFields item={item} status="snoozed" snooze={s} />
              <button className="btn text-[11.5px]" type="submit">
                {s === 'week' ? '+1w' : s === 'fortnight' ? '+2w' : '+1m'}
              </button>
            </form>
          ))}
          <form action={decideNudge}>
            <NudgeFields item={item} status="dismissed" />
            <button className="text-[11.5px] underline" type="submit" style={{ color: 'var(--muted)' }}>
              not relevant
            </button>
          </form>
        </>
      )}
    </>
  );
}

function ManualControls({ item }: { item: Item }) {
  const t = item.task!;
  return (
    <>
      {t.status === 'open' ? (
        <>
          <form action={setTaskStatus}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="status" value="done" />
            <button className="btn text-[11.5px]" type="submit">Done</button>
          </form>
          {(['week', 'fortnight', 'month'] as const).map((s) => (
            <form key={s} action={setTaskStatus}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="status" value="snoozed" />
              <input type="hidden" name="snooze" value={s} />
              <button className="btn text-[11.5px]" type="submit">
                {s === 'week' ? '+1w' : s === 'fortnight' ? '+2w' : '+1m'}
              </button>
            </form>
          ))}
        </>
      ) : (
        <form action={setTaskStatus}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="status" value="open" />
          <button className="btn text-[11.5px]" type="submit">Put it back</button>
        </form>
      )}
      <span className="flex-1" />
      <form action={deleteTask}>
        <input type="hidden" name="id" value={t.id} />
        <button type="submit" className="text-[11.5px] underline" style={{ color: 'var(--muted)' }}>
          delete
        </button>
      </form>
    </>
  );
}
