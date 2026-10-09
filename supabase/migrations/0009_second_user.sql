-- A second user, with access to her own returns and nothing else.
--
-- 0002 built row-level security so that adding a person costs one row in
-- entity_access. That still holds for READING: every entity-scoped table tests
-- can_read_entity, so a user granted one individual sees that individual's
-- returns, ledger, correspondence and documents, and no other entity's.
--
-- What 0002/0005 did not have to think about, with one user, is what an
-- authenticated user may do that is not tied to an entity they hold:
--
--   * create an entity          (0005: any authenticated user)
--   * delete an entity          (owner of that entity — so she could delete
--                                her own, cascading away its whole history)
--   * edit a household          (anyone who can see an entity in it)
--   * see a to-do with no entity (0002: any authenticated user, both ways)
--
-- Each is narrowed here to the app owner — the first account, recorded in
-- app_settings by 0004 — or, for to-dos, to whoever wrote it.
--
-- Written idempotent: the Supabase SQL editor does not wrap a script in a
-- transaction, so a half-run must be safe to run again.

-- The app owner. security definer so it can read app_settings regardless of RLS.
create or replace function is_app_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from app_settings s where s.owner_user_id = auth.uid());
$$;

-- Entities: only the owner creates or deletes. Editing details stays with
-- whoever holds the entity as 'owner', so she can correct her own UTR.
drop policy if exists entities_insert on entities;
create policy entities_insert on entities for insert with check (is_app_owner());
drop policy if exists entities_delete on entities;
create policy entities_delete on entities for delete using (is_app_owner());

-- Archiving is an update, which the entity's holder may make. Only the app
-- owner may take an entity off the list, or put one back.
create or replace function entities_guard_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active is distinct from old.active and not is_app_owner() then
    raise exception 'Only the portal owner can archive or restore an entity';
  end if;
  return new;
end $$;

drop trigger if exists entities_guard_active on entities;
create trigger entities_guard_active before update on entities
  for each row execute function entities_guard_active();

-- Households: the owner edits; anyone with an entity in one may still read it.
drop policy if exists households_insert on households;
create policy households_insert on households for insert with check (is_app_owner());
drop policy if exists households_update on households;
create policy households_update on households for update using (is_app_owner()) with check (is_app_owner());
drop policy if exists households_delete on households;
create policy households_delete on households for delete using (is_app_owner());

-- To-dos with no entity belong to whoever wrote them.
alter table tasks add column if not exists created_by uuid references auth.users on delete cascade default auth.uid();
update tasks set created_by = (select owner_user_id from app_settings) where created_by is null;

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  case when entity_id is null then created_by = auth.uid() else can_read_entity(entity_id) end);
drop policy if exists tasks_write on tasks;
create policy tasks_write on tasks for all
  using (case when entity_id is null then created_by = auth.uid() else can_write_entity(entity_id) end)
  with check (case when entity_id is null then created_by = auth.uid() else can_write_entity(entity_id) end);

-- Granting access. entity_access has a select policy only, so nobody can write
-- a grant directly; these functions are the one door, and only the owner holds
-- the key. The other user must already have signed in once (or been created in
-- Supabase Auth), because a grant names an auth user, not an email address.

create or replace function grant_entity_access(p_email text, p_entity uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target uuid;
begin
  if not is_app_owner() then
    raise exception 'Only the portal owner can grant access';
  end if;
  if p_role not in ('owner', 'viewer') then
    raise exception 'Role must be owner or viewer';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'No account for %. Create it in Supabase Auth first.', p_email;
  end if;
  if not exists (select 1 from entities where id = p_entity) then
    raise exception 'No such entity';
  end if;

  insert into public.users (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
  from auth.users u where u.id = target
  on conflict (id) do nothing;

  insert into entity_access (user_id, entity_id, role)
  values (target, p_entity, p_role)
  on conflict (user_id, entity_id) do update set role = excluded.role;
end $$;

create or replace function revoke_entity_access(p_user uuid, p_entity uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_app_owner() then
    raise exception 'Only the portal owner can revoke access';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove your own access';
  end if;
  delete from entity_access where user_id = p_user and entity_id = p_entity;
end $$;

-- Who can see an entity. entity_access_self shows each user only their own
-- grants, which is right for her and useless for the owner managing them.
create or replace function list_entity_access(p_entity uuid)
returns table (user_id uuid, email text, role text, is_you boolean)
language sql stable security definer set search_path = public
as $$
  select ea.user_id, u.email::text, ea.role, ea.user_id = auth.uid()
  from entity_access ea
  join auth.users u on u.id = ea.user_id
  where ea.entity_id = p_entity and is_app_owner()
  order by u.email;
$$;

revoke all on function grant_entity_access(text, uuid, text) from public, anon;
revoke all on function revoke_entity_access(uuid, uuid) from public, anon;
revoke all on function list_entity_access(uuid) from public, anon;
grant execute on function grant_entity_access(text, uuid, text) to authenticated;
grant execute on function revoke_entity_access(uuid, uuid) to authenticated;
grant execute on function list_entity_access(uuid) to authenticated;
grant execute on function is_app_owner() to authenticated;
