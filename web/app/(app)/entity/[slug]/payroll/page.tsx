import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { getPayroll, payFor } from '@/lib/db/payroll';
import { addPerson, savePay, removePerson } from '@/lib/actions/payroll';
import { computeAnnualNic, assessEmploymentAllowance, type PayrollPerson } from '@/lib/tax/paye-nic';
import { nicRates } from '@/lib/tax/rates';
import { taxYears, chosenYear } from '@/lib/years';
import { money, money2 } from '@/lib/format';
import { EntityHeader, YearTabs } from '../nav';

export const dynamic = 'force-dynamic';

export default async function PayrollPage({
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
  const people = await getPayroll(entity.id);

  // Every figure below is read for THIS tax year only. A person with no row
  // for the year is paid nothing in it, which is the honest reading.
  const forEngine: PayrollPerson[] = people.map((p) => ({
    personId: p.id,
    name: p.name,
    isDirector: p.isDirector,
    annualEarnings: payFor(p, year).annualPay,
    directorshipStartedOn: p.directorshipStartedOn ?? undefined,
  }));

  let rates: ReturnType<typeof nicRates> | null = null;
  let ea: ReturnType<typeof assessEmploymentAllowance> | null = null;
  let rateError: string | null = null;
  try {
    rates = nicRates(year);
    ea = assessEmploymentAllowance(forEngine, year);
  } catch (e) {
    rateError = (e as Error).message;
  }

  const rows = people.map((p) => {
    const pay = payFor(p, year);
    let nic: { employeeNic: number; employerNic: number } | null = null;
    if (rates) {
      try { nic = computeAnnualNic(pay.annualPay, year); } catch { nic = null; }
    }
    return { person: p, pay, nic };
  });

  const totalPay = rows.reduce((a, r) => a + r.pay.annualPay, 0);
  const totalEe = rows.reduce((a, r) => a + (r.nic?.employeeNic ?? 0), 0);
  const totalEr = rows.reduce((a, r) => a + (r.nic?.employerNic ?? 0), 0);
  const allowance = ea?.eligible ? Math.min(ea.allowance, totalEr) : 0;
  const erAfter = Math.max(0, totalEr - allowance);

  return (
    <>
      <EntityHeader entity={entity} active="payroll" />
      <YearTabs years={taxYears(asAt)} active={year} hrefFor={(y) => `?year=${encodeURIComponent(y)}`} />

      <p className="mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        Pay is held per tax year. Changing the year above changes which figures you are looking at —
        nothing entered here reaches another year.
      </p>

      {rateError && (
        <div className="card mt-4" style={{ borderColor: 'var(--warn)' }}>
          <p className="text-[13px]">
            No NIC rate table for {year.replace('-', '/')}, so the contributions cannot be computed.
            Pay can still be recorded. <span style={{ color: 'var(--muted)' }}>({rateError})</span>
          </p>
        </div>
      )}

      {/* ---- the roster --------------------------------------------------- */}
      <h3 className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        1 · People and pay for {year.replace('-', '/')}
      </h3>

      <div className="tw">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted)', background: 'var(--panel2)' }}>
              <th className="px-4 py-2 font-semibold">Person</th>
              <th className="px-4 py-2 text-right font-semibold">Annual pay</th>
              <th className="px-4 py-2 text-right font-semibold">Benefits</th>
              <th className="px-4 py-2 text-right font-semibold">Employee NIC</th>
              <th className="px-4 py-2 text-right font-semibold">Employer NIC</th>
              <th className="px-4 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--muted)' }}>
                Nobody on the payroll yet.
              </td></tr>
            ) : rows.map(({ person, pay, nic }) => (
              <tr key={person.id} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                <td className="px-4 py-2">
                  <span className="font-medium">{person.name}</span>
                  {person.isDirector && <span className="pill pill-info ml-2">Director</span>}
                  {!person.pay.has(year) && (
                    <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                      no pay recorded for this year
                    </span>
                  )}
                </td>
                <td className="num px-4 py-2">{money2(pay.annualPay)}</td>
                <td className="num px-4 py-2">{pay.benefitsInKind ? money2(pay.benefitsInKind) : '—'}</td>
                <td className="num px-4 py-2">{nic ? money2(nic.employeeNic) : '—'}</td>
                <td className="num px-4 py-2">{nic ? money2(nic.employerNic) : '—'}</td>
                <td className="px-4 py-2">
                  <details>
                    <summary className="btn cursor-pointer text-[12px]">Edit</summary>
                    <form action={savePay} className="mt-2 w-[260px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="person_id" value={person.id} />
                      <input type="hidden" name="tax_year" value={year} />
                      <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>
                        {year.replace('-', '/')} only
                      </p>
                      <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Annual pay</label>
                      <input name="annual_pay" type="number" step="0.01" defaultValue={pay.annualPay || ''} className="input" placeholder="0.00" />
                      <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Benefits in kind</label>
                      <input name="benefits_in_kind" type="number" step="0.01" defaultValue={pay.benefitsInKind || ''} className="input" placeholder="0.00" />
                      <input name="notes" className="input" placeholder="Note" defaultValue={pay.notes ?? ''} />
                      <button className="btn btn-pri w-full">Save {year.replace('-', '/')}</button>
                    </form>
                    <form action={removePerson} className="mt-2">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="person_id" value={person.id} />
                      <input type="hidden" name="tax_year" value={year} />
                      <button className="btn w-full text-[12px]" style={{ color: 'var(--crit)' }}>
                        Remove from payroll
                      </button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t font-semibold" style={{ borderColor: 'var(--line)', background: 'var(--panel2)' }}>
                <td className="px-4 py-2">Total</td>
                <td className="num px-4 py-2">{money2(totalPay)}</td>
                <td />
                <td className="num px-4 py-2">{money2(totalEe)}</td>
                <td className="num px-4 py-2">{money2(totalEr)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <form action={addPerson} className="card mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="entity_id" value={entity.id} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tax_year" value={year} />
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Name</label>
          <input name="name" required className="input" placeholder="Full name" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Started</label>
          <input name="started_on" type="date" className="input w-44" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Directorship from</label>
          <input name="directorship_started_on" type="date" className="input w-44" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-[12.5px]">
          <input name="is_director" type="checkbox" className="h-4 w-4" /> Director
        </label>
        <button className="btn btn-pri">Add person</button>
      </form>

      {/* ---- the year's NIC position -------------------------------------- */}
      {rates && ea && (
        <>
          <h3 className="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            2 · National Insurance for the year
          </h3>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <table className="w-full text-[13px]">
                <tbody>
                  <Row label="Employee NIC" value={totalEe} />
                  <Row label="Employer NIC before allowance" value={totalEr} />
                  <Row label="Employment Allowance applied" value={-allowance} />
                  <Row label="Employer NIC payable" value={erAfter} strong />
                  <Row label="Total NIC" value={totalEe + erAfter} strong
                    note={`About ${money((totalEe + erAfter) / 12)} a month, spread evenly.`} />
                </tbody>
              </table>
              <p className="mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Computed on the annual basis, which is how a director&rsquo;s NIC is worked out —
                the year as a whole, not each month in isolation.
              </p>
            </div>

            <div className="card">
              <h4 className="mb-2 text-[13px] font-semibold">Employment Allowance</h4>
              <p className="text-[13px]">
                <span className={`pill ${ea.eligible ? 'pill-ok' : 'pill-crit'}`}>
                  {ea.eligible ? 'Available' : 'Not available'}
                </span>
                <span className="ml-2" style={{ color: 'var(--muted)' }}>
                  {ea.headsAboveSecondaryThreshold} paid above the secondary threshold of {money(ea.secondaryThreshold)}
                </span>
              </p>
              <p className="mt-2 text-[12.5px]">{ea.reason}</p>
              {ea.warnings.length > 0 && (
                <ul className="mt-3 space-y-2 text-[12px]" style={{ color: 'var(--warn)' }}>
                  {ea.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <p className="mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                One allowance across connected companies (NICA 2014 s.3), tested at the start of the
                tax year. It is claimed on the EPS, not the FPS.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Row({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className={`py-1.5 pr-3 ${strong ? 'font-semibold' : ''}`}>
        {label}
        {note && <span className="block text-[11.5px] font-normal" style={{ color: 'var(--muted)' }}>{note}</span>}
      </td>
      <td className={`num py-1.5 text-right ${strong ? 'font-semibold' : ''}`}>{money2(value)}</td>
    </tr>
  );
}
