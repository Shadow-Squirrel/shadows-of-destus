-- ═════════════════════════════════════════════════════════════
--  Homebrew monsters + AI monster generation (cost-safe).
--
--  Two things live here:
--
--   1. `homebrew_monsters` — custom stat blocks a DM builds (by
--      hand or with AI), stored per campaign as a jsonb `data`
--      blob plus an optional `art_path` (a portrait in the
--      reveal-safe 'ai-art' bucket). Party members can read them;
--      only a DM of the campaign may write. Direct-write RLS, the
--      same shape the `maps` table uses — this is ordinary content,
--      not money-critical.
--
--   2. An AI TEXT budget — `ai_text_config` / `ai_text_log` and the
--      reserve/complete/fail/usage functions — a byte-for-byte twin
--      of the AI *image* budget in ..._ai_images.sql, but counting
--      LLM stat-block generations SEPARATELY from image generations
--      (different provider, different price, so the owner caps them
--      independently). The MONEY-CRITICAL reserve gate is atomic:
--      DM-ship + per-DM and global monthly caps are checked under a
--      per-month advisory lock before the Edge Function may spend a
--      cent at Anthropic. A 'failed' row never counts against quota.
--
--  The ultimate ceiling is NOT here: it is the spend limit the owner
--  sets on their Anthropic account. These caps are the in-app UX
--  layer; the account limit is the hard guarantee. See docs/AI-MONSTERS.md.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- ── homebrew monsters (content) ──────────────────────────────
create table if not exists homebrew_monsters (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null default 'New monster',
  cr          text not null default '',        -- shown in lists ("1/2", "5")
  data        jsonb not null default '{}'::jsonb, -- the full stat block (see js/pages/monsters.js)
  art_path    text,                            -- optional portrait in the 'ai-art' bucket
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists homebrew_monsters_campaign_idx on homebrew_monsters (campaign_id);
alter table homebrew_monsters enable row level security;

-- Party members may read the bestiary; only a DM of the campaign writes.
drop policy if exists "hbmon: members read" on homebrew_monsters;
create policy "hbmon: members read" on homebrew_monsters
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "hbmon: dm writes" on homebrew_monsters;
create policy "hbmon: dm writes" on homebrew_monsters
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "hbmon: dm edits" on homebrew_monsters;
create policy "hbmon: dm edits" on homebrew_monsters
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "hbmon: dm deletes" on homebrew_monsters;
create policy "hbmon: dm deletes" on homebrew_monsters
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- keep updated_at fresh on edits
create or replace function touch_homebrew_monster() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists homebrew_monsters_touch on homebrew_monsters;
create trigger homebrew_monsters_touch before update on homebrew_monsters
  for each row execute function touch_homebrew_monster();

-- ═══ AI TEXT budget (mirrors the AI image budget) ════════════

-- ── the caps (single-row config) ─────────────────────────────
--   update ai_text_config set per_dm_monthly_cap = 100;
create table if not exists ai_text_config (
  id boolean primary key default true,
  per_dm_monthly_cap  int not null default 25,
  global_monthly_cap  int not null default 500,
  updated_at timestamptz not null default now(),
  constraint ai_text_config_singleton check (id = true)
);
insert into ai_text_config (id) values (true) on conflict (id) do nothing;
alter table ai_text_config enable row level security;
drop policy if exists "ai text config: readable" on ai_text_config;
create policy "ai text config: readable" on ai_text_config
  for select to authenticated using (true);

-- ── the ledger ───────────────────────────────────────────────
create table if not exists ai_text_log (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  dm_email     text not null,
  ym           text not null,                 -- 'YYYY-MM' in UTC
  kind         text not null default 'monster' check (kind in ('monster')),
  prompt       text not null default '',
  status       text not null default 'pending' check (status in ('pending','done','failed')),
  created_at   timestamptz not null default now()
);
create index if not exists ai_text_log_dm_ym_live_idx on ai_text_log (dm_email, ym) where status <> 'failed';
create index if not exists ai_text_log_ym_live_idx     on ai_text_log (ym)           where status <> 'failed';
create index if not exists ai_text_log_campaign_idx    on ai_text_log (campaign_id);
alter table ai_text_log enable row level security;
drop policy if exists "ai text log: members read" on ai_text_log;
create policy "ai text log: members read" on ai_text_log
  for select to authenticated using (is_campaign_member(campaign_id));

-- ── reserve: the atomic cap gate (see ..._ai_images.sql for the
--    full explanation of the per-month advisory lock) ──────────
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
    raise exception 'Only a DM of this campaign can generate monsters';
  end if;
  if p_kind not in ('monster') then raise exception 'Unknown text kind'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_text_reserve:' || v_ym, 0));

  select per_dm_monthly_cap, global_monthly_cap into v_per_dm, v_global
    from ai_text_config where id = true;
  if v_per_dm is null or v_global is null then
    raise exception 'AI monster budget is not configured';
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

-- ── complete / fail ──────────────────────────────────────────
create or replace function ai_complete_text(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_text_log set status = 'done'
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
  if not found then
    raise exception 'Reservation not found, not yours, or already finalized';
  end if;
end $$;
revoke execute on function ai_complete_text(uuid) from public, anon;
grant  execute on function ai_complete_text(uuid) to authenticated, service_role;

create or replace function ai_fail_text(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_text_log set status = 'failed'
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
end $$;
revoke execute on function ai_fail_text(uuid) from public, anon;
grant  execute on function ai_fail_text(uuid) to authenticated, service_role;

-- ── usage (for the "N left this month" display) ──────────────
create or replace function ai_text_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ym    text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email text := my_email();
  v_per   int;
  v_glob  int;
  v_used  int;
  v_gused int;
begin
  select per_dm_monthly_cap, global_monthly_cap into v_per, v_glob
    from ai_text_config where id = true;
  select count(*) into v_used  from ai_text_log
    where dm_email = v_email and ym = v_ym and status <> 'failed';
  select count(*) into v_gused from ai_text_log
    where ym = v_ym and status <> 'failed';
  return jsonb_build_object(
    'ym', v_ym, 'used', v_used, 'cap', v_per,
    'remaining', greatest(0, coalesce(v_per, 0) - v_used),
    'global_used', v_gused, 'global_cap', v_glob
  );
end $$;
revoke execute on function ai_text_usage() from public, anon;
grant  execute on function ai_text_usage() to authenticated, service_role;
