'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const orNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function addProperty(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Give the property a name.');

  const { error } = await supabase.from('properties').insert({
    entity_id: String(formData.get('entity_id')),
    name,
    address: orNull(formData.get('address')),
    ownership_pct: Number(formData.get('ownership_pct') ?? 100) || 100,
    jointly_held: formData.get('jointly_held') === 'on',
    form17_in_force: formData.get('form17_in_force') === 'on',
    form17_dated: orNull(formData.get('form17_dated')),
    is_furnished_holiday_let: formData.get('is_furnished_holiday_let') === 'on',
  });
  if (error) {
    if (error.code === '23505') throw new Error(`${name} is already recorded.`);
    throw new Error(`properties: ${error.message}`);
  }

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/properties?year=${encodeURIComponent(taxYear)}`);
}

/** Save one property's figures for ONE tax year. */
export async function saveFigures(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  if (!taxYear) throw new Error('No tax year — refusing to save a figure with no year on it.');

  const { error } = await supabase.from('property_figures').upsert(
    {
      property_id: String(formData.get('property_id')),
      tax_year: taxYear,
      rent_received: Number(formData.get('rent_received') ?? 0) || 0,
      allowable_expenses: Number(formData.get('allowable_expenses') ?? 0) || 0,
      finance_costs: Number(formData.get('finance_costs') ?? 0) || 0,
      notes: orNull(formData.get('notes')),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id,tax_year' },
  );
  if (error) throw new Error(`figures: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/properties?year=${encodeURIComponent(taxYear)}`);
}

export async function updateProperty(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));

  const { error } = await supabase
    .from('properties')
    .update({
      ownership_pct: Number(formData.get('ownership_pct') ?? 100) || 100,
      jointly_held: formData.get('jointly_held') === 'on',
      form17_in_force: formData.get('form17_in_force') === 'on',
      form17_dated: orNull(formData.get('form17_dated')),
    })
    .eq('id', String(formData.get('property_id')));
  if (error) throw new Error(`properties: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/properties?year=${encodeURIComponent(taxYear)}`);
}
