'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saPage } from '@/lib/sa/forms';
import { SA_BOXES_KEY } from '@/lib/db/sa';

/**
 * Save one SA page's boxes.
 *
 * Read-modify-write, and deliberately so. The row holds every page's boxes
 * plus the summary figures for the year, and this action is given one page —
 * so it merges. Overwriting would silently empty eleven other pages the moment
 * you saved the twelfth.
 *
 * Only boxes that belong to the named page are read out of the form, so a
 * renamed or injected input cannot write a key nothing will ever read back.
 * Blank stays absent rather than becoming zero: "nothing entered" and "entered
 * nil" are different claims on a tax return, and the screen shows which is
 * which.
 */
export async function saveSaBoxes(formData: FormData) {
  const supabase = await createClient();

  const entityId = String(formData.get('entity_id'));
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  const pageCode = String(formData.get('page'));

  const page = saPage(pageCode);
  if (!page) throw new Error(`No such SA page: ${pageCode}`);

  const { data: existing, error: readError } = await supabase
    .from('computation_inputs')
    .select('inputs')
    .eq('entity_id', entityId)
    .eq('tax_type', 'SA')
    .eq('period_key', taxYear)
    .maybeSingle();
  if (readError) throw new Error(`sa boxes: ${readError.message}`);

  const inputs = { ...((existing?.inputs ?? {}) as Record<string, unknown>) };
  const boxes = { ...((inputs[SA_BOXES_KEY] ?? {}) as Record<string, unknown>) };

  for (const section of page.sections) {
    for (const box of section.boxes) {
      const raw = formData.get(box.key);

      if (box.kind === 'yesno') {
        // An unticked checkbox sends nothing, so absence is the answer.
        if (raw === null) delete boxes[box.key];
        else boxes[box.key] = true;
        continue;
      }

      const value = String(raw ?? '').trim();
      if (value === '') { delete boxes[box.key]; continue; }

      if (box.kind === 'money' || box.kind === 'number') {
        const n = Number(value.replace(/[£,\s]/g, ''));
        if (!Number.isFinite(n)) {
          throw new Error(`${pageCode} box ${box.box} (${box.label}): "${value}" is not a number.`);
        }
        boxes[box.key] = n;
      } else {
        boxes[box.key] = value;
      }
    }
  }

  inputs[SA_BOXES_KEY] = boxes;

  const { error } = await supabase.from('computation_inputs').upsert(
    {
      entity_id: entityId,
      tax_type: 'SA',
      period_key: taxYear,
      inputs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entity_id,tax_type,period_key' },
  );
  if (error) throw new Error(`sa boxes: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/sa?year=${encodeURIComponent(taxYear)}&page=${pageCode}`);
}
