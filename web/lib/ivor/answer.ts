import { KB_VERIFIED, kbField, kbById, type Topic } from './kb';
import { glossaryHits, isDefinitional, termText } from './glossary';
import { ivorMatch, isPositionQuestion, wantsOverdueOnly } from './retrieve';
import { liveContext, type LiveContext, type OpenCharge } from './context';

/**
 * Composing an answer.
 *
 * The order is deliberate:
 *
 *   1. an exact glossary term      — "what does LEL mean" is a lookup
 *   2. a question about the ledger — answered from state, never from a model
 *   3. a topic in the authority table
 *   4. nothing
 *
 * Where a language model is available it is used for PHRASING only, over facts
 * it is given, and what it writes is checked against those facts before it is
 * shown. An unsupported number in an answer to a chartered accountant is worse
 * than no answer at all.
 */

export interface Cite { ref: string; note?: string }

export interface IvorAnswer {
  kind: 'glossary' | 'topic' | 'ledger' | 'none';
  heading: string;
  terms?: { term: string; full: string; text: string; see?: string; seeTitle?: string }[];
  what?: string;
  detail?: string[];
  judgement?: string;
  cites?: Cite[];
  related?: { id: string; title: string }[];
  table?: { due: string; entity: string; tax: string; charge: string; amount: string; overdue: boolean }[];
  summary?: string;
  notes?: string[];
  /** Model phrasing, shown above the deterministic content. */
  prose?: string;
  /** Figures in the prose that were not in the facts it was given. */
  unsupported?: string[];
  verified: string;
}

const money2 = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const toCites = (t: Topic): Cite[] =>
  (t.cites ?? []).map(([ref, note]) => ({ ref, note: note || undefined }));

// ---------------------------------------------------------------------------
// The grounding block handed to the model
// ---------------------------------------------------------------------------

function factsFor(topics: Topic[], ctx: LiveContext): string {
  const L = [
    '=== LIVE POSITION (the only source for any figure about this user) ===',
    ctx.text,
    '',
    '=== AUTHORITY (the only source for any rate, threshold, deadline or citation) ===',
  ];
  for (const k of topics) {
    L.push(`\n[${k.id}] ${k.t}`);
    L.push(kbField(k, 'what'));
    for (const d of kbField(k, 'detail')) L.push('- ' + d);
    if (k.judgement) L.push('JUDGEMENT: ' + k.judgement);
    if (k.cites?.length) L.push('Authority: ' + k.cites.map(([r, n]) => r + (n ? ` (${n})` : '')).join('; '));
  }
  return L.join('\n');
}

const RULES = `You are Ivor, the process assistant inside a UK tax management portal.

The person you are talking to is a chartered accountant who files his own returns for his own companies and his own household. Write to that level: professional register, statutory and manual references rather than plain-English paraphrase, no "consult an accountant" and no disclaimers about seeking advice. He is the adviser.

ABSOLUTE RULES — these are not style preferences:
1. Every figure, rate, threshold, date, deadline, percentage and statutory or manual reference in your answer MUST appear in the FACTS block below. You may quote, rearrange, and explain them. You may NOT introduce any that are not there, and you may NOT compute new ones from memory.
2. If the FACTS block does not answer the question, say exactly what is missing and stop. Do not fill the gap from general knowledge. A short answer that says the portal does not hold that is correct; a plausible invented threshold is a serious failure.
3. Arithmetic on figures that ARE in the FACTS block is allowed, but show it.
4. Where the FACTS block marks something JUDGEMENT, set out the test, name the competing authority on both sides, and say plainly that the call is his. Do not recommend a position.
5. Distinguish an ESTIMATE from a DECLARED amount every time. An engine figure against an unfiled return is not money owed.

Answer in 2-5 short paragraphs of plain prose. No headings, no bullet lists, no markdown emphasis. Do not restate the question. Do not close with an offer of further help.`;

// ---------------------------------------------------------------------------
// Checking what the model wrote against what it was given
// ---------------------------------------------------------------------------

const NUMPAT = /£\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b(?:s\.|section\s)\d+[A-Z]{0,3}\b|\b(?:CTM|NIM|TSEM|IHTM|SAM|CG|VAT)\d{3,}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi;
const norm = (s: string) => s.toLowerCase().replace(/[£,\s]/g, '');

/** Cheap, and worth it. Anything numeric or citation-shaped that is absent from the facts is surfaced rather than trusted. */
export function verify(text: string, facts: string): string[] {
  const fset = new Set((facts.match(NUMPAT) ?? []).map(norm));
  // Also index bare digit runs, so "£8,400" in the facts matches "8400.00".
  for (const m of facts.match(/[\d][\d,]*(?:\.\d+)?/g) ?? []) {
    const n = norm(m);
    fset.add(n);
    fset.add(n.replace(/\.00$/, ''));
  }
  const bad: string[] = [];
  for (const m of text.match(NUMPAT) ?? []) {
    const n = norm(m);
    if (fset.has(n) || fset.has(n.replace(/\.00$/, '')) || fset.has(n + '.00')) continue;
    if (!bad.includes(m)) bad.push(m);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// The model call. Optional: without a key, the deterministic answer stands.
// ---------------------------------------------------------------------------

async function phrase(question: string, facts: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: process.env.IVOR_MODEL ?? 'claude-sonnet-4-5',
      max_tokens: 900,
      system: RULES,
      messages: [{ role: 'user', content: `FACTS\n${facts}\n\nQUESTION\n${question}` }],
    });
    const text = res.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text).join('\n').trim();
    return text || null;
  } catch {
    // A model that is unavailable, rate-limited or misconfigured must not take
    // the answer down with it. The grounded content below is the answer.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The ledger answer
// ---------------------------------------------------------------------------

function ledgerAnswer(question: string, ctx: LiveContext): IvorAnswer {
  const overdueOnly = wantsOverdueOnly(question);
  const l = question.toLowerCase();
  const named = ctx.entityNames.find((n) => l.includes(n.toLowerCase().slice(0, 12)));

  let rows: OpenCharge[] = ctx.charges;
  if (named) rows = rows.filter((c) => c.entity === named);
  if (overdueOnly) rows = rows.filter((c) => c.overdue);

  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  const word = overdueOnly ? 'overdue' : 'outstanding';

  const notes = [
    'Outstanding means a filed return declared it, or statute charged it in advance, less payments allocated to it. Engine estimates against unfiled returns are excluded.',
  ];
  if (ctx.returnsNotFiled) {
    notes.unshift(`${ctx.returnsNotFiled} return${ctx.returnsNotFiled === 1 ? '' : 's'} past the filing date and not filed. Until a return is filed it declares nothing, so any tax those periods carry is not in the figure above.`);
  }

  return {
    kind: 'ledger',
    heading: overdueOnly ? 'What is overdue' : 'What is outstanding',
    summary: rows.length
      ? `${money2(total)} ${word}${named ? ` for ${named}` : ctx.entityNames.length > 1 ? ` across ${ctx.entityNames.length} entities` : ''}, across ${rows.length} charge${rows.length === 1 ? '' : 's'}.`
      : `Nothing ${word}${named ? ` for ${named}` : ''}.`,
    table: rows.slice(0, 12).map((r) => ({
      due: fmtD(r.dueDate),
      entity: r.entity,
      tax: r.taxType,
      charge: r.label,
      amount: money2(r.outstanding),
      overdue: r.overdue,
    })),
    notes,
    verified: KB_VERIFIED,
  };
}

// ---------------------------------------------------------------------------

export async function ask(question: string): Promise<IvorAnswer> {
  const q = question.trim();
  if (!q) return { kind: 'none', heading: 'Ask something', verified: KB_VERIFIED };

  // 1. An exact term. Deterministic, and checked before topic matching so a
  //    definition question is never answered with a process topic.
  const terms = glossaryHits(q);
  if (terms.length && (isDefinitional(q) || terms.length >= 2)) {
    return {
      kind: 'glossary',
      heading: terms.length === 1 ? terms[0]!.full : 'Terms',
      terms: terms.map((g) => ({
        term: g.t, full: g.full, text: termText(g),
        see: g.see, seeTitle: g.see ? kbById(g.see)?.t : undefined,
      })),
      verified: KB_VERIFIED,
    };
  }

  const ctx = await liveContext();

  // 2. A question about the position, answered from the ledger and never sent
  //    to a model.
  if (isPositionQuestion(q, ctx.entityNames)) return ledgerAnswer(q, ctx);

  // 3. The authority table.
  const matches = ivorMatch(q, 3);
  if (!matches.length) {
    return {
      kind: 'none',
      heading: 'Not held',
      what: 'The portal does not hold anything on that. Rather than reach for the nearest topic and answer confidently about the wrong thing, it is saying so.',
      notes: ['Try naming the tax, the form, or the term — "marginal relief", "Form 17", "CT600", "the secondary threshold".'],
      verified: KB_VERIFIED,
    };
  }

  const top = matches[0]!.topic;
  const facts = factsFor(matches.map((m) => m.topic), ctx);
  const prose = await phrase(q, facts);
  const unsupported = prose ? verify(prose, facts) : [];

  return {
    kind: 'topic',
    heading: top.t,
    what: kbField(top, 'what'),
    detail: kbField(top, 'detail'),
    judgement: top.judgement,
    cites: toCites(top),
    related: matches.slice(1).map((m) => ({ id: m.topic.id, title: m.topic.t })),
    prose: prose ?? undefined,
    unsupported: unsupported.length ? unsupported : undefined,
    verified: KB_VERIFIED,
  };
}

/** Read a topic directly, for the "more on this" links. */
export async function topic(id: string): Promise<IvorAnswer> {
  const t = kbById(id);
  if (!t) return { kind: 'none', heading: 'Not held', verified: KB_VERIFIED };
  return {
    kind: 'topic',
    heading: t.t,
    what: kbField(t, 'what'),
    detail: kbField(t, 'detail'),
    judgement: t.judgement,
    cites: toCites(t),
    verified: KB_VERIFIED,
  };
}
