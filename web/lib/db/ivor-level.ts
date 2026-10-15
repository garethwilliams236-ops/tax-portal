import { createClient } from '@/lib/supabase/server';
import type { IvorLevel } from '@/lib/ivor/answer';

/**
 * The signed-in person's Ivor level. A choice they made wins; with none made,
 * the portal owner gets technical and everyone else plain English.
 */
export async function getIvorLevel(userId: string): Promise<IvorLevel> {
  const supabase = await createClient();
  const [{ data: row }, { data: owner }] = await Promise.all([
    supabase.from('users').select('ivor_level').eq('id', userId).maybeSingle(),
    supabase.rpc('is_app_owner'),
  ]);
  const chosen = (row as { ivor_level?: string | null } | null)?.ivor_level;
  if (chosen === 'plain' || chosen === 'technical') return chosen;
  return owner === true ? 'technical' : 'plain';
}

export async function setIvorLevel(userId: string, level: IvorLevel): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('users').update({ ivor_level: level }).eq('id', userId);
  if (error) throw new Error(`ivor_level: ${error.message}`);
}
