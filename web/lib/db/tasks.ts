import { createClient } from '@/lib/supabase/server';
import type { Nudge, NudgeCategory } from '@/lib/tax/nudges';

/**
 * The to-do list: derived nudges, plus what you have decided about them.
 *
 * The split matters. A NUDGE is derived and cannot be stored — it exists
 * because a return is unfiled or a letter is unanswered, and it disappears the
 * moment that stops being true. A TASK ROW is your disposition: snoozed until a
 * date, dismissed, or done. That is a fact about you, and nothing else can
 * work it out.
 *
 * So `tasks` holds a row only where a decision has been taken. A nudge with no
 * row is simply open. This is why the table's unique key is
 * `(entity_id, rule_key, period_key)` — the same identity the rules emit, so
 * re-evaluation finds the same row rather than making a new one.
 *
 * Rows are also written directly, with `origin = 'manual'`, for a to-do the
 * portal could never derive: ring the accountant, dig out the completion
 * statement. Those carry their own title and have no rule key.
 */

export type TaskStatus = 'open' | 'done' | 'snoozed' | 'dismissed';

export interface TaskRow {
  id: string;
  entityId: string | null;
  title: string;
  detail: string | null;
  origin: 'nudge' | 'manual' | 'advisor';
  ruleKey: string | null;
  periodKey: string | null;
  category: NudgeCategory | null;
  priority: number;
  dueDate: Date | null;
  status: TaskStatus;
  snoozedUntil: Date | null;
  completedAt: Date | null;
}

/** A nudge joined to whatever you decided about it. */
export interface Item {
  key: string;
  entityId: string | null;
  entityName: string | null;
  title: string;
  detail: string;
  category: NudgeCategory | null;
  priority: number;
  dueDate: Date | null;
  /** Present when a decision has been recorded; absent means simply open. */
  task: TaskRow | null;
  /** True for a to-do typed in rather than worked out. */
  manual: boolean;
}

const d = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00.000Z') : null);
const dayOf = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());

export const taskKey = (entityId: string | null, ruleKey: string | null, periodKey: string | null) =>
  `${entityId ?? 'all'}|${ruleKey ?? ''}|${periodKey ?? ''}`;

export async function getTasks(): Promise<TaskRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, entity_id, title, detail, origin, rule_key, period_key, category, priority, due_date, status, snoozed_until, completed_at')
    .order('priority', { ascending: true });
  if (error) throw new Error(`tasks: ${error.message}`);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any): TaskRow => ({
    id: r.id,
    entityId: r.entity_id ?? null,
    title: r.title,
    detail: r.detail ?? null,
    origin: r.origin,
    ruleKey: r.rule_key ?? null,
    periodKey: r.period_key ?? null,
    category: r.category ?? null,
    priority: Number(r.priority),
    dueDate: d(r.due_date),
    status: r.status,
    snoozedUntil: d(r.snoozed_until),
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * A snooze that has run out is over.
 *
 * The date decides, not the status word, so a snoozed item comes back on its
 * own without anything having to run. This is the same reasoning as the ledger
 * and the correspondence follow-ups: where a fact can be computed from a date,
 * computing it is what stops it going stale.
 */
export function isHidden(task: TaskRow | null, asAt: Date): boolean {
  if (!task) return false;
  if (task.status === 'dismissed') return true;
  if (task.status === 'done') return true;
  if (task.status === 'snoozed') {
    return task.snoozedUntil !== null && dayOf(task.snoozedUntil) > dayOf(asAt);
  }
  return false;
}

/** Join the derived nudges to the stored decisions, and add the manual to-dos. */
export function merge(nudges: Nudge[], tasks: TaskRow[]): Item[] {
  const byKey = new Map(
    tasks
      .filter((t) => t.origin !== 'manual')
      .map((t) => [taskKey(t.entityId, t.ruleKey, t.periodKey), t]),
  );

  const derived: Item[] = nudges.map((n) => ({
    key: taskKey(n.entityId, n.ruleKey, n.periodKey),
    entityId: n.entityId,
    entityName: n.entityName,
    title: n.title,
    detail: n.detail,
    category: n.category,
    priority: n.priority,
    dueDate: n.dueDate ?? null,
    task: byKey.get(taskKey(n.entityId, n.ruleKey, n.periodKey)) ?? null,
    manual: false,
  }));

  const manual: Item[] = tasks
    .filter((t) => t.origin === 'manual')
    .map((t) => ({
      key: `manual:${t.id}`,
      entityId: t.entityId,
      entityName: null,
      title: t.title,
      detail: t.detail ?? '',
      category: t.category,
      priority: t.priority,
      dueDate: t.dueDate,
      task: t,
      manual: true,
    }));

  return [...derived, ...manual].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });
}

/** What is actually on the list today. */
export const live = (items: Item[], asAt: Date) => items.filter((i) => !isHidden(i.task, asAt));

/** Put aside — snoozed and not yet back, dismissed, or marked done. */
export const settled = (items: Item[], asAt: Date) => items.filter((i) => isHidden(i.task, asAt));

/**
 * A stored decision whose nudge has GONE.
 *
 * You marked a return done, then unfiled it; or dismissed a deadline and the
 * period passed. The row is now describing nothing. Nothing is deleted
 * automatically — a row is the only evidence a decision was taken — but the
 * screen can say so.
 */
export function orphaned(nudges: Nudge[], tasks: TaskRow[]): TaskRow[] {
  const alive = new Set(nudges.map((n) => taskKey(n.entityId, n.ruleKey, n.periodKey)));
  return tasks.filter(
    (t) => t.origin !== 'manual' && !alive.has(taskKey(t.entityId, t.ruleKey, t.periodKey)),
  );
}
