-- ═════════════════════════════════════════════════════════════
--  Homebrew SPELLS — a campaign's shared custom spellbook.
--
--  `homebrew_spells` is ordinary campaign content, the same shape as
--  `homebrew_monsters`: party members read, only a DM writes. A DM
--  authors a spell once (by hand or with AI) and it becomes available
--  to drop onto any character sheet — where the existing per-character
--  custom-spell plumbing casts and animates it. The `data` jsonb is
--  the custom-spell object the character model already understands
--  (see js/dnd/model.js): {name, level, school, time, range,
--  components, duration, concentration, ritual, attack, save, dmg,
--  dmgType, desc, higher, aoe}.
--
--  This migration ALSO widens the shared AI *text* budget (added in
--  ..._homebrew_monsters.sql) so the same reserve/complete/fail gate
--  can cover every homebrew generator — spells now, items/feats/etc.
--  later — without another migration. One budget, one set of caps;
--  only the allowed `kind` values grow.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- ── homebrew spells (content) ────────────────────────────────
create table if not exists homebrew_spells (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null default 'New spell',
  level       int  not null default 0,           -- 0 = cantrip … 9
  school      text not null default '',          -- shown in lists
  data        jsonb not null default '{}'::jsonb, -- the custom-spell object (see js/dnd/model.js)
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists homebrew_spells_campaign_idx on homebrew_spells (campaign_id);
alter table homebrew_spells enable row level security;

-- Party members may read the spellbook; only a DM of the campaign writes.
drop policy if exists "hbspell: members read" on homebrew_spells;
create policy "hbspell: members read" on homebrew_spells
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "hbspell: dm writes" on homebrew_spells;
create policy "hbspell: dm writes" on homebrew_spells
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "hbspell: dm edits" on homebrew_spells;
create policy "hbspell: dm edits" on homebrew_spells
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "hbspell: dm deletes" on homebrew_spells;
create policy "hbspell: dm deletes" on homebrew_spells
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- keep updated_at fresh on edits
create or replace function touch_homebrew_spell() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists homebrew_spells_touch on homebrew_spells;
create trigger homebrew_spells_touch before update on homebrew_spells
  for each row execute function touch_homebrew_spell();

-- ═══ widen the shared AI TEXT budget to every homebrew kind ═══
--  The ledger's kind was locked to 'monster'; open it to the whole
--  homebrew family (and the encounter planner) so one budget serves
--  them all. Drop the existing kind check by DISCOVERY (its
--  auto-generated name can vary) so the old 'monster'-only rule can't
--  survive and reject a 'spell'. Idempotent.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'ai_text_log'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table ai_text_log drop constraint %I', c);
  end loop;
end $$;
alter table ai_text_log add constraint ai_text_log_kind_check
  check (kind in ('monster','spell','item','feat','background','race','subclass','class','encounter'));

-- reserve: same atomic per-month cap gate as before; only the kind
-- allow-list and the DM-facing message are generalized.
create or replace function ai_reserve_text(p_campaign uuid, p_kind text, p_prompt text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ym         text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email      text := my_email();
  v_per_dm     int;
  v_global     int;
  v_dm_count   int;
  v_global_cnt int;
  v_id         uuid;
begin
  if v_email = '' then raise exception 'Must be signed in'; end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a DM of this campaign can use AI generation';
  end if;
  if p_kind not in ('monster','spell','item','feat','background','race','subclass','class','encounter') then
    raise exception 'Unknown text kind';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_text_reserve:' || v_ym, 0));

  select per_dm_monthly_cap, global_monthly_cap into v_per_dm, v_global
    from ai_text_config where id = true;
  if v_per_dm is null or v_global is null then
    raise exception 'AI text budget is not configured';
  end if;

  select count(*) into v_dm_count from ai_text_log
   where dm_email = v_email and ym = v_ym and status <> 'failed';
  if v_dm_count >= v_per_dm then raise exception 'DM monthly limit reached'; end if;

  select count(*) into v_global_cnt from ai_text_log
   where ym = v_ym and status <> 'failed';
  if v_global_cnt >= v_global then raise exception 'Global monthly AI budget reached'; end if;

  insert into ai_text_log (campaign_id, dm_email, ym, kind, prompt, status)
    values (p_campaign, v_email, v_ym, p_kind, left(coalesce(p_prompt, ''), 2000), 'pending')
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function ai_reserve_text(uuid, text, text) from public, anon;
grant  execute on function ai_reserve_text(uuid, text, text) to authenticated, service_role;
