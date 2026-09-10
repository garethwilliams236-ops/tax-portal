'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/**
 * Deciding what to do about something on the list.
 *
 * Every write here is an UPSERT on `(entity_id, rule_key, period_key)` — the
 * same identity the nudge rules emit. Deciding twice about one nudge updates
 * one row; it does not accumulate. That constraint is in 0001 and this is what
 * it was for.
 */

const CATEGORIES = ['filing', 'payment', 'planning', 'data', 'correspondence', 'structural'] as const;
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const orNull = (v: string) => (v === '' ? null : v);

/** Days a snooze runs for, by the button pressed. */
const SNOOZE_DAYS: Record<string, number> = { week: 7, fortnight: 14, month: 30 };

function addDays(from: Date, days: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Record a decision about a derived nudge.
 *
 * The nudge's own text is written into the row as well. It is not what the
 * screen reads — the screen re-derives that every time — but a row saying only
 * `deadline:CT:filing` is unreadable in the database six months later, and the
 * point of keeping the decision is to be able to account for it.
 */
export async function decideNudge(formData: FormData) {
  const supabase = await createClient();

  const status = str(formData, 'status');
  if (!['open', 'done', 'snoozed', 'dismissed'].includes(status)) {
    throw new Error(`Status: "${status}" is not one of open, done, snoozed, dismissed.`);
  }

  const snooze = str(formData, 'snooze');
  if (status === 'snoozed' && !SNOOZE_DAYS[snooze]) {
    throw new Error('A snooze needs a length: week, fortnight or month.');
  }

  const row = {
    entity_id: orNull(str(formData, 'entity_id')),
    rule_key: orNull(str(formData, 'rule_key')),
    period_key: orNull(str(formData, 'period_key')),
    title: str(formData, 'title') || 'Nudge',
    detail: orNull(str(formData, 'detail')),
    origin: 'nudge',
    category: orNull(str(formData, 'category')),
    priority: Number(str(formData, 'priority')) || 3,
    due_date: orNull(str(formData, 'due_date')),
    status,
    snoozed_until: status === 'snoozed' ? addDays(new Date(), SNOOZE_DAYS[snooze]!) : null,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from('tasks')
    .upsert(row, { onConflict: 'entity_id,rule_key,period_key' });
  if (error) throw new Error(`task: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || '/');
}

/** A to-do the portal could not have worked out. */
export async function addTask(formData: FormData) {
  const supabase = await createClient();

  const title = str(formData, 'title');
  if (!title) throw new Error('A to-do needs a title.');

  const category = str(formData, 'category');
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`Category: "${category}" is not one of ${CATEGORIES.join(', ')}.`);
  }

  const { error } = await supabase.from('tasks').insert({
    entity_id: orNull(str(formData, 'entity_id')),
    title,
    detail: orNull(str(formData, 'detail')),
    origin: 'manual',
    // No rule key: nothing derives this, so nothing should ever match it and
    // update it. The unique constraint treats nulls as distinct, which is
    // exactly right here — two manual to-dos are two to-dos.
    rule_key: null,
    period_key: null,
    category: orNull(category),
    priority: Number(str(formData, 'priority')) || 3,
    due_date: orNull(str(formData, 'due_date')),
    status: 'open',
  });
  if (error) throw new Error(`task: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || '/');
}

export async function setTaskStatus(formData: FormData) {
  const supabase = await createClient();

  const id = str(formData, 'id');
  const status = str(formData, 'status');
  if (!['open', 'done', 'snoozed', 'dismissed'].includes(status)) {
    throw new Error(`Status: "${status}" is not one of open, done, snoozed, dismissed.`);
  }
  const snooze = str(formData, 'snooze');

  const { error } = await supabase
    .from('tasks')
    .update({
      status,
      snoozed_until: status === 'snoozed' ? addDays(new Date(), SNOOZE_DAYS[snooze] ?? 7) : null,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', id);
  if (error) throw new Error(`task: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || '/');
}

/**
 * Forget a decision entirely.
 *
 * Different from reopening: reopening says "this is live again", deleting says
 * "there was never anything to decide". Used for a stored decision whose nudge
 * has gone, and for removing a manual to-do.
 */
export async function deleteTask(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from('tasks').delete().eq('id', str(formData, 'id'));
  if (error) throw new Error(`task: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || '/');
}
