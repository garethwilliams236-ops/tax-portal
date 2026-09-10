import Link from 'next/link';
import { getEntities, getLiabilities, getPayments, getReturns, taxLinesFor, outstandingOf } from '@/lib/db/queries';
import { buildNudges } from '@/lib/db/nudges';
import { getTasks, merge, live } from '@/lib/db/tasks';
import { ToDoRail } from './rail';
import { money, money2, fmtD, daysTo, TAX_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const asAt = new Date();
  const [entities, returns, liabilities, payments, nudges, tasks] = await Promise.all([
    getEntities(), getReturns(), getLiabilities(), getPayments(),
    buildNudges(asAt), getTasks(),
  ]);

  const items = merge(nudges.nudges, tasks);

  const rows = entities.map((e) => ({
    entity: e,
    lines: taxLinesFor(e, returns, liabilities, payments, asAt),
  }));

  const tot = rows.flatMap((r) => r.lines).reduce(
    (a, l) => ({
      outstanding: a.outstanding + l.outstanding,
      overdue: a.overdue + l.overdue,
      credit: a.credit + Math.max(0, l.credit),
      notFiled: a.notFiled + l.notFiled,
    }),
    { outstanding: 0, overdue: 0, credit: 0, notFiled: 0 },
  );

  return (
    <div className="flex flex-col gap-6 xl:flex-row-reverse xl:items-start">
      <ToDoRail
        items={live(items, asAt)}
        backlog={nudges.backlog}
        entities={entities}
        asAt={asAt}
      />

      <div className="min-w-0 flex-1">
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
        Position
      </h2>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill n={String(entities.length)} label="entities" />
        <Pill n={String(tot.notFiled)} label="returns not filed" tone={tot.notFiled ? 'crit' : 'ok'} />
        <Pill n={money(tot.outstanding)} label="outstanding" tone={tot.outstanding > 0.005 ? 'warn' : 'ok'} />
        {tot.overdue > 0.005 && <Pill n={money(tot.overdue)} label="overdue" tone="crit" />}
        {tot.credit > 0.005 && <Pill n={money(tot.credit)} label="unallocated on account" />}
      </div>
      <p className="mb-4 text-[12px]" style={{ color: 'var(--muted)' }}>
        Outstanding is what a filed return declared, or what statute charged in advance, less payments
        allocated to it. An estimate against an unfiled return is not counted.
      </p>

      <h2 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
        Entities
      </h2>
      <div className="flex flex-col gap-3">
        {rows.map(({ entity, lines }) => (
          <div key={entity.id} className="tw">
            <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3"
              style={{ borderColor: 'var(--line)', background: 'var(--panel2)' }}>
              <span className="text-[15px] font-semibold tracking-tight">{entity.name}</span>
              <span className={`pill ${entity.type === 'individual' ? 'pill-info' : entity.trading_status === 'trading' ? 'pill-ok' : 'pill-mute'}`}>
                {entity.type === 'individual' ? 'Individual' : entity.trading_status}
              </span>
              <span className="flex-1" />
              <Link href={`/entity/${entity.slug}`} className="btn text-[12px]">Open</Link>
            </div>

            {lines.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13.5px]" style={{ color: 'var(--muted)' }}>
                Dormant — Companies House filings only.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    <th className="px-4 py-2 font-semibold">Tax</th>
                    <th className="px-4 py-2 font-semibold">Latest return</th>
                    <th className="px-4 py-2 text-right font-semibold">Charged</th>
                    <th className="px-4 py-2 text-right font-semibold">Paid</th>
                    <th className="px-4 py-2 text-right font-semibold">Outstanding</th>
                    <th className="px-4 py-2 font-semibold">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const dl = l.nextDue ? daysTo(l.nextDue.dueDate, asAt) : null;
                    return (
                      <tr key={l.taxType} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                        <td className="whitespace-nowrap px-4 py-2 font-semibold">{TAX_LABEL[l.taxType]}</td>
                        <td className="px-4 py-2">
                          {l.lastFiled ? (
                            <>
                              {l.lastFiled.periodKey}
                              <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                                filed {l.lastFiled.filedOn ? fmtD(l.lastFiled.filedOn) : '—'}
                              </span>
                            </>
                          ) : (
                            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>none filed</span>
                          )}
                        </td>
                        <td className="num px-4 py-2">{l.charged ? money(l.charged) : '—'}</td>
                        <td className="num px-4 py-2">{l.paid ? money(l.paid) : '—'}</td>
                        <td className="num px-4 py-2 font-semibold" style={{ color: l.overdue > 0.005 ? 'var(--crit)' : undefined }}>
                          {Math.abs(l.outstanding) < 0.005 ? 'nil' : money2(l.outstanding)}
                        </td>
                        <td className="px-4 py-2">
                          {l.nextDue ? (
                            <>
                              {fmtD(l.nextDue.dueDate)}
                              <span className="block text-[11.5px]" style={{ color: dl !== null && dl < 0 ? 'var(--crit)' : 'var(--muted)' }}>
                                {l.nextDue.label}{dl !== null && dl < 0 ? ` · ${Math.abs(dl)}d overdue` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {entities.length === 0 && (
        <div className="card mt-4 text-sm">
          <p className="font-medium">No entities yet.</p>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            Run the seed migration, or add your first company.
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

function Pill({ n, label, tone }: { n: string; label: string; tone?: 'ok' | 'warn' | 'crit' }) {
  const bg = tone === 'crit' ? 'var(--crit-bg)' : tone === 'warn' ? 'var(--warn-bg)' : tone === 'ok' ? 'var(--ok-bg)' : 'var(--panel)';
  const fg = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--ink)';
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]"
      style={{ borderColor: tone ? bg : 'var(--line)', background: bg, color: fg }}>
      <b className="text-[13.5px] font-bold tabular-nums">{n}</b>
      <span style={{ color: tone ? fg : 'var(--muted)' }}>{label}</span>
    </span>
  );
}
