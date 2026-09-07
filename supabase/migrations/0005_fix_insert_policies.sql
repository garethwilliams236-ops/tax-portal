-- Fix: you could never create an entity.
--
-- entities_write was `for all` with `with check (can_write_entity(id))`, and
-- can_write_entity looks for a row in entity_access naming that entity. On an
-- INSERT no such row exists yet — the trigger that grants access runs AFTER the
-- row lands, but WITH CHECK is evaluated first. A policy keyed on the row's own
-- id cannot gate its own insert.
drop policy if exists entities_write on entities;
create policy entities_insert on entities for insert with check (auth.uid() is not null);
create policy entities_update on entities for update using (can_write_entity(id)) with check (can_write_entity(id));
create policy entities_delete on entities for delete using (can_write_entity(id));

drop policy if exists households_write on households;
create policy households_insert on households for insert with check (auth.uid() is not null);
create policy households_update on households for update using (can_read_household(id)) with check (can_read_household(id));
create policy households_delete on households for delete using (can_read_household(id));
