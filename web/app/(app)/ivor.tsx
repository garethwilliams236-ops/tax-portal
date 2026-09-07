'use client';

import { useState, useRef, useEffect } from 'react';
import type { IvorAnswer } from '@/lib/ivor/answer';

/**
 * Ivor, in the corner.
 *
 * The client holds no knowledge base, no rates and no API key. It sends a
 * question to /api/ivor and renders what comes back — which is grounded
 * content assembled on the server, with model phrasing only where the server
 * had a key and what it wrote survived checking.
 */

interface Turn { q: string; a: IvorAnswer | null; error?: string }

const SUGGESTIONS = [
  'What does LEL, PT, ST and UEL mean?',
  'What is outstanding?',
  'How does marginal relief work?',
  'When is the VAT return due?',
];

export function Ivor() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setBusy(true);
    setTurns((t) => [...t, { q: text, a: null }]);
    try {
      const res = await fetch('/api/ivor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      setTurns((t) => {
        const copy = [...t];
        const last = copy[copy.length - 1]!;
        if (!res.ok) copy[copy.length - 1] = { ...last, error: data.error ?? 'Something went wrong.' };
        else copy[copy.length - 1] = { ...last, a: data as IvorAnswer };
        return copy;
      });
    } catch {
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { ...copy[copy.length - 1]!, error: 'Could not reach Ivor.' };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function openTopic(id: string, title: string) {
    setBusy(true);
    setTurns((t) => [...t, { q: title, a: null }]);
    try {
      const res = await fetch('/api/ivor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId: id }),
      });
      const data = await res.json();
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1] = { q: title, a: data as IvorAnswer };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  // Anchored under the header on the right, beneath the signed-in email,
  // rather than floating over the bottom of the page. The panel opens in the
  // same place the button sat, so the eye does not have to travel.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-pri fixed right-[306px] top-[66px] z-40 rounded-full px-2.5 py-1 text-[11px]"
        style={{ boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}
      >
        Ask Ivor
      </button>
    );
  }

  return (
    <div
      className="fixed right-[18px] top-[52px] z-40 flex h-[calc(100vh-72px)] w-[min(840px,calc(100vw-2rem))] flex-col rounded-[12px] border"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)', boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}
    >
      <div className="flex items-baseline gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
        <strong className="text-[14px]">Ivor</strong>
        <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>process and technical</span>
        <span className="flex-1" />
        <button onClick={() => setOpen(false)} className="btn px-2 py-1 text-[12px]">Close</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <>
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              Every figure Ivor states comes from the ledger or from its authority table. Where it
              holds nothing, it says so rather than reaching for the nearest topic.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="btn text-[12px]">{s}</button>
              ))}
            </div>
          </>
        )}

        {turns.map((t, i) => (
          <div key={i} className="mb-5">
            <p className="mb-2 text-[13px] font-semibold">{t.q}</p>
            {t.error && <p className="text-[13px]" style={{ color: 'var(--crit)' }}>{t.error}</p>}
            {!t.a && !t.error && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Thinking…</p>}
            {t.a && <Answer a={t.a} onTopic={openTopic} />}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(q); }}
        className="flex gap-2 border-t px-4 py-3"
        style={{ borderColor: 'var(--line)' }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="input"
          placeholder="Ask about a rule, a term, or what you owe"
          disabled={busy}
        />
        <button className="btn btn-pri" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</button>
      </form>
    </div>
  );
}

function Answer({ a, onTopic }: { a: IvorAnswer; onTopic: (id: string, title: string) => void }) {
  return (
    <div className="rounded-[10px] border p-3" style={{ borderColor: 'var(--line2)', background: 'var(--panel2)' }}>
      <h4 className="text-[13px] font-semibold">{a.heading}</h4>

      {a.unsupported && (
        <div className="mt-2 rounded-md border p-2 text-[12px]" style={{ borderColor: 'var(--crit)', color: 'var(--crit)' }}>
          The wording below contains {a.unsupported.length === 1 ? 'a figure' : 'figures'} that did not
          appear in what Ivor was given: {a.unsupported.join(', ')}. Treat the grounded content beneath
          it as the answer.
        </div>
      )}

      {a.prose && (
        <div className="mt-2 space-y-2 text-[13px]">
          {a.prose.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}

      {a.summary && <p className="mt-2 text-[13px] font-medium">{a.summary}</p>}

      {a.terms && (
        <dl className="mt-2 space-y-2.5">
          {a.terms.map((t) => (
            <div key={t.term}>
              <dt className="text-[12.5px] font-semibold">
                {t.term}
                {t.full.toLowerCase() !== t.term.toLowerCase() && (
                  <span className="ml-2 font-normal" style={{ color: 'var(--muted)' }}>{t.full}</span>
                )}
              </dt>
              <dd className="text-[12.5px]">
                {t.text}
                {t.see && t.seeTitle && (
                  <button onClick={() => onTopic(t.see!, t.seeTitle!)} className="btn ml-2 px-2 py-0.5 text-[11.5px]">
                    More on {t.seeTitle}
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {a.table && a.table.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                <th className="py-1 pr-2 font-semibold">Due</th>
                <th className="py-1 pr-2 font-semibold">Entity</th>
                <th className="py-1 pr-2 font-semibold">Charge</th>
                <th className="py-1 text-right font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {a.table.map((r, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--line2)', color: r.overdue ? 'var(--crit)' : undefined }}>
                  <td className="whitespace-nowrap py-1 pr-2">{r.due}</td>
                  <td className="py-1 pr-2">{r.entity}</td>
                  <td className="py-1 pr-2">{r.tax} {r.charge}</td>
                  <td className="num py-1 text-right">{r.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.what && !a.prose && <p className="mt-2 text-[13px]">{a.what}</p>}
      {a.what && a.prose && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            The grounded text
          </summary>
          <p className="mt-2 text-[13px]">{a.what}</p>
          {a.detail && a.detail.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px]">
              {a.detail.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </details>
      )}

      {a.detail && a.detail.length > 0 && !a.prose && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px]">
          {a.detail.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}

      {a.judgement && (
        <div className="mt-3 rounded-md border-l-2 pl-3 text-[12.5px]" style={{ borderColor: 'var(--warn)' }}>
          <strong>This one is a judgement.</strong> {a.judgement}
        </div>
      )}

      {a.notes && a.notes.map((n, i) => (
        <p key={i} className="mt-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>{n}</p>
      ))}

      {a.cites && a.cites.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.cites.map((c, i) => (
            <span key={i} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: 'var(--line2)', color: 'var(--muted)' }}>
              <b>{c.ref}</b>{c.note ? ` — ${c.note}` : ''}
            </span>
          ))}
        </div>
      )}

      {a.related && a.related.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.related.map((r) => (
            <button key={r.id} onClick={() => onTopic(r.id, r.title)} className="btn px-2 py-0.5 text-[11.5px]">
              {r.title}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10.5px]" style={{ color: 'var(--muted)' }}>
        Authority table last checked against GOV.UK and the HMRC manuals on {a.verified}.
      </p>
    </div>
  );
}
