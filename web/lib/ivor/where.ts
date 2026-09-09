/**
 * Where the user is.
 *
 * A question asked on the Corporation Tax screen of one company, with a
 * particular period selected, is not the same question asked from the overview.
 * The client sends the path it is on; this turns it into something the answer
 * can use, and refuses to invent anything it cannot read from the path.
 */

import type { TaxType } from '@/lib/tax/obligations';

export interface Where {
  /** Entity slug from /entity/<slug>/... */
  slug?: string;
  /** Which section: the tax screens, payroll, properties, details, or the overview. */
  section: 'overview' | 'taxes' | 'payroll' | 'properties' | 'details' | 'other';
  taxType?: TaxType;
  /** The selected period key on the tax screens. */
  periodKey?: string;
  /** The selected tax year on the payroll and properties screens. */
  taxYear?: string;
}

const TAXES = new Set(['CT', 'VAT', 'PAYE', 'SA', 'CGT']);

export function parseWhere(path?: string | null): Where {
  if (!path) return { section: 'other' };

  let pathname = path;
  let search = '';
  const q = path.indexOf('?');
  if (q >= 0) {
    pathname = path.slice(0, q);
    search = path.slice(q + 1);
  }

  const params = new URLSearchParams(search);
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) return { section: 'overview' };
  if (parts[0] !== 'entity') return { section: 'other' };

  const slug = parts[1];
  if (!slug || slug === 'new') return { section: 'other' };

  const tail = parts[2];
  const section: Where['section'] =
    tail === 'payroll' ? 'payroll'
    : tail === 'properties' ? 'properties'
    : tail === 'edit' ? 'details'
    : tail === undefined ? 'taxes'
    : 'other';

  const tax = params.get('tax');
  const period = params.get('period');
  const year = params.get('year');

  return {
    slug,
    section,
    taxType: tax && TAXES.has(tax) ? (tax as TaxType) : undefined,
    periodKey: period ?? undefined,
    taxYear: year ?? undefined,
  };
}

/** A line for the facts block. Says only what the path actually told us. */
export function describeWhere(w: Where, entityName?: string): string | null {
  if (w.section === 'overview') return 'The user is on the overview, looking at all entities.';
  if (!entityName) return null;

  switch (w.section) {
    case 'taxes':
      return `The user is on ${entityName}, on the ${w.taxType ?? 'tax'} screen${
        w.periodKey ? `, with the period ${w.periodKey} selected` : ''
      }. Read "this", "here" and an unqualified question as being about that.`;
    case 'payroll':
      return `The user is on the payroll screen for ${entityName}${w.taxYear ? `, tax year ${w.taxYear}` : ''}. Read an unqualified question as being about payroll for that company and year.`;
    case 'properties':
      return `The user is on the properties screen for ${entityName}${w.taxYear ? `, tax year ${w.taxYear}` : ''}. Read an unqualified question as being about property income for that person and year.`;
    case 'details':
      return `The user is on the details screen for ${entityName}.`;
    default:
      return `The user is looking at ${entityName}.`;
  }
}
