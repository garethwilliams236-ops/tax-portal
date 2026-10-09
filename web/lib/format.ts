export const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
export const money2 = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n: number) =>
  (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const fmtD = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const daysTo = (d: Date, from: Date) => Math.ceil((d.getTime() - from.getTime()) / 86400000);

export const TAX_LABEL: Record<string, string> = {
  CT: 'Corporation Tax', VAT: 'VAT', PAYE: 'PAYE & NIC', SA: 'Self Assessment', CGT: 'Capital Gains Tax',
  US_1040: 'US Form 1040', FBAR: 'FBAR',
};
