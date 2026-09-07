import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { getProperties, figuresFor, propertyPosition } from '@/lib/db/properties';
import { addProperty, saveFigures, updateProperty } from '@/lib/actions/properties';
import { taxYears, chosenYear } from '@/lib/years';
import { money2, fmtD } from '@/lib/format';
import { EntityHeader, YearTabs } from '../nav';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const year = chosenYear(asAt, sp.year);
  const properties = await getProperties(entity.id);
  const position = propertyPosition(properties, year);

  return (
    <>
      <EntityHeader entity={entity} active="properties" />
      <YearTabs years={taxYears(asAt)} active={year} hrefFor={(y) => `?year=${encodeURIComponent(y)}`} />

      <p className="mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        Figures are held per tax year. The property record is durable; what it earned is not.
      </p>

      <h3 className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        1 · Properties and figures for {year.replace('-', '/')}
      </h3>

      <div className="tw">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted)', background: 'var(--panel2)' }}>
              <th className="px-4 py-2 font-semibold">Property</th>
              <th className="px-4 py-2 text-right font-semibold">Rent</th>
              <th className="px-4 py-2 text-right font-semibold">Expenses</th>
              <th className="px-4 py-2 text-right font-semibold">Finance costs</th>
              <th className="px-4 py-2 text-right font-semibold">Share taxed</th>
              <th className="px-4 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {properties.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--muted)' }}>
                No properties recorded.
              </td></tr>
            ) : properties.map((p) => {
              const f = figuresFor(p, year);
              const share = p.jointlyHeld && !p.form17InForce ? 50 : p.ownershipPct;
              return (
                <tr key={p.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{p.name}</span>
                    {p.isFurnishedHolidayLet && <span className="pill pill-info ml-2">FHL</span>}
                    {p.address && <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{p.address}</span>}
                    {!p.figures.has(year) && (
                      <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                        nothing recorded for this year
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-2">{money2(f.rentReceived)}</td>
                  <td className="num px-4 py-2">{money2(f.allowableExpenses)}</td>
                  <td className="num px-4 py-2">{money2(f.financeCosts)}</td>
                  <td className="num px-4 py-2">
                    {share}%
                    {p.jointlyHeld && (
                      <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                        {p.form17InForce ? 'Form 17' : '50/50 default'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <details>
                      <summary className="btn cursor-pointer text-[12px]">Edit</summary>

                      <form action={saveFigures} className="mt-2 w-[260px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="property_id" value={p.id} />
                        <input type="hidden" name="tax_year" value={year} />
                        <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                          {year.replace('-', '/')} only
                        </p>
                        <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Rent received</label>
                        <input name="rent_received" type="number" step="0.01" defaultValue={f.rentReceived || ''} className="input" placeholder="0.00" />
                        <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Allowable expenses</label>
                        <input name="allowable_expenses" type="number" step="0.01" defaultValue={f.allowableExpenses || ''} className="input" placeholder="0.00" />
                        <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Finance costs</label>
                        <input name="finance_costs" type="number" step="0.01" defaultValue={f.financeCosts || ''} className="input" placeholder="0.00" />
                        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                          Not deducted — relieved at the basic rate under s.24.
                        </p>
                        <input name="notes" className="input" placeholder="Note" defaultValue={f.notes ?? ''} />
                        <button className="btn btn-pri w-full">Save {year.replace('-', '/')}</button>
                      </form>

                      <form action={updateProperty} className="mt-2 w-[260px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="property_id" value={p.id} />
                        <input type="hidden" name="tax_year" value={year} />
                        <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Ownership</p>
                        <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Beneficial share %</label>
                        <input name="ownership_pct" type="number" step="0.01" defaultValue={p.ownershipPct} className="input" />
                        <label className="flex items-center gap-2 text-[12.5px]">
                          <input name="jointly_held" type="checkbox" defaultChecked={p.jointlyHeld} className="h-4 w-4" /> Jointly held with spouse
                        </label>
                        <label className="flex items-center gap-2 text-[12.5px]">
                          <input name="form17_in_force" type="checkbox" defaultChecked={p.form17InForce} className="h-4 w-4" /> Form 17 in force
                        </label>
                        <input name="form17_dated" type="date" defaultValue={p.form17Dated ? p.form17Dated.toISOString().slice(0, 10) : ''} className="input" />
                        <button className="btn w-full">Save ownership</button>
                      </form>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form action={addProperty} className="card mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="entity_id" value={entity.id} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tax_year" value={year} />
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Name</label>
          <input name="name" required className="input w-52" placeholder="Flat 2, Bridge St" />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Address</label>
          <input name="address" className="input" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Share %</label>
          <input name="ownership_pct" type="number" step="0.01" defaultValue={100} className="input w-24" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-[12.5px]">
          <input name="jointly_held" type="checkbox" className="h-4 w-4" /> Joint
        </label>
        <label className="flex items-center gap-2 pb-2 text-[12.5px]">
          <input name="is_furnished_holiday_let" type="checkbox" className="h-4 w-4" /> FHL
        </label>
        <button className="btn btn-pri">Add property</button>
      </form>

      {/* ---- what reaches the return -------------------------------------- */}
      <h3 className="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        2 · What reaches the {year.replace('-', '/')} return
      </h3>

      <div className="card">
        <table className="w-full text-[13px]">
          <tbody>
            <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="py-1.5 pr-3 font-semibold">Property profit</td>
              <td className="num py-1.5 text-right font-semibold">{money2(position.profit)}</td>
            </tr>
            <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
              <td className="py-1.5 pr-3">
                Residential finance costs
                <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  Carried separately — a basic rate reducer, not a deduction.
                </span>
              </td>
              <td className="num py-1.5 text-right">{money2(position.financeCosts)}</td>
            </tr>
          </tbody>
        </table>

        {position.notes.length > 0 && (
          <ul className="mt-3 space-y-2 text-[12px]" style={{ color: 'var(--muted)' }}>
            {position.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}

        <p className="mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          These figures feed the Self Assessment screen for {year.replace('-', '/')} in place of typing
          the property totals by hand.
        </p>
      </div>

      {properties.some((p) => p.jointlyHeld && p.form17InForce && p.form17Dated) && (
        <div className="card mt-3" style={{ borderColor: 'var(--warn)' }}>
          <p className="text-[12.5px]">
            A Form 17 declaration has effect only if it reaches HMRC within 60 days of its date, and that
            deadline cannot be extended (TSEM9862).{' '}
            {properties
              .filter((p) => p.form17InForce && p.form17Dated)
              .map((p) => `${p.name} dated ${fmtD(p.form17Dated!)}`)
              .join('; ')}.
          </p>
        </div>
      )}
    </>
  );
}
