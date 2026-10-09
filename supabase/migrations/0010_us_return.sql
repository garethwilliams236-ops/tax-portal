-- The US federal return.
--
-- An individual who is a US citizen files a Form 1040 every year on worldwide
-- income, wherever she lives. `us_filer` turns the US tab on for her.
--
-- The figures go in computation_inputs under tax_type 'US', keyed by calendar
-- year ('2025'), exactly as the UK screens store theirs: inputs stored, result
-- recomputed on every render.
--
-- The US return deliberately does NOT enter the ledger (tax_returns /
-- liabilities / payments). The ledger is in pounds, and the dashboard sums it.
-- A dollar liability summed with a sterling one is a number that means
-- nothing, presented as if it meant something. Filing dates are recorded on
-- the US screen itself, which is what silences its deadlines.
--
-- Idempotent: safe to run twice.

alter table entities add column if not exists us_filer boolean not null default false;

alter table computation_inputs drop constraint if exists computation_inputs_tax_type_check;
alter table computation_inputs add constraint computation_inputs_tax_type_check
  check (tax_type in ('CT','VAT','PAYE','SA','CGT','US'));
