-- 🧙 Characters: full D&D character sheets built on this site.
--
--  • characters: one row per hero. The `sheet` JSONB holds the
--    player's CHOICES (race, class, scores, picked spells…);
--    the browser recomputes everything derivable on render.
--    Members read the whole party's sheets; you write your own
--    (the DM may also fix up or remove any sheet).
--  • roll_check(): like roll_dice() but for d20 checks with
--    advantage/disadvantage — rolls 2d20 server-side and keeps
--    the right one, so "lucky" rolls stay honest. Results land
--    in the same `rolls` feed everyone watches live.

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default my_email(),
  name text not null default 'Unnamed hero',
  sheet jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table characters enable row level security;

create policy "characters: members read" on characters
  for select to authenticated using (is_member());
create policy "characters: members write their own" on characters
  for insert to authenticated
  with check (is_member() and owner_email = my_email());
-- WITH CHECK pins the resulting owner so a player can't reassign or orphan
-- their own sheet to another email (the DM may still edit anyone's).
create policy "characters: owner or dm edits" on characters
  for update to authenticated
  using (owner_email = my_email() or is_dm())
  with check (is_dm() or owner_email = my_email());
create policy "characters: owner or dm deletes" on characters
  for delete to authenticated using (owner_email = my_email() or is_dm());

-- keep updated_at honest without trusting the browser
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists characters_touch on characters;
create trigger characters_touch before update on characters
  for each row execute function touch_updated_at();

-- ── d20 checks with advantage / disadvantage ─────────────────
-- p_mode: 'normal' (1d20) | 'adv' | 'dis' (2d20, keep high/low).
-- total = kept die + modifier. Recorded in `rolls` like any roll;
-- the "keep" key tells the dice page which die counted.
create or replace function roll_check(p_label text, p_modifier int, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r1 int; r2 int; kept int;
  dice_json jsonb;
  new_row rolls;
begin
  if not is_member() then raise exception 'Not a member of this party'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then
    raise exception 'Modifier must be between -99 and +99';
  end if;
  if p_mode not in ('normal','adv','dis') then raise exception 'Bad roll mode'; end if;

  r1 := 1 + floor(random() * 20)::int;
  if p_mode = 'normal' then
    kept := r1;
    dice_json := jsonb_build_array(jsonb_build_object(
      'sides', 20, 'count', 1, 'results', jsonb_build_array(r1)));
  else
    r2 := 1 + floor(random() * 20)::int;
    kept := case when p_mode = 'adv' then greatest(r1, r2) else least(r1, r2) end;
    dice_json := jsonb_build_array(jsonb_build_object(
      'sides', 20, 'count', 2, 'results', jsonb_build_array(r1, r2),
      'keep', case when p_mode = 'adv' then 'high' else 'low' end));
  end if;

  insert into rolls (roller_email, label, dice, modifier, total)
  values (my_email(), left(coalesce(p_label, ''), 60), dice_json, p_modifier, kept + p_modifier)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;

revoke execute on function roll_check(text, int, text) from public, anon;
grant execute on function roll_check(text, int, text) to authenticated;
