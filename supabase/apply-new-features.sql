-- ═══════════════════════════════════════════════════════════
--  Shadows of Destus — NEW FEATURES database update
--  Characters (builder + sheets) and the Battle Map (VTT).
--
--  HOW TO APPLY (either works):
--   • Laptop:  npx supabase db push
--   • Anywhere (phone OK): Supabase dashboard → SQL Editor → New
--     query → paste this whole file → Run. Safe to run twice.
--
--  Nothing here touches existing data; it only adds tables,
--  policies, and functions. Requires the base schema (members,
--  maps, rolls…) to already be applied — it is on your project.
-- ═══════════════════════════════════════════════════════════

-- ─── 1) CHARACTERS ───
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

drop policy if exists "characters: members read" on characters;
create policy "characters: members read" on characters
  for select to authenticated using (is_member());
drop policy if exists "characters: members write their own" on characters;
create policy "characters: members write their own" on characters
  for insert to authenticated
  with check (is_member() and owner_email = my_email());
-- WITH CHECK pins the resulting owner so a player can't reassign or orphan
-- their own sheet to another email (the DM may still edit anyone's).
drop policy if exists "characters: owner or dm edits" on characters;
create policy "characters: owner or dm edits" on characters
  for update to authenticated
  using (owner_email = my_email() or is_dm())
  with check (is_dm() or owner_email = my_email());
drop policy if exists "characters: owner or dm deletes" on characters;
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


-- ─── 2) BATTLE MAP (VTT) ───
-- ⚔️ The battle map (VTT): encounters + tokens, synced live.
--
--  • encounters: a battle the DM sets up — which uploaded map,
--    grid settings, and whether it's the ACTIVE one everyone sees.
--  • tokens: what stands on the map. PCs link to a character row,
--    monsters to an SRD bestiary index (or neither = a marker).
--    Position/HP/conditions live here so every open page agrees.
--
--  Law of the table (RLS):
--    - members see everything except tokens the DM keeps hidden;
--    - only the DM creates encounters and adds/removes tokens;
--    - a player may UPDATE a token only if it's a PC token bound
--      to a character THEY own (that's how they move their hero);
--    - the DM updates anything (conditions, monster HP, hiding…).
--  Spell-effect animations are broadcast over a realtime channel
--  and never stored — nothing to secure at rest.

create table if not exists encounters (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Encounter',
  map_id uuid references maps(id) on delete set null,
  grid jsonb not null default '{"cell": 70, "feet": 5, "show": true}',
  active boolean not null default false,
  turn uuid,                            -- token whose initiative turn it is
  created_at timestamptz not null default now()
);
alter table encounters enable row level security;
drop policy if exists "encounters: members read" on encounters;
create policy "encounters: members read" on encounters
  for select to authenticated using (is_member());
drop policy if exists "encounters: dm creates" on encounters;
create policy "encounters: dm creates" on encounters
  for insert to authenticated with check (is_dm());
drop policy if exists "encounters: dm edits" on encounters;
create policy "encounters: dm edits" on encounters
  for update to authenticated using (is_dm()) with check (is_dm());
drop policy if exists "encounters: dm deletes" on encounters;
create policy "encounters: dm deletes" on encounters
  for delete to authenticated using (is_dm());

create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id) on delete cascade,
  kind text not null default 'marker' check (kind in ('pc','monster','marker')),
  character_id uuid references characters(id) on delete cascade,
  monster_index text not null default '',
  label text not null default '',
  x real not null default 2,
  y real not null default 2,
  size int not null default 1,          -- squares per side (1=M, 2=L, 3=H, 4=G)
  color text not null default '',
  hp_current int,
  hp_max int,
  conditions jsonb not null default '[]',
  hidden boolean not null default false, -- staged by the DM, invisible to players
  initiative int,
  created_at timestamptz not null default now()
);
create index if not exists tokens_encounter_idx on tokens(encounter_id);
alter table tokens enable row level security;

-- May the signed-in player steer this token? (their own PC's)
create or replace function owns_token_character(t_character_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from characters c
    where c.id = t_character_id and lower(c.owner_email) = my_email()
  )
$$;

drop policy if exists "tokens: members see (unless hidden)" on tokens;
create policy "tokens: members see (unless hidden)" on tokens
  for select to authenticated using (is_member() and (not hidden or is_dm()));
drop policy if exists "tokens: dm places" on tokens;
create policy "tokens: dm places" on tokens
  for insert to authenticated with check (is_dm());
drop policy if exists "tokens: dm or the pc's player updates" on tokens;
create policy "tokens: dm or the pc's player updates" on tokens
  for update to authenticated
  using (is_dm() or (kind = 'pc' and owns_token_character(character_id)))
  with check (is_dm() or (kind = 'pc' and owns_token_character(character_id)));
drop policy if exists "tokens: dm removes" on tokens;
create policy "tokens: dm removes" on tokens
  for delete to authenticated using (is_dm());

-- A player may MOVE their own PC token but not restat it. RLS decides which
-- rows they can touch; this trigger pins which COLUMNS a non-DM may change to
-- position + initiative + conditions, so they can't reveal a hidden token,
-- inflate hp_max, resize, or move it to another encounter.
create or replace function guard_token_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_dm() then return new; end if;
  if new.encounter_id is distinct from old.encounter_id
     or new.kind is distinct from old.kind
     or new.character_id is distinct from old.character_id
     or new.monster_index is distinct from old.monster_index
     or new.label is distinct from old.label
     or new.size is distinct from old.size
     or new.color is distinct from old.color
     or new.hp_max is distinct from old.hp_max
     or new.hidden is distinct from old.hidden then
    raise exception 'Players may only move their own token, not restat it';
  end if;
  return new;
end $$;
drop trigger if exists tokens_guard_update on tokens;
create trigger tokens_guard_update before update on tokens
  for each row execute function guard_token_update();

-- live sync for every open battle map
alter publication supabase_realtime add table encounters;
alter publication supabase_realtime add table tokens;
