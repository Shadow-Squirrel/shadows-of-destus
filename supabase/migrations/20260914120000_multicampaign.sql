-- ═════════════════════════════════════════════════════════════
--  Multi-campaign: turn the site into a place where many DMs each
--  run their own campaigns, invite their own players, and NEVER
--  see each other's maps, quests, notes, tokens, or dice.
--
--  Model:
--   • campaigns          — one row per campaign, owned by its DM.
--   • campaign_members    — who belongs to each campaign (dm/player).
--   • campaign_characters — links a player's PORTABLE character into
--     a campaign they've joined (characters belong to the player and
--     can be brought into any campaign, D&D-Beyond style).
--   • every piece of campaign content carries a campaign_id, and
--     the security rules below only ever let you see or change rows
--     in a campaign you belong to.
--
--  Safe to run more than once. Existing content is migrated into a
--  first campaign owned by the current DM — nothing is lost.
-- ═════════════════════════════════════════════════════════════

-- ── campaigns ────────────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'New Campaign',
  owner_email text not null default my_email(),
  created_at timestamptz not null default now()
);
alter table campaigns enable row level security;

create table if not exists campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  role text not null default 'player' check (role in ('dm','player')),
  display_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists campaign_members_unique on campaign_members(campaign_id, lower(email));
create index if not exists campaign_members_email_idx on campaign_members(lower(email));
alter table campaign_members enable row level security;

create table if not exists campaign_characters (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  added_by text not null default my_email(),
  created_at timestamptz not null default now(),
  primary key (campaign_id, character_id)
);
alter table campaign_characters enable row level security;

-- ── campaign-scoped authorization helpers ────────────────────
-- SECURITY DEFINER + fixed search_path so they can consult the
-- membership table without tripping its own RLS (and without the
-- recursion that would cause).
create or replace function my_campaign_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select campaign_id from campaign_members where lower(email) = my_email()
$$;

create or replace function is_campaign_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = cid and lower(email) = my_email()
  )
$$;

create or replace function is_campaign_dm(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = cid and lower(email) = my_email() and role = 'dm'
  )
$$;

-- ── campaigns / members / character-links policies ───────────
drop policy if exists "campaigns: members + owner read" on campaigns;
create policy "campaigns: members + owner read" on campaigns
  for select to authenticated using (owner_email = my_email() or is_campaign_member(id));
drop policy if exists "campaigns: anyone signed-in creates (as themselves)" on campaigns;
create policy "campaigns: anyone signed-in creates (as themselves)" on campaigns
  for insert to authenticated with check (owner_email = my_email());
drop policy if exists "campaigns: owner edits" on campaigns;
create policy "campaigns: owner edits" on campaigns
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
drop policy if exists "campaigns: owner deletes" on campaigns;
create policy "campaigns: owner deletes" on campaigns
  for delete to authenticated using (owner_email = my_email());

drop policy if exists "campaign members: members read roster" on campaign_members;
create policy "campaign members: members read roster" on campaign_members
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "campaign members: dm invites" on campaign_members;
create policy "campaign members: dm invites" on campaign_members
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "campaign members: dm edits" on campaign_members;
create policy "campaign members: dm edits" on campaign_members
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "campaign members: dm or self removes" on campaign_members;
create policy "campaign members: dm or self removes" on campaign_members
  for delete to authenticated using (is_campaign_dm(campaign_id) or lower(email) = my_email());

drop policy if exists "campaign chars: members read" on campaign_characters;
create policy "campaign chars: members read" on campaign_characters
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "campaign chars: player adds own or dm adds" on campaign_characters;
create policy "campaign chars: player adds own or dm adds" on campaign_characters
  for insert to authenticated with check (
    is_campaign_member(campaign_id)
    and (is_campaign_dm(campaign_id) or exists (
      select 1 from characters c where c.id = character_id and lower(c.owner_email) = my_email()
    ))
  );
drop policy if exists "campaign chars: owner or dm removes" on campaign_characters;
create policy "campaign chars: owner or dm removes" on campaign_characters
  for delete to authenticated using (
    is_campaign_dm(campaign_id) or exists (
      select 1 from characters c where c.id = character_id and lower(c.owner_email) = my_email()
    )
  );

-- create a campaign and enroll its creator as DM in one shot.
create or replace function create_campaign(p_name text) returns campaigns
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if my_email() = '' then raise exception 'Must be signed in'; end if;
  insert into campaigns (name, owner_email) values (coalesce(nullif(p_name,''),'New Campaign'), my_email())
    returning * into c;
  insert into campaign_members (campaign_id, email, role, display_name)
    values (c.id, my_email(), 'dm', null)
    on conflict do nothing;
  return c;
end $$;
revoke execute on function create_campaign(text) from public, anon;
grant execute on function create_campaign(text) to authenticated;

-- ── add campaign_id to every content table ───────────────────
alter table campaign_sections add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table quests           add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table quest_updates    add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table notes            add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table codex_entries    add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table codex_notes      add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table maps             add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table party_characters add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table rolls            add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table roll_presets     add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table encounters       add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table tokens           add column if not exists campaign_id uuid references campaigns(id) on delete cascade;

-- ── migrate existing data into a first campaign ──────────────
-- Picks the current DM (from the old single-campaign members list)
-- as owner, copies the roster in, and stamps all existing content.
do $$
declare def uuid; dm text;
begin
  -- only if there is legacy content/members to migrate and nothing stamped yet
  if not exists (select 1 from information_schema.tables where table_name='members') then return; end if;
  select lower(email) into dm from members where role='dm' order by created_at limit 1;
  if dm is null then select lower(email) into dm from members order by created_at limit 1; end if;
  if dm is null then return; end if;

  select id into def from campaigns where owner_email = dm order by created_at limit 1;
  if def is null then
    insert into campaigns (name, owner_email) values ('My Campaign', dm) returning id into def;
  end if;

  insert into campaign_members (campaign_id, email, role, display_name)
    select def, lower(email), role, display_name from members
    on conflict (campaign_id, lower(email)) do nothing;

  update campaign_sections set campaign_id = def where campaign_id is null;
  update quests            set campaign_id = def where campaign_id is null;
  update quest_updates     set campaign_id = def where campaign_id is null;
  update notes             set campaign_id = def where campaign_id is null;
  update codex_entries     set campaign_id = def where campaign_id is null;
  update codex_notes       set campaign_id = def where campaign_id is null;
  update maps              set campaign_id = def where campaign_id is null;
  update party_characters  set campaign_id = def where campaign_id is null;
  update rolls             set campaign_id = def where campaign_id is null;
  update roll_presets      set campaign_id = def where campaign_id is null;
  update encounters        set campaign_id = def where campaign_id is null;
  update tokens            set campaign_id = def where campaign_id is null;

  -- link every existing character into the default campaign (portable)
  insert into campaign_characters (campaign_id, character_id, added_by)
    select def, id, lower(owner_email) from characters
    on conflict do nothing;
end $$;

-- ── enforce campaign_id going forward ────────────────────────
-- (safe: the backfill above stamped every existing row; new rows
-- always carry a campaign_id from the app + the policies below.)
do $$
declare t text;
begin
  foreach t in array array['campaign_sections','quests','quest_updates','notes','codex_entries','codex_notes','maps','party_characters','rolls','roll_presets','encounters','tokens']
  loop
    if not exists (select 1 from information_schema.columns
                   where table_name = t and column_name='campaign_id' and is_nullable='NO') then
      -- only set NOT NULL if there are no null rows (a fresh install has none)
      execute format('select 1 from %I where campaign_id is null limit 1', t);
      if not found then execute format('alter table %I alter column campaign_id set not null', t); end if;
    end if;
  end loop;
end $$;

create index if not exists campaign_sections_camp_idx on campaign_sections(campaign_id);
create index if not exists quests_camp_idx on quests(campaign_id);
create index if not exists notes_camp_idx on notes(campaign_id);
create index if not exists codex_entries_camp_idx on codex_entries(campaign_id);
create index if not exists maps_camp_idx on maps(campaign_id);
create index if not exists rolls_camp_idx on rolls(campaign_id);
create index if not exists encounters_camp_idx on encounters(campaign_id);
create index if not exists tokens_camp_idx on tokens(campaign_id);

-- ═══ replace every global policy with a campaign-scoped one ═══

-- campaign_sections (DM-owned)
drop policy if exists "sections: members read" on campaign_sections;
drop policy if exists "sections: dm writes" on campaign_sections;
drop policy if exists "sections: dm edits" on campaign_sections;
drop policy if exists "sections: dm deletes" on campaign_sections;
create policy "sections: members read" on campaign_sections
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "sections: dm writes" on campaign_sections
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "sections: dm edits" on campaign_sections
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "sections: dm deletes" on campaign_sections
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- quests (DM-owned)
drop policy if exists "quests: members read" on quests;
drop policy if exists "quests: dm writes" on quests;
drop policy if exists "quests: dm edits" on quests;
drop policy if exists "quests: dm deletes" on quests;
create policy "quests: members read" on quests
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "quests: dm writes" on quests
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "quests: dm edits" on quests
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "quests: dm deletes" on quests
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- quest_updates (DM-owned)
drop policy if exists "quest journal: members read" on quest_updates;
drop policy if exists "quest journal: dm writes" on quest_updates;
drop policy if exists "quest journal: dm deletes" on quest_updates;
create policy "quest journal: members read" on quest_updates
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "quest journal: dm writes" on quest_updates
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "quest journal: dm deletes" on quest_updates
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- notes (members write their own; private = author only)
drop policy if exists "notes: members read (private = author only)" on notes;
drop policy if exists "notes: members write as themselves" on notes;
drop policy if exists "notes: author edits" on notes;
drop policy if exists "notes: author or dm deletes" on notes;
create policy "notes: members read (private = author only)" on notes
  for select to authenticated
  using (is_campaign_member(campaign_id) and (not is_private or author_email = my_email()));
create policy "notes: members write as themselves" on notes
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "notes: author edits" on notes
  for update to authenticated
  using (author_email = my_email() and is_campaign_member(campaign_id))
  with check (author_email = my_email() and is_campaign_member(campaign_id));
create policy "notes: author or dm deletes" on notes
  for delete to authenticated
  using (author_email = my_email() or is_campaign_dm(campaign_id));

-- codex_entries (members add; author or dm edits)
drop policy if exists "codex: members read" on codex_entries;
drop policy if exists "codex: members add as themselves" on codex_entries;
drop policy if exists "codex: author or dm edits" on codex_entries;
drop policy if exists "codex: author or dm deletes" on codex_entries;
create policy "codex: members read" on codex_entries
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "codex: members add as themselves" on codex_entries
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "codex: author or dm edits" on codex_entries
  for update to authenticated
  using (author_email = my_email() or is_campaign_dm(campaign_id))
  with check ((author_email = my_email() or is_campaign_dm(campaign_id)) and is_campaign_member(campaign_id));
create policy "codex: author or dm deletes" on codex_entries
  for delete to authenticated using (author_email = my_email() or is_campaign_dm(campaign_id));

-- codex_notes (members add; author or dm deletes)
drop policy if exists "codex intel: members read" on codex_notes;
drop policy if exists "codex intel: members add as themselves" on codex_notes;
drop policy if exists "codex intel: author or dm deletes" on codex_notes;
create policy "codex intel: members read" on codex_notes
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "codex intel: members add as themselves" on codex_notes
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "codex intel: author or dm deletes" on codex_notes
  for delete to authenticated using (author_email = my_email() or is_campaign_dm(campaign_id));

-- maps (DM-owned)
drop policy if exists "maps: members read" on maps;
drop policy if exists "maps: dm writes" on maps;
drop policy if exists "maps: dm edits" on maps;
drop policy if exists "maps: dm deletes" on maps;
create policy "maps: members read" on maps
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "maps: dm writes" on maps
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "maps: dm edits" on maps
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "maps: dm deletes" on maps
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- party_characters (DM-owned roster)
drop policy if exists "party: members read" on party_characters;
drop policy if exists "party: dm writes" on party_characters;
drop policy if exists "party: dm edits" on party_characters;
drop policy if exists "party: dm deletes" on party_characters;
create policy "party: members read" on party_characters
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "party: dm writes" on party_characters
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "party: dm edits" on party_characters
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "party: dm deletes" on party_characters
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- rolls (read within campaign; inserts only via roll functions; dm cleans up)
drop policy if exists "rolls: members read" on rolls;
drop policy if exists "rolls: dm sweeps the table" on rolls;
create policy "rolls: members read" on rolls
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "rolls: dm sweeps the table" on rolls
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- roll_presets (personal, within a campaign)
drop policy if exists "presets: own reads" on roll_presets;
drop policy if exists "presets: own writes" on roll_presets;
drop policy if exists "presets: own edits" on roll_presets;
drop policy if exists "presets: own deletes" on roll_presets;
create policy "presets: own reads" on roll_presets
  for select to authenticated using (owner_email = my_email() and is_campaign_member(campaign_id));
create policy "presets: own writes" on roll_presets
  for insert to authenticated with check (owner_email = my_email() and is_campaign_member(campaign_id));
create policy "presets: own edits" on roll_presets
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
create policy "presets: own deletes" on roll_presets
  for delete to authenticated using (owner_email = my_email());

-- characters (PORTABLE: owned by the player; visible to campaigns they're in)
drop policy if exists "characters: members read" on characters;
drop policy if exists "characters: members write their own" on characters;
drop policy if exists "characters: owner or dm edits" on characters;
drop policy if exists "characters: owner or dm deletes" on characters;
create policy "characters: owner or shared-campaign members read" on characters
  for select to authenticated using (
    owner_email = my_email()
    or exists (
      select 1 from campaign_characters cc
      where cc.character_id = characters.id and is_campaign_member(cc.campaign_id)
    )
  );
create policy "characters: players create their own" on characters
  for insert to authenticated with check (owner_email = my_email());
create policy "characters: owner edits" on characters
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
create policy "characters: owner deletes" on characters
  for delete to authenticated using (owner_email = my_email());

-- encounters (DM-owned, within a campaign)
drop policy if exists "encounters: members read" on encounters;
drop policy if exists "encounters: dm creates" on encounters;
drop policy if exists "encounters: dm edits" on encounters;
drop policy if exists "encounters: dm deletes" on encounters;
create policy "encounters: members read" on encounters
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "encounters: dm creates" on encounters
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "encounters: dm edits" on encounters
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "encounters: dm deletes" on encounters
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- tokens (campaign-scoped; players move only their own PC token)
drop policy if exists "tokens: members see (unless hidden)" on tokens;
drop policy if exists "tokens: dm places" on tokens;
drop policy if exists "tokens: dm or the pc's player updates" on tokens;
drop policy if exists "tokens: dm removes" on tokens;
create policy "tokens: members see (unless hidden)" on tokens
  for select to authenticated
  using (is_campaign_member(campaign_id) and (not hidden or is_campaign_dm(campaign_id)));
create policy "tokens: dm places" on tokens
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "tokens: dm or the pc's player updates" on tokens
  for update to authenticated
  using (is_campaign_dm(campaign_id) or (kind = 'pc' and owns_token_character(character_id)))
  with check (is_campaign_dm(campaign_id) or (kind = 'pc' and owns_token_character(character_id)));
create policy "tokens: dm removes" on tokens
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- ── campaign-aware dice functions ────────────────────────────
-- Rolls now belong to a campaign; only its members may roll into it.
create or replace function roll_dice(p_campaign uuid, p_label text, p_spec jsonb, p_modifier int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; results int[]; all_dice jsonb := '[]'::jsonb; total int := 0;
  sides int; cnt int; total_count int := 0; new_row rolls;
begin
  if not is_campaign_member(p_campaign) then raise exception 'Not a member of this campaign'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then raise exception 'Modifier out of range'; end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'array' or jsonb_array_length(p_spec) = 0 then raise exception 'Nothing to roll'; end if;
  for d in select * from jsonb_array_elements(p_spec) loop
    sides := (d->>'sides')::int; cnt := (d->>'count')::int;
    if sides not in (4,6,8,10,12,20,100) then raise exception 'Unknown die: d%', sides; end if;
    if cnt is null or cnt < 1 then raise exception 'Bad dice count'; end if;
    total_count := total_count + cnt;
    if total_count > 40 then raise exception 'Too many dice (max 40 per roll)'; end if;
    results := array(select 1 + floor(random() * sides)::int from generate_series(1, cnt));
    total := total + (select sum(x)::int from unnest(results) x);
    all_dice := all_dice || jsonb_build_array(jsonb_build_object('sides', sides, 'count', cnt, 'results', to_jsonb(results)));
  end loop;
  total := total + p_modifier;
  insert into rolls (campaign_id, roller_email, label, dice, modifier, total)
  values (p_campaign, my_email(), left(coalesce(p_label, ''), 60), all_dice, p_modifier, total)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;
revoke execute on function roll_dice(uuid, text, jsonb, int) from public, anon;
grant execute on function roll_dice(uuid, text, jsonb, int) to authenticated;
-- retire the old campaign-less signature so nothing calls it unscoped
drop function if exists roll_dice(text, jsonb, int);

create or replace function roll_check(p_campaign uuid, p_label text, p_modifier int, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r1 int; r2 int; kept int; dice_json jsonb; new_row rolls;
begin
  if not is_campaign_member(p_campaign) then raise exception 'Not a member of this campaign'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then raise exception 'Modifier out of range'; end if;
  if p_mode not in ('normal','adv','dis') then raise exception 'Bad roll mode'; end if;
  r1 := 1 + floor(random() * 20)::int;
  if p_mode = 'normal' then
    kept := r1;
    dice_json := jsonb_build_array(jsonb_build_object('sides',20,'count',1,'results',jsonb_build_array(r1)));
  else
    r2 := 1 + floor(random() * 20)::int;
    kept := case when p_mode='adv' then greatest(r1,r2) else least(r1,r2) end;
    dice_json := jsonb_build_array(jsonb_build_object('sides',20,'count',2,'results',jsonb_build_array(r1,r2),
      'keep', case when p_mode='adv' then 'high' else 'low' end));
  end if;
  insert into rolls (campaign_id, roller_email, label, dice, modifier, total)
  values (p_campaign, my_email(), left(coalesce(p_label,''),60), dice_json, p_modifier, kept + p_modifier)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;
revoke execute on function roll_check(uuid, text, int, text) from public, anon;
grant execute on function roll_check(uuid, text, int, text) to authenticated;
drop function if exists roll_check(text, int, text);
