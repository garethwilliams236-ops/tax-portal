import { createClient } from '@/lib/supabase/server';
import type { SaValues } from '@/lib/sa/compute';

/**
 * The Self Assessment boxes for ONE tax year.
 *
 * They live in the same `computation_inputs` row as the summary figures for
 * that year — same entity, tax type SA, period key the tax year — under the
 * `sa_boxes` key. That keeps the per-period uniqueness the table already
 * enforces, so a year's boxes cannot leak into another year, and it means the
 * summary screen and the box screen are looking at one record rather than two
 * that can disagree.
 */

export const SA_BOXES_KEY = 'sa_boxes';

export async function getSaBoxes(entityId: string, taxYear: string): Promise<SaValues> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('computation_inputs')
    .select('inputs')
    .eq('entity_id', entityId)
    .eq('tax_type', 'SA')
    .eq('period_key', taxYear)
    .maybeSingle();
  if (error) throw new Error(`sa boxes: ${error.message}`);

  const boxes = (data?.inputs as Record<string, unknown> | undefined)?.[SA_BOXES_KEY];
  return (boxes && typeof boxes === 'object' ? boxes : {}) as SaValues;
}
