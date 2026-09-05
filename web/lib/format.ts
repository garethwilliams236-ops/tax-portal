export const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
export const money2 = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtD = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const daysTo = (d: Date, from: Date) => Math.ceil((d.getTime() - from.getTime()) / 86400000);

export const TAX_LABEL: Record<string, string> = {
  CT: 'Corporation Tax', VAT: 'VAT', PAYE: 'PAYE & NIC', SA: 'Self Assessment', CGT: 'Capital Gains Tax',
};
