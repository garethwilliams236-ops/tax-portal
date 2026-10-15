-- How Ivor explains things, per person.
--
-- 'plain'     everyday English for someone with no tax or accounting
--             background: short sentences, every term explained, the
--             technical detail kept underneath.
-- 'technical' the register the portal was built in: statutory references
--             first, written for a chartered accountant.
--
-- Null means "not chosen": the portal owner gets technical, everyone else
-- plain. Each person changes their own from the Ivor panel; users_self (0002)
-- already lets them update their own row and nobody else's.
--
-- Idempotent.

alter table users add column if not exists ivor_level text
  check (ivor_level in ('plain', 'technical'));
