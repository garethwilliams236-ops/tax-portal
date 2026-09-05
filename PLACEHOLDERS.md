# Placeholder register

Everything the build needs and does not yet have. Each entry says what it feeds
and what goes wrong if it stays unfilled, so you can fill them in the order that
unblocks the most.

Placeholders appear in the code as `«TODO P-nn: ...»` — grep for `«TODO` to find
them all. They are deliberately ugly so they cannot be mistaken for real data.

```bash
grep -rn '«TODO' --include='*.sql' --include='*.ts' .
```

---

## Blocking — nothing downstream is trustworthy without these

### P-01 · APR/BPR allowance: £1m or £2.5m, transferable or not
**Feeds:** `src/lib/tax/rates.ts` → `IHT[].aprBprAllowance`, `aprBprAllowanceTransferable`
**Status:** currently seeded at £2,500,000 and transferable, which is what HMRC
manual IHTM25520 and the current changes page say. Two GOV.UK policy papers still
say £1,000,000 and non-transferable, and they were touched as recently as July and
August 2026, so age does not resolve the conflict.
**Action:** read Finance Act 2026 Schedule 12 directly and record the statutory
position with its citation. You are better placed than most to do that.
**Why it matters:** on a business-owning estate the difference is not a rounding
error. Modelled as a dated rate row so correcting it is a one-line data change.

### P-02 · Trading company details
**Feeds:** `supabase/seed.sql` entity row, obligation generation, all CT computations
**Needed:** name · company number · UTR · accounting year end · VAT registered
(and if so VRN, scheme, stagger) · PAYE reference · accounts office reference
**Placeholder:** 31 March year end, not VAT registered
**Why it matters:** the year end drives every CT and accounts deadline. A wrong
year end produces a confidently wrong deadline list, which is worse than none.

### P-03 · Second company: details and actual activity
**Feeds:** entity row, `entity_period_activity`, obligation generation
**Needed:** name · company number · UTR · year end · **and whether it has any
transactions at all**
**Why the activity question is separate from dormancy:** it does not change the
s.18E answer either way — bank interest alone is not a trade or business
(*Jowett*), so it stays disregarded. But it does change its **Companies House**
status, and therefore whether form AA02 dormant accounts are available. Two
different tests, two different answers, both needed.

### P-04 · Your shareholding and pay in the trading company
**Feeds:** `officers_and_holdings`, Employment Allowance assessment, dividend
attribution, BADR clock
**Needed:** ordinary share % · voting rights % · distributable profits % ·
winding-up assets % · share class · appointment date · current annual pay ·
date all BADR conditions were first met
**Placeholder:** a visibly fake 50/50 split
**Why it matters:** drives three separate calculations that all currently run on
fiction.

### P-05 · Your wife's shareholding and pay
**Feeds:** as P-04, plus the settlements-legislation check
**Needed:** everything in P-04, plus two things specific to her:
- **Do her shares carry full ordinary rights** — votes, full dividend rights, and
  rights to capital on a winding up? This is the *Jones v Garnett* / ITTOIA 2005
  s.626 test. Stripped-rights or bespoke dividend classes fail it and the income
  is taxed back on you under s.624.
- **How she acquired them.** If a spousal gift, was it outright and unconditional
  — no reversion, no shareholders' agreement requiring transfer back?
**Why it matters:** this is the highest-value single input in the register. It
settles Employment Allowance eligibility (£10,500/yr), the dividend split, and
whether she has her own £1m BADR limit.

---

## Needed before the relevant module is useful

### P-06 · Supabase auth user id
**Feeds:** `users`, `entity_access`, every RLS policy
**Action:** sign in once, then uncomment and complete the two inserts at the end
of the access block in `seed.sql`. Until then RLS correctly denies everything.

### P-07 · Your personal details
**Needed:** NI number · date of birth · other income sources (employment,
pension, savings, property) for the tax year
**Feeds:** SA computation, allowance tracking, the extraction optimiser

### P-08 · Your wife's personal details
**Needed:** name · NI number · date of birth · income from elsewhere
**Feeds:** her SA position, and the household extraction optimiser — which is
meaningless without her other income, since it determines which band her
dividends land in

### P-09 · Marriage date
**Feeds:** spouse exemption and no-gain-no-loss eligibility windows
**Why it matters:** low urgency, but the estate module wants it for completeness

### P-10 · Children's names and dates of birth
**Feeds:** `beneficiaries`, RNRB qualification, gift ledger attribution
**Note:** all three are lineal descendants, so the RNRB is in play. Dates of
birth matter for wedding-gift exemptions and for age-related planning.

---

## Needed when the module is built

### P-11 · Xero tenant connections
**Feeds:** `xero_connections`
**Action:** register one OAuth app, connect each company as a tenant. Note the
uncertified app limit — an organisation may connect at most 2 uncertified apps.

### P-12 · HMRC developer credentials
**Feeds:** `src/lib/hmrc/`
**Action:** register on the HMRC Developer Hub as an individual developer.
Read-only production credentials need an application but not recognised
software status.

### P-13 · Estate asset values
**Feeds:** `estate_assets`, RNRB taper, BPR position
**Note:** business assets must be recorded at **unrelieved** value, because that
is what counts toward the £2m RNRB taper threshold. An estate can lose the whole
RNRB while the business itself is fully relieved.

### P-14 · Historic gift ledger
**Feeds:** `gifts`, seven-year cumulation
**Note:** the gift ledger is **not** subject to the 24-month backfill window.
The cumulation needs at least seven years, and normal-expenditure claims need
longer. Load everything you have.

---

## Decisions still open

### D-01 · Is there a plan to trade the second company, and when?
If there is any prospect within the next couple of years, build the trade-start
what-if early. The decision may arrive before the tool does — and starting to
trade mid-period halves the trading company's limits for that **whole** period,
retrospectively. See `assessTradeStart()` in `src/lib/tax/association.ts`.

### D-02 · Does the Betws-y-Coed / holiday letting income land personally,
jointly, or in a company?
Post-FHL-abolition this drives the whole property module. If jointly held, the
Form 17 question arises immediately — and its 60-day deadline runs from the
declaration date and cannot be extended.

### D-03 · Do you want Employment Allowance modelled as a live prompt?
The engine can already tell you whether you qualify. The nudge that fires *while
the tax year is still open* is what makes it worth £10,500 — recoverable by a
decision in February, unrecoverable by a discovery in June.
