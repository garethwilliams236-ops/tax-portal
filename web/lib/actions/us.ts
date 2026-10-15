'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseUsForm, type UsStored } from '@/lib/us/inputs';
import { US_YEARS_HELD } from '@/lib/tax/us/rates';

/** Save one US year. Only the named fields are read; blank stays absent. */
export async function saveUsYear(formData: FormData) {
  const supabase = await createClient();
  const entityId = String(formData.get('entity_id'));
  const slug = String(formData.get('slug'));
  const year = Number(formData.get('year'));
  if (!US_YEARS_HELD.includes(year)) throw new Error(`US year ${year} is not held`);

  const { data: existing, error: readError } = await supabase
    .from('computation_inputs')
    .select('inputs')
    .eq('entity_id', entityId)
    .eq('tax_type', 'US')
    .eq('period_key', String(year))
    .maybeSingle();
  if (readError) throw new Error(`US inputs: ${readError.message}`);

  const inputs = parseUsForm(formData, (existing?.inputs ?? {}) as UsStored);

  const { error } = await supabase.from('computation_inputs').upsert(
    { entity_id: entityId, tax_type: 'US', period_key: String(year), inputs, updated_at: new Date().toISOString() },
    { onConflict: 'entity_id,tax_type,period_key' },
  );
  if (error) throw new Error(`US inputs: ${error.message}`);

  revalidatePath('/', 'layout');
  const view = formData.get('view') === 'forms' ? '&view=forms' : '';
  redirect(`/entity/${slug}/us?year=${year}${view}`);
}
