import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { updateEntity, archiveEntity } from '@/lib/actions/entities';
import { EntityHeader } from '../nav';

export const dynamic = 'force-dynamic';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default async function EditEntity({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  return (
    <>
      <EntityHeader entity={entity} active="details" />

      <div className="max-w-2xl">
        <form action={updateEntity} className="card mt-5 space-y-4">
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="slug" value={entity.slug} />
          <input type="hidden" name="type" value={entity.type} />

          <Field label="Name">
            <input name="name" className="input" required defaultValue={entity.name} />
          </Field>

          {entity.type === 'company' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company number">
                  <input name="company_number" className="input" defaultValue={entity.company_number ?? ''} />
                </Field>
                <Field label="UTR">
                  <input name="utr" className="input" defaultValue={entity.utr ?? ''} />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Year end day">
                  <input name="year_end_day" type="number" min={1} max={31}
                    defaultValue={entity.year_end_day ?? 31} className="input" />
                </Field>
                <Field label="Year end month">
                  <select name="year_end_month" defaultValue={entity.year_end_month ?? 3} className="input">
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select name="trading_status" defaultValue={entity.trading_status} className="input">
                    <option value="trading">Trading</option>
                    <option value="non_trading">Non-trading</option>
                    <option value="dormant">Dormant</option>
                  </select>
                </Field>
              </div>
              <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Changing the year end changes which accounting periods the portal expects, so the
                period strip on the tax screens will shift. Figures already saved stay against the
                period they were saved to.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <Field label="VAT registered">
                  <label className="flex h-[38px] items-center gap-2 text-sm">
                    <input name="vat_registered" type="checkbox" className="h-4 w-4"
                      defaultChecked={entity.vat_registered} /> Registered
                  </label>
                </Field>
                <Field label="VRN">
                  <input name="vrn" className="input" defaultValue={entity.vrn ?? ''} />
                </Field>
                <Field label="VAT quarter ends">
                  <select name="vat_stagger" defaultValue={entity.vat_stagger ?? '3'} className="input">
                    <option value="3">Mar / Jun / Sep / Dec</option>
                    <option value="1">Jan / Apr / Jul / Oct</option>
                    <option value="2">Feb / May / Aug / Nov</option>
                  </select>
                </Field>
              </div>

              <Field label="Close investment holding company">
                <label className="flex items-center gap-2 text-sm">
                  <input name="cihc" type="checkbox" className="h-4 w-4"
                    defaultChecked={entity.is_close_investment_holding_company} />
                  Denied the small profits rate and marginal relief (CTA 2010 s.34)
                </label>
              </Field>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="UTR">
                <input name="utr" className="input" defaultValue={entity.utr ?? ''} />
              </Field>
              <Field label="NI number">
                <input name="ni_number" className="input" defaultValue={entity.ni_number ?? ''} />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <a href={`/entity/${entity.slug}`} className="btn">Cancel</a>
            <button className="btn btn-pri">Save changes</button>
          </div>
        </form>

        <details className="card mt-4">
          <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Archive this entity
          </summary>
          <p className="mt-3 text-[12.5px]">
            Archiving takes it off the overview and out of the entity list, and keeps everything —
            returns, liabilities, payments, payroll. Nothing is deleted, because a company that has
            been struck off still has years in which HMRC can open an enquiry into what it filed.
          </p>
          <form action={archiveEntity} className="mt-3">
            <input type="hidden" name="id" value={entity.id} />
            <button className="btn" style={{ color: 'var(--crit)' }}>Archive {entity.name}</button>
          </form>
        </details>

        <p className="mt-4 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          The web address stays <code>/entity/{entity.slug}</code> even if you change the name, so
          existing links keep working. An entity cannot be switched between company and individual:
          they are charged different taxes, and returns filed under one reading would not mean the
          same thing under the other.
        </p>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
