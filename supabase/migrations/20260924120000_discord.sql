-- ═════════════════════════════════════════════════════════════
--  DISCORD — let a DM connect their campaign to a Discord channel so
--  Onyx can POST to it (game reminders, session recaps, announcements,
--  and optionally dice results). This is OUTBOUND only, via a Discord
--  channel WEBHOOK URL the DM pastes in — no bot, no OAuth, nothing to
--  host. The webhook URL is a secret (anyone with it can post to the
--  channel), so this table is DM-ONLY and posting goes through the
--  server, never the players' browsers.
--
--   • Manual posts (reminders / recaps / announcements) are sent by the
--     `discord-post` Edge Function using the DM's own auth.
--   • Auto dice results are posted by a trigger on `rolls` (below) that
--     calls the webhook directly via pg_net — so it works even when no
--     browser is open. `dice_mode`: off | crits (only nat-20 / nat-1) |
--     all (every roll — chatty).
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

create extension if not exists pg_net;   -- async HTTP from Postgres (auto-dice)

create table if not exists campaign_discord (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  webhook_url text not null
    check (webhook_url ~ '^https://(discord|discordapp)\.com/api/webhooks/'),  -- SSRF guard: Discord webhooks only
  enabled     boolean not null default true,
  dice_mode   text not null default 'off' check (dice_mode in ('off','crits','all')),
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table campaign_discord enable row level security;

-- DM-only on read AND write — the webhook URL never reaches players.
drop policy if exists "discord: dm reads" on campaign_discord;
create policy "discord: dm reads" on campaign_discord
  for select to authenticated using (is_campaign_dm(campaign_id));
drop policy if exists "discord: dm writes" on campaign_discord;
create policy "discord: dm writes" on campaign_discord
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "discord: dm edits" on campaign_discord;
create policy "discord: dm edits" on campaign_discord
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "discord: dm deletes" on campaign_discord;
create policy "discord: dm deletes" on campaign_discord
  for delete to authenticated using (is_campaign_dm(campaign_id));

create or replace function touch_campaign_discord() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists campaign_discord_touch on campaign_discord;
create trigger campaign_discord_touch before update on campaign_discord
  for each row execute function touch_campaign_discord();

-- ── auto-post dice rolls to the campaign's Discord channel ───────
-- Runs as the table owner (SECURITY DEFINER) so it can read the DM-only
-- webhook and fire an HTTP request regardless of who rolled. It never
-- raises: a Discord hiccup must never break a dice roll.
create or replace function discord_on_roll() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg     campaign_discord;
  is_crit boolean := false;
  is_fumb boolean := false;
  who     text;
  spec    text;
  title   text;
  color   int;
begin
  if new.campaign_id is null then return new; end if;
  select * into cfg from campaign_discord
    where campaign_id = new.campaign_id and enabled and dice_mode <> 'off';
  if not found then return new; end if;

  -- a natural 20 / 1 on any d20 in the roll (good enough for a flavour ping)
  select exists (
    select 1 from jsonb_array_elements(new.dice) e, jsonb_array_elements(e->'results') r
    where (e->>'sides')::int = 20 and (r)::int = 20
  ) into is_crit;
  select exists (
    select 1 from jsonb_array_elements(new.dice) e, jsonb_array_elements(e->'results') r
    where (e->>'sides')::int = 20 and (r)::int = 1
  ) into is_fumb;

  if cfg.dice_mode = 'crits' and not (is_crit or is_fumb) then return new; end if;

  select coalesce(nullif(cm.display_name, ''), split_part(new.roller_email, '@', 1))
    into who from campaign_members cm
    where cm.campaign_id = new.campaign_id and lower(cm.email) = lower(new.roller_email)
    limit 1;
  who := coalesce(who, split_part(new.roller_email, '@', 1));

  -- rebuild the spec (e.g. "2d6 + 3") from the stored dice
  select string_agg((e->>'count') || 'd' || (e->>'sides'), ' + ')
    into spec from jsonb_array_elements(new.dice) e;
  if new.modifier <> 0 then
    spec := coalesce(spec, '') || (case when new.modifier > 0 then ' + ' else ' − ' end) || abs(new.modifier);
  end if;

  if is_crit then title := '💥 Critical 20!'; color := 3066993;       -- green
  elsif is_fumb then title := '💀 Natural 1'; color := 15158332;       -- red
  else title := coalesce(nullif(new.label, ''), 'Dice roll'); color := 10197915;  -- mystic
  end if;

  perform net.http_post(
    url    := cfg.webhook_url,
    body   := jsonb_build_object(
      'username', 'Onyx Dungeon 🎲',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', title,
        'description', format('**%s** rolled **%s**%s%s',
          who, new.total,
          case when new.label <> '' and not (is_crit or is_fumb) then '' else coalesce(' — ' || nullif(new.label, ''), '') end,
          coalesce('  ·  `' || spec || '`', '')),
        'color', color
      ))
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
exception when others then
  return new;  -- never let a Discord failure break the roll
end $$;

drop trigger if exists rolls_to_discord on rolls;
create trigger rolls_to_discord after insert on rolls
  for each row execute function discord_on_roll();
