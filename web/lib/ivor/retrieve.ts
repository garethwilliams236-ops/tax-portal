/**
 * Retrieval.
 *
 * The failures this code exists to prevent, each of which happened:
 *
 *   "what does NIC LEL, PT, ST and UEL mean?"  answered with the PAYE payment
 *      dates, because "PAYE" and "NIC" appear in that topic's tags and the
 *      thresholds appeared nowhere at all.
 *   a stamp duty question                      answered with Employment
 *      Allowance, on the strength of two common words.
 *   "ANI"                                      matched "associated compANIes",
 *      because a title bonus fired on a three-letter fragment.
 *   a PAYE question                            dragged to the Corporation Tax
 *      notification topic purely because that topic's tags happened to spell
 *      "HMRC" and PAYE's did not.
 *
 * The answers, in order: a floor below which Ivor says it holds nothing; a
 * rarity weight so a word appearing in half the table scores almost nothing; a
 * penalty when none of a question's distinctive words are known at all; and a
 * phrase bonus that requires an actual phrase.
 */

import { KB, type Topic } from './kb';

const STOP = new Set([
  'what', 'does', 'this', 'mean', 'the', 'a', 'an', 'is', 'are', 'do', 'i', 'my', 'of',
  'for', 'on', 'in', 'to', 'and', 'how', 'why', 'when', 'it', 'that', 'with', 'be', 'can',
  'should', 'me', 'you', 'we', 'us', 'have', 'has', 'if', 'so', 'at', 'by', 'or', 'not',
  'was', 'were', 'from', 'about',
  // Navigationally meaningless in a UK tax knowledge base: they are in half
  // the table, so they discriminate nothing.
  'hmrc', 'tax', 'taxes', 'uk', 'need', 'know', 'tell', 'please', 'get', 'got', 'there',
  'their', 'over',
  // Asking-for-it words. They say how the answer should look, not what it is
  // about, and they are in no topic.
  'show', 'give', 'walk', 'through', 'worked', 'example', 'examples', 'illustrate',
]);

export const words = (s: string): string[] =>
  String(s).toLowerCase().replace(/[^a-z0-9£%\s.-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/**
 * A weak keyword collision must not produce a confident answer about the wrong
 * tax. Below this, Ivor says it holds nothing rather than reaching for the
 * nearest topic.
 */
export const MIN_SCORE = 4;

let _df: Record<string, number> | null = null;

/**
 * How many topics mention a word. A word in one topic identifies it; a word in
 * half the table identifies nothing, and letting it score is how a question
 * about the NIC thresholds got answered with the PAYE payment dates.
 */
function docFreq(w: string): number {
  if (!_df) {
    _df = {};
    for (const k of KB) {
      const seen = new Set((k.id + ' ' + k.t + ' ' + k.tags).toLowerCase().split(/[^a-z0-9£%]+/).filter(Boolean));
      for (const t of seen) _df[t] = (_df[t] ?? 0) + 1;
    }
  }
  return _df[w] ?? 0;
}

const rarity = (w: string): number => {
  const n = docFreq(w);
  return n === 0 ? 0 : n === 1 ? 2.2 : n <= 2 ? 1.6 : n <= 4 ? 1.1 : n <= 7 ? 0.6 : 0.25;
};

export interface Match { topic: Topic; score: number }

export function ivorMatch(q: string, limit = 3): Match[] {
  const qs = words(q);
  if (!qs.length) return [];

  const scored = KB.map((k) => {
    const hay = ' ' + (k.id + ' ' + k.t + ' ' + k.tags).toLowerCase().replace(/[^a-z0-9£%]+/g, ' ') + ' ';
    let s = 0;
    for (const w of qs) {
      let base = 0;
      if (hay.includes(' ' + w + ' ')) base = w.length >= 5 ? 3 : 2;              // whole word
      else if (w.length > 4 && hay.includes(' ' + w.slice(0, -1))) base = 2;      // simple plural
      else if (w.length > 5 && hay.includes(w)) base = 1;                         // inside a longer word
      if (base) s += base * rarity(w);
    }

    // A question whose distinctive words are all unknown to the table has not
    // been understood, whatever its common words happened to hit.
    //
    // "Distinctive" means known to one or two topics. A word the table has
    // never heard of (docFreq 0) discriminates nothing — it cannot be in the
    // right topic either — and treating it as distinctive penalised every
    // topic equally: "how does marginal relief work?" scored nil because
    // "work" appears nowhere in the table.
    const distinctive = qs.filter((w) => docFreq(w) >= 1 && docFreq(w) <= 2);
    if (distinctive.length && !distinctive.some((w) => hay.includes(w))) s *= 0.35;

    // A phrase bonus, but only for a phrase. Matching a bare fragment against
    // a title is how "ANI" scored against "associated compANIes".
    const phrase = qs.join(' ');
    if (phrase.length >= 6 && (' ' + k.t.toLowerCase() + ' ').includes(' ' + phrase)) s += 6;

    // A title bonus where the title accounts for every word the table
    // recognises. Two things this fixes:
    //
    //   "What is a payment on account?" is about payments on account and not
    //   about allocating a payment, and only the title separates them: both
    //   topics carry "payment" and "account" in their tags.
    //
    //   "Show me a worked example of the taper" carries exactly one word the
    //   table knows. Scored on that word alone it fell just under the floor
    //   and Ivor said it held nothing — about a topic whose title is the word.
    //
    // A SHORT word the table has never seen is ignored — "fo rthe taper" is a
    // typo, not a subject. A LONG one is not: "stamp duty" is a subject the
    // table does not cover, and letting the bonus fire on the one word it did
    // recognise ("rate") is how a stamp duty question got answered about
    // Corporation Tax rates.
    const title = ' ' + k.t.toLowerCase().replace(/[^a-z0-9£%]+/g, ' ') + ' ';
    const inTitle = (w: string) => title.includes(' ' + w) || (w.length > 4 && title.includes(' ' + w.slice(0, -1)));
    const recognised = qs.filter((w) => docFreq(w) >= 1);
    const unknownSubject = qs.some((w) => docFreq(w) === 0 && w.length >= 5);
    // At least one word must be reasonably distinctive, or a question built
    // entirely of table-wide words would match on the title alone.
    if (
      recognised.length && !unknownSubject
      && recognised.some((w) => docFreq(w) <= 4)
      && recognised.every(inTitle)
    ) {
      s += 4;
    }

    return { topic: k, score: s };
  })
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  // Related entries have to be within striking distance of the best match,
  // rather than simply being next in a thin list.
  const floor = Math.max(MIN_SCORE, scored[0]!.score * 0.55);
  return [scored[0]!, ...scored.slice(1).filter((x) => x.score >= floor)].slice(0, limit);
}

/**
 * Position vocabulary. "What is overdue?" is a question about the ledger even
 * though it opens with "what is"; "when is the VAT return due?" is a question
 * about the rule even though it contains "due".
 */
const POSITION = new Set([
  'owe', 'owing', 'outstanding', 'overdue', 'payable', 'balance', 'left', 'behind',
  'arrears', 'due', 'total', 'still', 'now', 'currently', 'anything', 'everything',
  'across', 'all',
]);

/**
 * Asks about the rule, whatever else is in the sentence. Note that several of
 * these words are stopwords, so they are matched against the RAW question:
 * "what does outstanding mean?" reduces to ["outstanding"] once stopwords are
 * removed, which looks exactly like a bare position question and was answered
 * as one.
 */
const ASKS_THE_RULE = /\b(mean|means|meaning|explain|definition|defined|how does|how do|how is|works?|why|when|deadline|due date)\b/i;

/** Weaker: a rule question only if something other than position vocabulary is left. */
const WEAK_RULE = /\b(what is|what are)\b/i;

/**
 * Should this question be answered from the ledger rather than the authority
 * table? Only where it asks about the POSITION — and a strong topic match
 * always wins.
 */
export function isPositionQuestion(q: string, entityNames: string[]): boolean {
  const l = q.toLowerCase();
  const wantsOwe = /\b(owe|owing|outstanding|payable|balance|left to pay)\b/.test(l);
  const wantsOverdue = /\b(overdue|behind|in arrears)\b/.test(l);
  if (!wantsOwe && !wantsOverdue) return false;

  if (ASKS_THE_RULE.test(l)) return false;

  // If nothing is left of the question once the position vocabulary and the
  // entity names are removed, it is asking about the ledger.
  const rest = words(q).filter((w) => !POSITION.has(w));
  const bare = !rest.length || rest.every((w) => entityNames.some((n) => n.toLowerCase().includes(w)));
  if (!bare && WEAK_RULE.test(l)) return false;

  const top = ivorMatch(q, 1)[0];
  if (top && top.score >= 8) return false;

  return true;
}

export const wantsOverdueOnly = (q: string) => /\b(overdue|behind|in arrears|late)\b/i.test(q);
