import { createClient } from '@/lib/supabase/server';
import type { TaxType } from '@/lib/tax/obligations';
import type { Inputs } from '@/lib/compute';

/**
 * Computation inputs, always read by period.
 *
 * The map is keyed `${taxType}|${periodKey}`, which is the same key the table
 * is unique on. There is deliberately no "inputs for this entity" read that
 * ignores the period — that shape is what let the prototype show one year's
 * payroll in every year.
 */
export type InputsByPeriod = Map<string, Inputs>;

export const inputKey = (taxType: TaxType, periodKey: string) => `${taxType}|${periodKey}`;

export async function getComputationInputs(entityId: string): Promise<InputsByPeriod> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('computation_inputs')
    .select('tax_type, period_key, inputs')
    .eq('entity_id', entityId);
  if (error) throw new Error(`computation_inputs: ${error.message}`);

  const map: InputsByPeriod = new Map();
  for (const row of data ?? []) {
    map.set(inputKey(row.tax_type as TaxType, row.period_key), (row.inputs ?? {}) as Inputs);
  }
  return map;
}
