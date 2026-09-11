-- 🎲 Dice: shared rolls, rolled BY THE DATABASE so nobody can
-- forge results, broadcast live to every open Dice page.
--
--  • rolls: the table's permanent record. Members read; nobody
--    inserts directly — only the roll_dice() function below.
--    Rolls can't be edited; only the DM can delete (cleanup).
--  • roll_presets: personal saved rolls ("Fireball — 8d6"),
--    visible only to their owner.

create table if not exists rolls (
  id uuid primary key default gen_random_uuid(),
  roller_email text not null,
  label text not null default '',
  dice jsonb not null,          -- [{"sides":6,"count":8,"results":[...]}]
  modifier int not null default 0,
  total int not null,
  created_at timestamptz not null default now()
);
alter table rolls enable row level security;
create policy "rolls: members read" on rolls
  for select to authenticated using (is_member());
create policy "rolls: dm sweeps the table" on rolls
  for delete to authenticated using (is_dm());
-- (no insert/update policies: writes go through roll_dice() only)

-- The honest croupier. SECURITY DEFINER: it checks membership
-- itself, generates the random results server-side, records the
-- roll, and returns it.
create or replace function roll_dice(p_label text, p_spec jsonb, p_modifier int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  results int[];
  all_dice jsonb := '[]'::jsonb;
  total int := 0;
  sides int; cnt int; total_count int := 0;
  new_row rolls;
begin
  if not is_member() then raise exception 'Not a member of this party'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then
    raise exception 'Modifier must be between -99 and +99';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'array' or jsonb_array_length(p_spec) = 0 then
    raise exception 'Nothing to roll';
  end if;

  for d in select * from jsonb_array_elements(p_spec) loop
    sides := (d->>'sides')::int;
    cnt := (d->>'count')::int;
    if sides not in (4,6,8,10,12,20,100) then raise exception 'Unknown die: d%', sides; end if;
    if cnt is null or cnt < 1 then raise exception 'Bad dice count'; end if;
    total_count := total_count + cnt;
    if total_count > 40 then raise exception 'Too many dice (max 40 per roll)'; end if;
    results := array(select 1 + floor(random() * sides)::int from generate_series(1, cnt));
    total := total + (select sum(x)::int from unnest(results) x);
    all_dice := all_dice || jsonb_build_array(
      jsonb_build_object('sides', sides, 'count', cnt, 'results', to_jsonb(results)));
  end loop;

  total := total + p_modifier;
  insert into rolls (roller_email, label, dice, modifier, total)
  values (my_email(), left(coalesce(p_label, ''), 60), all_dice, p_modifier, total)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;

revoke execute on function roll_dice(text, jsonb, int) from public, anon;
grant execute on function roll_dice(text, jsonb, int) to authenticated;

-- Broadcast new rolls live to subscribed pages (RLS still applies:
-- only party members receive the events).
alter publication supabase_realtime add table rolls;

-- ── personal saved rolls ─────────────────────────────────────
create table if not exists roll_presets (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default my_email(),
  name text not null,
  spec jsonb not null,
  modifier int not null default 0,
  created_at timestamptz not null default now()
);
alter table roll_presets enable row level security;
create policy "presets: own reads" on roll_presets
  for select to authenticated using (is_member() and owner_email = my_email());
create policy "presets: own writes" on roll_presets
  for insert to authenticated with check (is_member() and owner_email = my_email());
create policy "presets: own edits" on roll_presets
  for update to authenticated
  using (owner_email = my_email()) with check (owner_email = my_email());
create policy "presets: own deletes" on roll_presets
  for delete to authenticated using (owner_email = my_email());
