import { createEntity } from '@/lib/actions/entities';

export const dynamic = 'force-dynamic';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function NewEntity({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  return <Form searchParamsPromise={searchParams} />;
}

async function Form({ searchParamsPromise }: { searchParamsPromise: Promise<{ type?: string }> }) {
  const sp = await searchParamsPromise;
  const type = sp.type === 'individual' ? 'individual' : 'company';

  return (
    <div className="max-w-2xl">
      <h2 className="text-[21px] font-semibold tracking-tight">Add an entity</h2>
      <div className="mt-3 flex gap-2">
        <a href="/entity/new?type=company" className={`btn ${type === 'company' ? 'btn-pri' : ''}`}>Company</a>
        <a href="/entity/new?type=individual" className={`btn ${type === 'individual' ? 'btn-pri' : ''}`}>Individual</a>
      </div>

      <form action={createEntity} className="card mt-5 space-y-4">
        <input type="hidden" name="type" value={type} />

        <Field label="Name">
          <input name="name" className="input" required autoFocus placeholder={type === 'company' ? 'Ardent Advisors Ltd' : 'Gareth Williams'} />
        </Field>

        {type === 'company' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company number"><input name="company_number" className="input" /></Field>
              <Field label="UTR"><input name="utr" className="input" /></Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Year end day"><input name="year_end_day" type="number" min={1} max={31} defaultValue={31} className="input" /></Field>
              <Field label="Year end month">
                <select name="year_end_month" defaultValue={3} className="input">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select name="trading_status" defaultValue="trading" className="input">
                  <option value="trading">Trading</option>
                  <option value="non_trading">Non-trading</option>
                  <option value="dormant">Dormant</option>
                </select>
              </Field>
            </div>
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Status drives association. A company that has carried on no trade or business at any
              time in the period is disregarded under CTA 2010 s.18E(3) — but that is a
              trade-or-business test, not Companies Act dormancy, and the two diverge.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <Field label="VAT registered">
                <label className="flex h-[38px] items-center gap-2 text-sm">
                  <input name="vat_registered" type="checkbox" className="h-4 w-4" /> Registered
                </label>
              </Field>
              <Field label="VRN"><input name="vrn" className="input" /></Field>
              <Field label="VAT quarter ends">
                <select name="vat_stagger" defaultValue="3" className="input">
                  <option value="3">Mar / Jun / Sep / Dec</option>
                  <option value="1">Jan / Apr / Jul / Oct</option>
                  <option value="2">Feb / May / Aug / Nov</option>
                </select>
              </Field>
            </div>

            <Field label="Close investment holding company">
              <label className="flex items-center gap-2 text-sm">
                <input name="cihc" type="checkbox" className="h-4 w-4" />
                Denied the small profits rate and marginal relief (CTA 2010 s.34)
              </label>
            </Field>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="UTR"><input name="utr" className="input" /></Field>
            <Field label="NI number"><input name="ni_number" className="input" /></Field>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <a href="/" className="btn">Cancel</a>
          <button className="btn btn-pri">Create</button>
        </div>
      </form>
    </div>
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
