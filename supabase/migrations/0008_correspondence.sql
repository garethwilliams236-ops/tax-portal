-- Ardent Tax Portal — correspondence, documents and follow-ups
-- Migration 0008.
--
-- RE-RUNNABLE. Every statement is idempotent — `add column if not exists`,
-- `create index if not exists`, `drop … if exists` before each policy and
-- constraint. The Supabase SQL editor does not wrap a script in a transaction,
-- so a paste that fails half way leaves half the work done; this one can be
-- run again from the top.
--
-- `correspondence` and `documents` were BUILT IN 0001 and are extended here,
-- not replaced. Their existing column names are kept — `occurred_on`,
-- `counterparty`, `summary`, `response_due`, `response_status`, `filename` —
-- and the application code is written to them. Renaming a column to suit
-- newer code is churn that breaks anything already reading it; the older name
-- is not wrong, only older.
--
-- What is added:
--
--   correspondence   the period a letter is about, HMRC's reference on it,
--                    a note of what was done, and 'note' as a third direction
--                    so an internal record sits beside the letter it explains
--   documents        a link to the correspondence item they belong to, so one
--                    letter can carry several scans, plus the type and size
--                    needed to hand a file back cleanly
--   storage          a PRIVATE bucket for the files themselves
--
-- Two things deliberately NOT added:
--
--   No `resolved_at` column. `response_status` already carries whether
--   something is dealt with, and a second column meaning the same thing is how
--   two answers to one question start to disagree. Overdue stays arithmetic:
--   a response is due, the date has passed, the status is not 'closed'.
--
--   No new row-level security policies on these two tables. 0002 already
--   created `correspondence_read`/`_write` and `documents_read`/`_write` over
--   `entity_id`, which is exactly right. Only `storage.objects` needs new ones.

-- ---------------------------------------------------------------------------
-- 0. Clear up after a wrong turn
-- ---------------------------------------------------------------------------
--
-- An earlier draft of this migration tried to CREATE a `correspondence` table
-- and a `correspondence_files` table, not realising 0001 had already built
-- one. It failed part way. These four statements remove anything that draft
-- may have left behind, and do nothing at all if it left nothing.

drop policy if exists correspondence_objects_read on storage.objects;
drop policy if exists correspondence_objects_insert on storage.objects;
drop policy if exists correspondence_objects_delete on storage.objects;
drop table if exists correspondence_files;

-- A stray 'correspondence' bucket, if that draft got as far as creating one,
-- is NOT removed here: Supabase blocks `delete from storage.buckets` outright,
-- because deleting a bucket row would orphan every object inside it. An empty
-- unused bucket costs nothing; remove it from Storage in the dashboard if it
-- is there and you want it gone.

-- ---------------------------------------------------------------------------
-- 1. Correspondence: what a letter is about, and what was done about it
-- ---------------------------------------------------------------------------

alter table correspondence
  -- The period it concerns. Nullable, because an agent authorisation or a
  -- change of address is about nothing in particular, and forcing a period
  -- would mean inventing one.
  add column if not exists period_key text,

  -- HMRC's own reference as printed on the letter. `counterparty` holds who
  -- wrote it; this holds what they called it.
  add column if not exists hmrc_reference text,

  -- What was done, recorded when the item is closed.
  add column if not exists resolution text,

  add column if not exists updated_at timestamptz not null default now();

-- 'note' as a third direction: an internal record with no counterparty — a
-- decision taken, a position to remember. It belongs in this table because the
-- note explaining why a letter was answered a certain way is worth nothing
-- filed somewhere else.
alter table correspondence drop constraint if exists correspondence_direction_check;
alter table correspondence add constraint correspondence_direction_check
  check (direction in ('inbound', 'outbound', 'note'));

-- 'form' and 'other' alongside the original four. 'portal' already covers an
-- online submission, so nothing is added for it.
alter table correspondence drop constraint if exists correspondence_channel_check;
alter table correspondence add constraint correspondence_channel_check
  check (channel in ('letter', 'email', 'phone', 'portal', 'form', 'other'));

-- The three reads this table gets: an entity's log newest first, what is still
-- open and due, and what was filed against one period.
create index if not exists correspondence_entity_idx
  on correspondence (entity_id, occurred_on desc);
create index if not exists correspondence_open_idx
  on correspondence (entity_id, response_due)
  where response_status <> 'closed';
create index if not exists correspondence_period_idx
  on correspondence (entity_id, tax_type, period_key);

-- ---------------------------------------------------------------------------
-- 2. Documents: attach several to one item
-- ---------------------------------------------------------------------------
--
-- `correspondence.document_id` in 0001 allowed exactly one. A single letter
-- routinely arrives as three scanned pages, so the link is moved to the many
-- side. The old column is left alone rather than dropped — it costs nothing
-- and dropping a column is the one migration you cannot undo.

alter table documents
  add column if not exists correspondence_id uuid
    references correspondence(id) on delete cascade,
  add column if not exists content_type text,
  add column if not exists size_bytes bigint;

create index if not exists documents_correspondence_idx
  on documents (correspondence_id);

-- The storage key must be unique, or two rows could point at one object and
-- deleting either would break the other.
create unique index if not exists documents_storage_path_key
  on documents (storage_path);

-- ---------------------------------------------------------------------------
-- 3. The bucket
-- ---------------------------------------------------------------------------
--
-- Private. `public = false` means there is no unauthenticated URL for an
-- object in it at all, so the only way in is a signed URL, and the portal
-- mints those server-side with a one-minute expiry. An HMRC letter is exactly
-- the sort of document that must not survive on a machine that gets lost.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- `storage.foldername(name)` splits the object key on '/', so element 1 is the
-- entity id the file was filed under — which is why every path starts with it.
-- The policies then say exactly what the table's policies say.

drop policy if exists documents_objects_read on storage.objects;
create policy documents_objects_read on storage.objects
  for select using (
    bucket_id = 'documents'
    and can_read_entity(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists documents_objects_insert on storage.objects;
create policy documents_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and can_write_entity(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects
  for delete using (
    bucket_id = 'documents'
    and can_write_entity(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 4. Keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function touch_correspondence()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists correspondence_touch on correspondence;
create trigger correspondence_touch
  before update on correspondence
  for each row execute function touch_correspondence();
