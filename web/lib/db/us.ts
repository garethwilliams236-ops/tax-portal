import { createClient } from '@/lib/supabase/server';
import type { UsStored } from '@/lib/us/inputs';

/** Every US year stored for one individual, keyed by calendar year. */
export async function getUsYears(entityId: string): Promise<Map<number, UsStored>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('computation_inputs')
    .select('period_key, inputs')
    .eq('entity_id', entityId)
    .eq('tax_type', 'US');
  if (error) throw new Error(`US inputs: ${error.message}`);
  const out = new Map<number, UsStored>();
  for (const r of data ?? []) out.set(Number(r.period_key), (r.inputs ?? {}) as UsStored);
  return out;
}
