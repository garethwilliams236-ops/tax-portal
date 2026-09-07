import { createClient } from '@/lib/supabase/server';

/**
 * A property is durable; what it earned is a fact about a tax year.
 *
 * Same shape as payroll, for the same reason: the figures live in a map keyed
 * by tax year and nowhere else.
 */
export interface FiguresRow {
  taxYear: string;
  rentReceived: number;
  allowableExpenses: number;
  /** Residential finance costs. Relieved as a basic rate reducer, never deducted. */
  financeCosts: number;
  notes: string | null;
}

export interface Property {
  id: string;
  entityId: string;
  name: string;
  address: string | null;
  ownershipPct: number;
  jointlyHeld: boolean;
  form17InForce: boolean;
  form17Dated: Date | null;
  isFurnishedHolidayLet: boolean;
  figures: Map<string, FiguresRow>;
}

const d = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00.000Z') : null);

export async function getProperties(entityId: string): Promise<Property[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('properties')
    .select('*, property_figures(tax_year, rent_received, allowable_expenses, finance_costs, notes)')
    .eq('entity_id', entityId)
    .order('name', { ascending: true });
  if (error) throw new Error(`properties: ${error.message}`);

  return (data ?? []).map((p: any): Property => ({
    id: p.id,
    entityId: p.entity_id,
    name: p.name,
    address: p.address ?? null,
    ownershipPct: Number(p.ownership_pct),
    jointlyHeld: p.jointly_held,
    form17InForce: p.form17_in_force,
    form17Dated: d(p.form17_dated),
    isFurnishedHolidayLet: p.is_furnished_holiday_let,
    figures: new Map(
      (p.property_figures ?? []).map((r: any): [string, FiguresRow] => [
        r.tax_year,
        {
          taxYear: r.tax_year,
          rentReceived: Number(r.rent_received),
          allowableExpenses: Number(r.allowable_expenses),
          financeCosts: Number(r.finance_costs),
          notes: r.notes ?? null,
        },
      ]),
    ),
  }));
}

export function figuresFor(p: Property, taxYear: string): FiguresRow {
  return p.figures.get(taxYear)
    ?? { taxYear, rentReceived: 0, allowableExpenses: 0, financeCosts: 0, notes: null };
}

export interface PropertyPosition {
  /** Profit before finance costs, apportioned by the share taxed on this person. */
  profit: number;
  /** Finance costs, apportioned the same way. */
  financeCosts: number;
  anyFigures: boolean;
  /** The share applied, and why. */
  notes: string[];
}

/**
 * The property income taxed on this person for a tax year.
 *
 * Jointly held property between spouses is 50/50 by default whatever the
 * beneficial shares (ITA 2007 s.836). A Form 17 declaration displaces that
 * with the actual shares — and only from the date it reaches HMRC, within 60
 * days of its date, unextendably. Where a property is jointly held and no
 * Form 17 is in force, 50% is what is taxed, not the recorded percentage.
 */
export function propertyPosition(properties: Property[], taxYear: string): PropertyPosition {
  let profit = 0;
  let financeCosts = 0;
  let anyFigures = false;
  const notes: string[] = [];

  for (const p of properties) {
    const f = figuresFor(p, taxYear);
    const has = f.rentReceived !== 0 || f.allowableExpenses !== 0 || f.financeCosts !== 0;
    if (has) anyFigures = true;

    let share = p.ownershipPct / 100;
    if (p.jointlyHeld && !p.form17InForce) {
      share = 0.5;
      if (has && Math.abs(p.ownershipPct - 50) > 0.0001) {
        notes.push(`${p.name}: jointly held with no Form 17 in force, so 50% is taxed here rather than the ${p.ownershipPct}% beneficial share.`);
      }
    } else if (p.jointlyHeld && p.form17InForce) {
      notes.push(`${p.name}: Form 17 in force, so the ${p.ownershipPct}% actual share is taxed.`);
    }

    profit += (f.rentReceived - f.allowableExpenses) * share;
    financeCosts += f.financeCosts * share;
  }

  return {
    profit: Math.round(profit * 100) / 100,
    financeCosts: Math.round(financeCosts * 100) / 100,
    anyFigures,
    notes,
  };
}
