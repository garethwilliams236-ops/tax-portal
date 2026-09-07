import { createClient } from '@/lib/supabase/server';
import type { TaxYear } from '@/lib/tax/rates';

/**
 * A person is durable; their pay is a fact about a tax year.
 *
 * `pay` is a map keyed by tax year, never a number on the person, so there is
 * no shape in which one year's figure can be read as another's.
 */
export interface PayRow {
  taxYear: string;
  annualPay: number;
  benefitsInKind: number;
  notes: string | null;
}

export interface Person {
  id: string;
  entityId: string;
  name: string;
  isDirector: boolean;
  directorshipStartedOn: Date | null;
  startedOn: Date | null;
  leftOn: Date | null;
  individualEntityId: string | null;
  pay: Map<string, PayRow>;
}

const d = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00.000Z') : null);

export async function getPayroll(entityId: string): Promise<Person[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payroll_people')
    .select('*, payroll_pay(tax_year, annual_pay, benefits_in_kind, notes)')
    .eq('entity_id', entityId)
    .order('is_director', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw new Error(`payroll: ${error.message}`);

  return (data ?? []).map((p: any): Person => ({
    id: p.id,
    entityId: p.entity_id,
    name: p.name,
    isDirector: p.is_director,
    directorshipStartedOn: d(p.directorship_started_on),
    startedOn: d(p.started_on),
    leftOn: d(p.left_on),
    individualEntityId: p.individual_entity_id ?? null,
    pay: new Map(
      (p.payroll_pay ?? []).map((r: any): [string, PayRow] => [
        r.tax_year,
        {
          taxYear: r.tax_year,
          annualPay: Number(r.annual_pay),
          benefitsInKind: Number(r.benefits_in_kind),
          notes: r.notes ?? null,
        },
      ]),
    ),
  }));
}

/** Pay for one tax year only. Anyone with no row for that year is paid nothing in it. */
export function payFor(person: Person, taxYear: TaxYear | string): PayRow {
  return person.pay.get(String(taxYear))
    ?? { taxYear: String(taxYear), annualPay: 0, benefitsInKind: 0, notes: null };
}
