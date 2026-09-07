import { compute, FIELDS, type Inputs } from '@/lib/compute';
import { saveComputation } from '@/lib/actions/computations';
import { fileReturn } from '@/lib/actions/ledger';
import { money2, fmtD } from '@/lib/format';
import type { SlotReturn } from '@/lib/db/slots';
import type { EntityRow } from '@/lib/db/queries';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One period's computation.
 *
 * Everything on this screen belongs to `slot.periodKey`. The inputs are read
 * for that key and written back to it, and the figure is recomputed from them
 * on every render — nothing computed is stored until you file it.
 */
export function Computation({
  entity, slot, inputs, slug,
}: {
  entity: EntityRow;
  slot: SlotReturn;
  inputs: Inputs;
  slug: string;
}) {
  const fields = FIELDS[slot.taxType] ?? [];
  const result = compute(slot.taxType, inputs, slot, entity);
  const entered = Object.keys(inputs).length > 0;

  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* ---- what you type ------------------------------------------------ */}
      <form action={saveComputation} className="card">
        <input type="hidden" name="entity_id" value={entity.id} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="tax_type" value={slot.taxType} />
        <input type="hidden" name="period_key" value={slot.periodKey} />

        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h4 className="text-[13px] font-semibold">Figures for {slot.short}</h4>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {slot.periodStart ? `${fmtD(slot.periodStart)} – ${fmtD(slot.periodEnd)}` : `to ${fmtD(slot.periodEnd)}`}
          </span>
        </div>

        {fields.map((f) => (
          <div key={f.name} className="mb-3">
            {f.group && (
              <div className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                {f.group}
              </div>
            )}
            <label className="mb-1 block text-[12px] font-medium">{f.label}</label>
            <input
              name={f.name}
              type="number"
              step={f.kind === 'count' ? '1' : '0.01'}
              defaultValue={inputs[f.name] ?? ''}
              placeholder={f.kind === 'count' ? '0' : '0.00'}
              className="input"
            />
            {f.help && (
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--muted)' }}>{f.help}</p>
            )}
          </div>
        ))}

        <button className="btn btn-pri mt-2 w-full">Save figures</button>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--muted)' }}>
          Saved against {slot.short} only. Each period holds its own figures.
        </p>
      </form>

      {/* ---- what is made of it ------------------------------------------- */}
      <div>
        <div className="card">
          <h4 className="mb-3 text-[13px] font-semibold">Computation</h4>

          {!entered ? (
            <p className="py-6 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
              Nothing entered for this period yet.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {result.lines.map((l, idx) => (
                  <tr key={idx} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                    <td className={`py-1.5 pr-3 ${l.strong ? 'font-semibold' : ''}`}>
                      {l.label}
                      {l.note && (
                        <span className="block text-[11.5px] font-normal" style={{ color: 'var(--muted)' }}>{l.note}</span>
                      )}
                    </td>
                    <td className={`num py-1.5 text-right ${l.strong ? 'font-semibold' : ''}`}>
                      {money2(l.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {result.warnings.length > 0 && (
          <div className="card mt-3" style={{ borderColor: 'var(--warn)' }}>
            <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--warn)' }}>
              Worth knowing
            </h4>
            <ul className="space-y-2 text-[12.5px]">
              {result.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
            </ul>
          </div>
        )}

        {entered && result.workings.length > 0 && (
          <details className="card mt-3">
            <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Workings
            </summary>
            <ol className="mt-2 space-y-1 text-[12px]" style={{ color: 'var(--muted)' }}>
              {result.workings.map((w, idx) => <li key={idx}>{w}</li>)}
            </ol>
          </details>
        )}

        {/* The estimate becomes a liability only by being filed, deliberately. */}
        {entered && result.figure !== null && (
          <form action={fileReturn} className="card mt-3">
            <input type="hidden" name="entity_id" value={entity.id} />
            <input type="hidden" name="tax_type" value={slot.taxType} />
            <input type="hidden" name="period_key" value={slot.periodKey} />
            <input type="hidden" name="period_start" value={slot.periodStart ? iso(slot.periodStart) : ''} />
            <input type="hidden" name="period_end" value={iso(slot.periodEnd)} />
            <input type="hidden" name="file_by" value={iso(slot.fileBy)} />
            <input type="hidden" name="pay_by" value={iso(slot.payBy)} />
            <input type="hidden" name="estimate_amount" value={result.figure} />

            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h4 className="text-[13px] font-semibold">{result.figureLabel}</h4>
              <span className="num text-[19px] font-semibold">{money2(result.figure)}</span>
            </div>
            <p className="mb-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
              An estimate. It charges nothing. Filing the return declares it, and the declared figure —
              not this one — is what becomes owed, due {fmtD(slot.payBy)}.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Status</label>
                <select name="status" defaultValue={slot.status === 'filed' ? 'filed' : 'ready_to_file'} className="input w-44">
                  <option value="in_progress">In progress</option>
                  <option value="ready_to_file">Ready to file</option>
                  <option value="filed">Filed</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Declared</label>
                <input name="declared_amount" type="number" step="0.01"
                  defaultValue={slot.declaredAmount ?? result.figure} className="input w-40" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Filed on</label>
                <input name="filed_on" type="date"
                  defaultValue={slot.filedOn ? iso(slot.filedOn) : iso(new Date())} className="input w-44" />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>HMRC reference</label>
                <input name="submission_reference" className="input" />
              </div>
              <button className="btn btn-pri">
                {slot.status === 'filed' ? 'Update return' : 'File return'}
              </button>
            </div>

            {slot.status === 'filed' && slot.declaredAmount !== null
              && Math.abs(slot.declaredAmount - result.figure) > 0.005 && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--warn)' }}>
                The return declared {money2(slot.declaredAmount)}; these figures compute {money2(result.figure)}.
                A variance of {money2(slot.declaredAmount - result.figure)} — worth knowing which is right before it becomes an amendment.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
