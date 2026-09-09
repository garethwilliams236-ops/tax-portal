'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { FIELDS } from '@/lib/compute';
import type { TaxType } from '@/lib/tax/obligations';
import { SA_BOXES_KEY } from '@/lib/db/sa';

/**
 * Save the figures typed into a computation screen.
 *
 * Only the named fields for that tax are read out of the form, so a stray input
 * cannot write an arbitrary key into the JSON. Blank is stored as absent rather
 * than as zero: "nothing entered" and "entered nil" are different claims, and
 * the difference shows on the screen.
 */
export async function saveComputation(formData: FormData) {
  const supabase = await createClient();

  const entityId = String(formData.get('entity_id'));
  const slug = String(formData.get('slug'));
  const taxType = String(formData.get('tax_type')) as TaxType;
  const periodKey = String(formData.get('period_key'));

  const fields = FIELDS[taxType];
  if (!fields) throw new Error(`No computation fields for ${taxType}`);

  const inputs: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = String(formData.get(f.name) ?? '').trim();
    if (raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${f.label}: not a number.`);
    inputs[f.name] = value;
  }

  // The SA row also carries the box-by-box return, which this form knows
  // nothing about. Carry it across rather than replacing the whole JSON and
  // silently emptying the twelve SA pages.
  if (taxType === 'SA') {
    const { data: existing } = await supabase
      .from('computation_inputs')
      .select('inputs')
      .eq('entity_id', entityId)
      .eq('tax_type', 'SA')
      .eq('period_key', periodKey)
      .maybeSingle();
    const boxes = (existing?.inputs as Record<string, unknown> | undefined)?.[SA_BOXES_KEY];
    if (boxes) inputs[SA_BOXES_KEY] = boxes;
  }

  const { error } = await supabase.from('computation_inputs').upsert(
    {
      entity_id: entityId,
      tax_type: taxType,
      period_key: periodKey,
      inputs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id,tax_type,period_key' },
  );
  if (error) throw new Error(`computation: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}?tax=${taxType}&period=${encodeURIComponent(periodKey)}`);
}
